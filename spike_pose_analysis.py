#!/usr/bin/env python3
"""
YOLOv8-pose Volleyball Spike Biomechanical Analysis
Usage: python3 spike_pose_analysis.py <video_path> [output_json_path]
"""

import os
os.environ['YOLO_CONFIG_DIR'] = '/tmp/Ultralytics'
os.environ['HOME'] = '/tmp'
os.environ['TORCH_HOME'] = '/tmp/torch'
os.environ['HF_HOME'] = '/tmp/hf'

import sys
import json
import math
import traceback
from typing import Optional, Tuple, List, Dict, Any

import cv2
import numpy as np

# Must import after env vars are set
from ultralytics import YOLO

# Suppress ultralytics logging
import logging
logging.getLogger("ultralytics").setLevel(logging.ERROR)

# COCO 17 keypoints
KP_NAMES = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]

# Keypoint indices for convenience
NOSE = 0
L_EYE, R_EYE = 1, 2
L_EAR, R_EAR = 3, 4
L_SHOULDER, R_SHOULDER = 5, 6
L_ELBOW, R_ELBOW = 7, 8
L_WRIST, R_WRIST = 9, 10
L_HIP, R_HIP = 11, 12
L_KNEE, R_KNEE = 13, 14
L_ANKLE, R_ANKLE = 15, 16

# Hitting arm keypoint indices (default right-handed)
HIT_SHOULDER = R_SHOULDER
HIT_ELBOW = R_ELBOW
HIT_WRIST = R_WRIST
OFF_SHOULDER = L_SHOULDER
OFF_WRIST = L_WRIST


# ─── Utility Functions ───────────────────────────────────────────────────────

def angle_between(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Compute angle at vertex b formed by points a-b-c in degrees."""
    ba = a - b
    bc = c - b
    cos_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-8)
    cos_angle = np.clip(cos_angle, -1.0, 1.0)
    return float(np.degrees(math.acos(cos_angle)))


def angle_of_line(a: np.ndarray, b: np.ndarray) -> float:
    """Angle of line a->b from horizontal in degrees (-180 to 180)."""
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    return float(np.degrees(math.atan2(dy, dx)))


def dist(a: np.ndarray, b: np.ndarray) -> float:
    """Euclidean distance between two points."""
    return float(np.linalg.norm(a - b))


def midpoint(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return (a + b) / 2.0


def line_angle(a: np.ndarray, b: np.ndarray) -> float:
    """Angle of line from a to b in degrees."""
    return angle_of_line(a, b)


def normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    if n < 1e-8:
        return np.zeros_like(v)
    return v / n


def clamp(val: int, lo: int = 0, hi: int = 100) -> int:
    return max(lo, min(hi, int(round(val))))


def score_linear(value: float, min_val: float, max_val: float, invert: bool = False) -> int:
    """Map value linearly from [min_val, max_val] to [0, 100]."""
    if max_val == min_val:
        return 50
    ratio = (value - min_val) / (max_val - min_val)
    ratio = np.clip(ratio, 0.0, 1.0)
    if invert:
        ratio = 1.0 - ratio
    return clamp(int(ratio * 100))


def score_band(value: float, best_lo: float, best_hi: float, worst: float) -> int:
    """Score based on how close value is to [best_lo, best_hi] range.
    worst is the value at which score = 0."""
    if best_lo <= value <= best_hi:
        return 95
    if value < best_lo:
        dist_from_best = best_lo - value
    else:
        dist_from_best = value - best_hi
    max_dist = max(abs(best_lo - worst), abs(best_hi - worst))
    if max_dist < 1e-8:
        return 95
    ratio = 1.0 - min(dist_from_best / max_dist, 1.0)
    return clamp(int(30 + ratio * 65))


def smooth(series: List[float], window: int = 3) -> List[float]:
    """Simple moving average smoothing."""
    if len(series) < window:
        return series
    result = []
    half = window // 2
    for i in range(len(series)):
        lo = max(0, i - half)
        hi = min(len(series), i + half + 1)
        result.append(np.mean(series[lo:hi]))
    return result


# ─── Video & Detection Processing ────────────────────────────────────────────

def extract_keypoints(video_path: str) -> Tuple[List[Dict], float, float, int, int]:
    """
    Run YOLOv8-pose on video, return per-frame keypoint data.
    Returns: (frames_data, fps, duration, width, height)
    Each frame_data: { 'frame_idx': int, 'keypoints': np.array (17,3), 'conf': float, 'bbox': list }
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = total_frames / fps if fps > 0 else 0

    # Determine sampling
    sample_every = 3
    if duration < 3.0:
        sample_every = 1

    model = YOLO('yolov8n-pose.pt')

    frames_data = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % sample_every == 0:
            results = model(frame, verbose=False, conf=0.15, iou=0.45)
            if results and results[0].keypoints is not None:
                kpts = results[0].keypoints
                if kpts.xy is not None and len(kpts.xy) > 0:
                    # Pick largest/most confident detection
                    best_idx = 0
                    best_score = 0
                    boxes = results[0].boxes
                    for i in range(len(kpts.xy)):
                        conf = float(boxes[i].conf) if boxes is not None and i < len(boxes) else 0.5
                        # Also consider box area as tiebreaker
                        if boxes is not None and i < len(boxes):
                            area = float(boxes[i].xywh[0][2] * boxes[i].xywh[0][3])
                        else:
                            area = 0
                        score = conf * 1000 + area
                        if score > best_score:
                            best_score = score
                            best_idx = i

                    kp_xy = kpts.xy[best_idx].cpu().numpy()  # (17, 2)
                    kp_conf = kpts.conf[best_idx].cpu().numpy() if kpts.conf is not None else np.ones(17)
                    kp_with_conf = np.hstack([kp_xy, kp_conf.reshape(-1, 1)])  # (17, 3)

                    bbox = list(boxes[best_idx].xyxy[0].cpu().numpy()) if boxes is not None and best_idx < len(boxes) else [0,0,0,0]
                    det_conf = float(boxes[best_idx].conf) if boxes is not None and best_idx < len(boxes) else 0.5

                    frames_data.append({
                        'frame_idx': frame_idx,
                        'keypoints': kp_with_conf,
                        'conf': det_conf,
                        'bbox': bbox,
                    })
        frame_idx += 1

    cap.release()
    return frames_data, fps, duration, width, height


def track_player(frames_data: List[Dict]) -> List[Dict]:
    """
    Track the same player across frames using proximity.
    If only one detection per frame, just return as-is.
    """
    if len(frames_data) <= 1:
        return frames_data

    # Group by frame_idx
    by_frame = {}
    for fd in frames_data:
        idx = fd['frame_idx']
        if idx not in by_frame:
            by_frame[idx] = []
        by_frame[idx].append(fd)

    unique_frames = sorted(by_frame.keys())
    tracked = []
    prev_center = None

    for fidx in unique_frames:
        detections = by_frame[fidx]
        if len(detections) == 1:
            best = detections[0]
        else:
            if prev_center is None:
                # Pick most confident
                best = max(detections, key=lambda d: d['conf'])
            else:
                # Pick closest to previous
                best = None
                best_dist = float('inf')
                for d in detections:
                    kp = d['keypoints']
                    if kp[5, 2] > 0.3 and kp[6, 2] > 0.3:
                        center = midpoint(kp[5, :2], kp[6, :2])
                    elif kp[11, 2] > 0.3 and kp[12, 2] > 0.3:
                        center = midpoint(kp[11, :2], kp[12, :2])
                    else:
                        center = kp[:2].mean(axis=0)
                    d_dist = dist(center, prev_center)
                    if d_dist < best_dist:
                        best_dist = d_dist
                        best = d
                if best is None:
                    best = detections[0]

        kp = best['keypoints']
        if kp[5, 2] > 0.3 and kp[6, 2] > 0.3:
            prev_center = midpoint(kp[5, :2], kp[6, :2])
        elif kp[11, 2] > 0.3 and kp[12, 2] > 0.3:
            prev_center = midpoint(kp[11, :2], kp[12, :2])

        tracked.append(best)

    return tracked


def detect_handedness(frames_data: List[Dict]) -> bool:
    """Detect if player is left-handed by checking arm movement amplitude.
    Returns True if left-handed, False if right-handed."""
    if len(frames_data) < 5:
        return False

    r_wrist_movement = 0.0
    l_wrist_movement = 0.0
    prev_rw = None
    prev_lw = None

    for fd in frames_data:
        kp = fd['keypoints']
        rw = kp[R_WRIST, :2] if kp[R_WRIST, 2] > 0.3 else None
        lw = kp[L_WRIST, :2] if kp[L_WRIST, 2] > 0.3 else None

        if rw is not None and prev_rw is not None:
            r_wrist_movement += dist(rw, prev_rw)
        if lw is not None and prev_lw is not None:
            l_wrist_movement += dist(lw, prev_lw)

        prev_rw = rw
        prev_lw = lw

    return l_wrist_movement > r_wrist_movement * 1.3


def interpolate_missing(frames_data: List[Dict]) -> List[Dict]:
    """Linearly interpolate keypoints for frames with low confidence."""
    if len(frames_data) < 3:
        return frames_data

    result = [fd.copy() for fd in frames_data]

    for kp_idx in range(17):
        # Find gaps
        valid = []
        for i, fd in enumerate(result):
            if fd['keypoints'][kp_idx, 2] > 0.3:
                valid.append(i)

        if len(valid) < 2:
            continue

        # Interpolate between valid points
        for vi in range(len(valid) - 1):
            start = valid[vi]
            end = valid[vi + 1]
            if end - start <= 1:
                continue
            start_kp = result[start]['keypoints'][kp_idx, :2]
            end_kp = result[end]['keypoints'][kp_idx, :2]
            for j in range(start + 1, end):
                t = (j - start) / (end - start)
                interp = start_kp * (1 - t) + end_kp * t
                result[j]['keypoints'][kp_idx, :2] = interp
                result[j]['keypoints'][kp_idx, 2] = 0.3  # Mark as interpolated

    return result


# ─── Phase Detection ─────────────────────────────────────────────────────────

def detect_phases(frames_data: List[Dict], fps: float, is_left_handed: bool) -> Dict[str, Any]:
    """Detect approach, jump, contact, and follow-through phases."""
    n = len(frames_data)
    if n < 5:
        return {
            'approach_start': 0, 'approach_end': n // 4,
            'plant_frame': n // 4, 'jump_start': n // 4, 'jump_peak': n // 2,
            'contact_frame': n // 2, 'follow_through_end': n - 1,
            'person_height': 200,
        }

    # Get hip center y-positions (lower y = higher in frame)
    hip_ys = []
    hip_xs = []
    for fd in frames_data:
        kp = fd['keypoints']
        if kp[L_HIP, 2] > 0.3 and kp[R_HIP, 2] > 0.3:
            hc = midpoint(kp[L_HIP, :2], kp[R_HIP, :2])
            hip_ys.append(hc[1])
            hip_xs.append(hc[0])
        else:
            hip_ys.append(None)
            hip_xs.append(None)

    # Fill None with nearest valid
    for i in range(n):
        if hip_ys[i] is None:
            # Find nearest valid
            best_j = -1
            best_d = float('inf')
            for j in range(n):
                if hip_ys[j] is not None:
                    d = abs(j - i)
                    if d < best_d:
                        best_d = d
                        best_j = j
            if best_j >= 0:
                hip_ys[i] = hip_ys[best_j]
                hip_xs[i] = hip_xs[best_j]
            else:
                hip_ys[i] = 0
                hip_xs[i] = 0

    # Smooth hip y
    smoothed_hip_y = smooth(hip_ys, 5)

    # Estimate person height (hip to ankle average)
    heights = []
    for fd in frames_data:
        kp = fd['keypoints']
        if kp[L_HIP, 2] > 0.3 and kp[L_KNEE, 2] > 0.3 and kp[L_ANKLE, 2] > 0.3:
            h = dist(kp[L_HIP, :2], kp[L_ANKLE, :2])
            if h > 50:
                heights.append(h)
        if kp[R_HIP, 2] > 0.3 and kp[R_KNEE, 2] > 0.3 and kp[R_ANKLE, 2] > 0.3:
            h = dist(kp[R_HIP, :2], kp[R_ANKLE, :2])
            if h > 50:
                heights.append(h)
    person_height = float(np.median(heights)) if heights else 200
    leg_length = person_height  # hip to ankle

    # Find jump peak (minimum hip_y = highest point)
    peak_idx = int(np.argmin(smoothed_hip_y))

    # Find plant frame (last local maximum in hip_y before peak)
    plant_idx = peak_idx
    for i in range(peak_idx - 1, max(0, peak_idx - int(fps * 1.5)), -1):
        if smoothed_hip_y[i] >= smoothed_hip_y[plant_idx]:
            plant_idx = i
        if smoothed_hip_y[i] < smoothed_hip_y[peak_idx] + 10:
            break
    # Refine: find the actual last rise before the drop
    for i in range(peak_idx - 1, max(0, peak_idx - int(fps * 1.0)), -1):
        if smoothed_hip_y[i] > smoothed_hip_y[i + 1] + 2:
            plant_idx = i + 1
            break
    else:
        # Fallback: highest hip_y point before peak
        search_start = max(0, peak_idx - int(fps * 1.5))
        plant_idx = search_start + int(np.argmax(smoothed_hip_y[search_start:peak_idx + 1]))

    # Approach: frames before plant
    approach_start = 0
    approach_end = plant_idx

    # Find contact frame (max wrist speed of hitting arm)
    hit_w = L_WRIST if is_left_handed else R_WRIST
    wrist_speeds = []
    for i in range(1, n):
        w1 = frames_data[i - 1]['keypoints']
        w2 = frames_data[i]['keypoints']
        if w1[hit_w, 2] > 0.3 and w2[hit_w, 2] > 0.3:
            spd = dist(w1[hit_w, :2], w2[hit_w, :2])
            wrist_speeds.append(spd)
        else:
            wrist_speeds.append(0)

    if wrist_speeds:
        contact_idx = int(np.argmax(wrist_speeds)) + 1  # +1 because speeds are offset by 1
    else:
        contact_idx = peak_idx

    # Clamp contact to be near jump peak (should be during/after jump)
    contact_idx = max(peak_idx - int(fps * 0.3), min(peak_idx + int(fps * 0.5), contact_idx))

    # Follow through: frames after contact
    follow_end = min(n - 1, contact_idx + int(fps * 1.0))

    return {
        'approach_start': approach_start,
        'approach_end': approach_end,
        'plant_frame': plant_idx,
        'jump_start': plant_idx,
        'jump_peak': peak_idx,
        'contact_frame': contact_idx,
        'follow_through_end': follow_end,
        'person_height': person_height,
        'leg_length': leg_length,
        'hip_ys': smoothed_hip_y,
        'hip_xs': hip_xs,
        'wrist_speeds': wrist_speeds,
    }


# ─── Biomechanical Metric Calculations ───────────────────────────────────────

def calc_approach_speed(frames_data: List[Dict], phases: Dict, fps: float) -> Tuple[int, float]:
    """Track center-of-mass horizontal speed during approach."""
    as_start = phases['approach_start']
    as_end = phases['approach_end']
    hip_xs = phases['hip_xs']

    if as_end <= as_start + 1:
        return 50, 0.0

    xs = [hip_xs[i] for i in range(as_start, min(as_end + 1, len(hip_xs)))]
    if not xs:
        return 50, 0.0

    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return 50, 0.0

    total_dist = abs(xs[-1] - xs[0])
    dt = len(xs) / fps
    speed = total_dist / dt if dt > 0 else 0

    # Score
    if speed > 300:
        score = 92
    elif speed > 200:
        score = int(70 + (speed - 200) / 100 * 22)
    elif speed > 100:
        score = int(45 + (speed - 100) / 100 * 25)
    else:
        score = int(20 + speed / 100 * 25)

    return clamp(score), round(speed, 2)


def calc_approach_angle(frames_data: List[Dict], phases: Dict) -> Tuple[int, float]:
    """Angle of approach direction from horizontal."""
    as_start = phases['approach_start']
    plant = phases['plant_frame']
    hip_xs = phases['hip_xs']
    hip_ys = phases['hip_ys']

    if plant <= as_start:
        return 50, 0.0

    start_hc = np.array([hip_xs[as_start] or 0, hip_ys[as_start] or 0])
    plant_hc = np.array([hip_xs[plant] or 0, hip_ys[plant] or 0])

    dx = plant_hc[0] - start_hc[0]
    dy = plant_hc[1] - start_hc[1]

    # Angle from horizontal (absolute value since direction depends on camera)
    angle = abs(float(np.degrees(math.atan2(abs(dy), abs(dx)))))

    # Score: optimal 45-60 degrees
    score = score_band(angle, 45, 60, 0)
    # Also penalize very steep
    if angle > 75:
        score = clamp(score - 15)

    return clamp(score), round(angle, 1)


def calc_last_step_length(frames_data: List[Dict], phases: Dict, is_left_handed: bool) -> Tuple[int, float]:
    """Distance of last step before plant, normalized by leg length."""
    plant = phases['plant_frame']
    leg_length = phases['leg_length']

    # Find last two ankle positions before plant
    last_ankle_positions = []
    for i in range(plant, max(0, plant - int(len(frames_data) * 0.3)), -1):
        kp = frames_data[i]['keypoints']
        if kp[L_ANKLE, 2] > 0.3 and kp[R_ANKLE, 2] > 0.3:
            # Use the foot that's more forward (lower x or higher x depending on approach)
            # Just use the ankle pair's center and track changes
            last_ankle_positions.append((i, kp[L_ANKLE, :2].copy(), kp[R_ANKLE, :2].copy()))
            if len(last_ankle_positions) >= 10:
                break

    if len(last_ankle_positions) < 2:
        return 50, 0.0

    # Detect step changes: look for large changes in ankle y-positions (foot plants)
    # The braking step is the second-to-last step before plant
    # Use ankle centers
    ankle_centers = [(idx, midpoint(la, ra)) for idx, la, ra in last_ankle_positions]

    # Find the two last distinct step positions (where ankle y spikes down = foot contact)
    # Look at ankle y changes
    steps = [ankle_centers[0]]
    for i in range(1, len(ankle_centers)):
        idx, center = ankle_centers[i]
        prev_idx, prev_center = steps[-1]
        # If significant movement, it's a new step
        if dist(center, prev_center) > leg_length * 0.15:
            steps.append(ankle_centers[i])

    if len(steps) < 2:
        return 50, 0.0

    # Last two steps
    braking_step = steps[-2][1]
    plant_step = steps[-1][1]
    step_length = dist(braking_step, plant_step)

    ratio = step_length / leg_length if leg_length > 0 else 0

    # Optimal ratio 0.8-1.2
    score = score_band(ratio, 0.8, 1.2, 0.0)

    return clamp(score), round(ratio, 3)


def calc_footwork_rhythm(frames_data: List[Dict], phases: Dict, fps: float) -> Tuple[int, float]:
    """Analyze timing between foot plants."""
    plant = phases['plant_frame']
    leg_length = phases['leg_length']
    n = len(frames_data)

    # Track ankle positions over approach
    ankle_ys = []
    for i in range(max(0, plant - int(fps * 2)), plant + 1):
        if i >= n:
            break
        kp = frames_data[i]['keypoints']
        if kp[L_ANKLE, 2] > 0.3 and kp[R_ANKLE, 2] > 0.3:
            ankle_ys.append((i, min(kp[L_ANKLE, 1], kp[R_ANKLE, 1])))
        elif kp[L_ANKLE, 2] > 0.3:
            ankle_ys.append((i, kp[L_ANKLE, 1]))
        elif kp[R_ANKLE, 2] > 0.3:
            ankle_ys.append((i, kp[R_ANKLE, 1]))

    if len(ankle_ys) < 3:
        return 50, 0.0

    # Find foot plant events (local minima in ankle y = foot touching ground)
    y_vals = [ay for _, ay in ankle_ys]
    smoothed = smooth(y_vals, 3)

    plants = []
    for i in range(1, len(smoothed) - 1):
        if smoothed[i] >= smoothed[i - 1] and smoothed[i] >= smoothed[i + 1]:
            # Local maximum in y (lowest physical position) = foot plant
            if smoothed[i] > np.mean(smoothed) - 5:
                plants.append(ankle_ys[i][0])

    if len(plants) < 2:
        return 50, 0.0

    # Time intervals between plants
    intervals = []
    for i in range(1, len(plants)):
        dt = (plants[i] - plants[i - 1]) / fps
        if dt > 0.05:
            intervals.append(dt)

    if len(intervals) < 2:
        return 50, 0.0

    # Good rhythm: intervals should be decreasing (accelerating) and consistent
    # Check acceleration pattern (slow-to-fast means intervals get shorter)
    acceleration_score = 50
    if len(intervals) >= 2:
        # Ratios of consecutive intervals
        ratios = [intervals[i] / intervals[i + 1] for i in range(len(intervals) - 1) if intervals[i + 1] > 0]
        if ratios:
            avg_ratio = np.mean(ratios)
            # ratio > 1 means decelerating (good: slow start, fast end)
            if avg_ratio > 1.3:
                acceleration_score = 85
            elif avg_ratio > 1.1:
                acceleration_score = 75
            elif avg_ratio > 0.9:
                acceleration_score = 60
            else:
                acceleration_score = 35

    # Consistency
    cv = float(np.std(intervals) / (np.mean(intervals) + 1e-8))
    consistency_score = max(30, int(90 - cv * 200))

    score = int(acceleration_score * 0.6 + consistency_score * 0.4)
    rhythm_quality = round(float(np.mean(intervals)), 3)

    return clamp(score), rhythm_quality


def calc_arms_swing_back(frames_data: List[Dict], phases: Dict, is_left_handed: bool) -> Tuple[int, float]:
    """Check if arms swing back past hips during approach."""
    plant = phases['plant_frame']
    as_start = phases['approach_start']
    person_height = phases['person_height']

    off_shoulder = R_SHOULDER if is_left_handed else L_SHOULDER
    off_wrist = R_WRIST if is_left_handed else L_WRIST

    max_back_angle = 0.0
    count = 0

    for i in range(as_start, min(plant + 1, len(frames_data))):
        kp = frames_data[i]['keypoints']
        if kp[off_shoulder, 2] < 0.3 or kp[off_wrist, 2] < 0.3 or kp[L_HIP, 2] < 0.3 or kp[R_HIP, 2] < 0.3:
            continue

        shoulder = kp[off_shoulder, :2]
        wrist = kp[off_wrist, :2]
        hip_c = midpoint(kp[L_HIP, :2], kp[R_HIP, :2])

        # Angle of arm relative to torso vertical
        torso_dir = hip_c - shoulder  # direction from shoulder to hip (downward)
        arm_dir = wrist - shoulder

        # Angle between torso and arm
        angle = angle_between(hip_c, shoulder, wrist)
        max_back_angle = max(max_back_angle, angle)
        count += 1

    if count == 0:
        return 50, 0.0

    # Good armswing back: arms go well past the torso (angle > 120 degrees)
    if max_back_angle > 150:
        score = 92
    elif max_back_angle > 120:
        score = 78
    elif max_back_angle > 90:
        score = 60
    elif max_back_angle > 60:
        score = 40
    else:
        score = 25

    return clamp(score), round(max_back_angle, 1)


def calc_vertical_jump_conversion_impl(frames_data, phases, fps):
    """Implementation of vertical jump conversion."""
    plant = phases['plant_frame']
    peak = phases['jump_peak']
    hip_ys = phases['hip_ys']
    hip_xs = phases['hip_xs']

    if peak <= plant:
        return 50, 0.0

    # Vertical displacement (hip_y going up = getting smaller)
    vert_disp = hip_ys[plant] - hip_ys[peak]  # positive = upward movement

    # Horizontal speed at plant
    window = max(1, int(fps * 0.2))
    pre_frames = range(max(0, plant - window), plant)
    horiz_speeds = []
    for i in pre_frames:
        if i + 1 < len(hip_xs) and hip_xs[i] is not None and hip_xs[i+1] is not None:
            horiz_speeds.append(abs(hip_xs[i+1] - hip_xs[i]) * fps)

    avg_horiz_speed = float(np.mean(horiz_speeds)) if horiz_speeds else 0

    # Conversion ratio: vertical displacement / horizontal speed
    if avg_horiz_speed > 10:
        ratio = vert_disp / avg_horiz_speed
    else:
        ratio = 0

    # Score based on vertical displacement relative to person height
    person_height = phases['person_height']
    jump_ratio = vert_disp / person_height if person_height > 0 else 0

    if jump_ratio > 0.8:
        score = 90
    elif jump_ratio > 0.5:
        score = 72
    elif jump_ratio > 0.3:
        score = 55
    elif jump_ratio > 0.15:
        score = 40
    else:
        score = 25

    # Bonus for good conversion
    if ratio > 0.3:
        score = min(100, score + 5)

    return clamp(score), round(jump_ratio, 3)


def calc_hip_shoulder_rotation(frames_data: List[Dict], phases: Dict) -> Tuple[int, float]:
    """Measure rotation between hip line and shoulder line at peak."""
    peak = phases['jump_peak']
    n = len(frames_data)
    peak = min(peak, n - 1)

    kp = frames_data[peak]['keypoints']
    if kp[L_SHOULDER, 2] < 0.3 or kp[R_SHOULDER, 2] < 0.3 or kp[L_HIP, 2] < 0.3 or kp[R_HIP, 2] < 0.3:
        # Try nearby frames
        for offset in range(1, 10):
            for p in [peak - offset, peak + offset]:
                if 0 <= p < n:
                    kp = frames_data[p]['keypoints']
                    if kp[L_SHOULDER, 2] > 0.3 and kp[R_SHOULDER, 2] > 0.3 and kp[L_HIP, 2] > 0.3 and kp[R_HIP, 2] > 0.3:
                        peak = p
                        break
            else:
                continue
            break

    kp = frames_data[peak]['keypoints']

    shoulder_line = kp[R_SHOULDER, :2] - kp[L_SHOULDER, :2]
    hip_line = kp[R_HIP, :2] - kp[L_HIP, :2]

    s_angle = angle_of_line(kp[L_SHOULDER, :2], kp[R_SHOULDER, :2])
    h_angle = angle_of_line(kp[L_HIP, :2], kp[R_HIP, :2])

    rotation = abs(s_angle - h_angle)
    if rotation > 90:
        rotation = 180 - rotation

    # Score: 20-45 degrees is optimal
    if rotation >= 20 and rotation <= 45:
        score = 90
    elif rotation >= 10 and rotation <= 60:
        score = 72
    elif rotation >= 5:
        score = 55
    else:
        score = 35

    return clamp(score), round(rotation, 1)


def calc_body_position_air(frames_data: List[Dict], phases: Dict) -> Tuple[int, float]:
    """Check body alignment at peak jump."""
    peak = phases['jump_peak']
    n = len(frames_data)
    peak = min(peak, n - 1)

    # Check a few frames around peak
    best_score = 0
    best_angle = 0.0

    for p in range(max(0, peak - 3), min(n, peak + 4)):
        kp = frames_data[p]['keypoints']
        if kp[L_SHOULDER, 2] < 0.3 or kp[R_SHOULDER, 2] < 0.3 or kp[L_HIP, 2] < 0.3 or kp[R_HIP, 2] < 0.3:
            continue
        if kp[L_KNEE, 2] < 0.3 and kp[R_KNEE, 2] < 0.3:
            continue

        shoulder_c = midpoint(kp[L_SHOULDER, :2], kp[R_SHOULDER, :2])
        hip_c = midpoint(kp[L_HIP, :2], kp[R_HIP, :2])

        # Torso angle from vertical (0 = perfectly vertical)
        torso_angle = abs(angle_of_line(shoulder_c, hip_c) - 90)  # 90 = pointing down = vertical
        if torso_angle > 90:
            torso_angle = 180 - torso_angle

        # Optimal: slight backward lean (shoulders behind hips), ~10-25 degrees
        # Check if shoulders are "above and behind" hips
        s = 0
        if torso_angle >= 5 and torso_angle <= 30:
            s += 45
        elif torso_angle <= 45:
            s += 30
        else:
            s += 10

        # Check if non-hitting side shoulder is forward (open position)
        # This helps with rotation
        s += 25  # Base score for being airborne

        # Knee tuck (slight tuck is ok for body control)
        if kp[L_KNEE, 2] > 0.3 and kp[R_KNEE, 2] > 0.3:
            knee_angle = angle_between(kp[L_HIP, :2], kp[L_KNEE, :2], kp[L_ANKLE, :2])
            if 100 < knee_angle < 170:
                s += 20
            elif knee_angle <= 100:
                s += 10
            else:
                s += 15

        if s > best_score:
            best_score = s
            best_angle = torso_angle

    return clamp(best_score), round(best_angle, 1)


def calc_bow_and_arrow(frames_data: List[Dict], phases: Dict, is_left_handed: bool) -> Tuple[int, float]:
    """Measure bow-and-arrow position before contact."""
    contact = phases['contact_frame']
    n = len(frames_data)

    hit_s = L_SHOULDER if is_left_handed else R_SHOULDER
    hit_e = L_ELBOW if is_left_handed else R_ELBOW
    hit_w = L_WRIST if is_left_handed else R_WRIST

    # Search frames before contact for the bow position
    # (hitting arm furthest back = wrist most behind shoulder relative to net direction)
    best_score = 0
    best_arm_angle = 0.0

    search_start = max(0, contact - int(n * 0.15))
    search_end = contact

    max_back_dist = 0
    bow_frame = search_start

    for i in range(search_start, min(search_end, n)):
        kp = frames_data[i]['keypoints']
        if kp[hit_s, 2] < 0.3 or kp[hit_e, 2] < 0.3 or kp[hit_w, 2] < 0.3:
            continue

        shoulder = kp[hit_s, :2]
        elbow = kp[hit_e, :2]
        wrist = kp[hit_w, :2]

        # Arm angle at shoulder-elbow-wrist
        arm_angle = angle_between(shoulder, elbow, wrist)

        # How far back is the wrist relative to shoulder?
        # "Back" = in the direction away from net (we'll use vertical as proxy)
        back_dist = abs(wrist[1] - shoulder[1])  # y-distance (wrist below shoulder)

        # Also check if elbow is high (above shoulder)
        elbow_high = shoulder[1] - elbow[1]  # positive = elbow above shoulder

        if back_dist > max_back_dist:
            max_back_dist = back_dist
            bow_frame = i
            best_arm_angle = arm_angle

    # Score the bow-and-arrow
    kp = frames_data[bow_frame]['keypoints']
    shoulder = kp[hit_s, :2]
    elbow = kp[hit_e, :2]
    wrist = kp[hit_w, :2]

    arm_angle = angle_between(shoulder, elbow, wrist)
    person_height = phases['person_height']

    # Wrist behind and below shoulder
    wrist_behind = wrist[1] > shoulder[1]
    wrist_dist = dist(shoulder, wrist) / person_height if person_height > 0 else 0

    score = 0
    # Arm angle 120-150 is good bow position
    if 120 <= arm_angle <= 150:
        score += 50
    elif 100 <= arm_angle <= 170:
        score += 35
    elif 80 <= arm_angle <= 180:
        score += 20
    else:
        score += 5

    # Wrist should be well away from shoulder (loaded)
    if wrist_dist > 0.6:
        score += 30
    elif wrist_dist > 0.4:
        score += 20
    elif wrist_dist > 0.2:
        score += 10

    # Elbow should be high
    elbow_high = shoulder[1] - elbow[1]
    if elbow_high > 10:
        score += 20
    elif elbow_high > 0:
        score += 10

    return clamp(score), round(best_arm_angle, 1)


def calc_arm_swing_speed(frames_data: List[Dict], phases: Dict, is_left_handed: bool, fps: float) -> Tuple[int, float]:
    """Peak wrist speed during swing."""
    hit_w = L_WRIST if is_left_handed else R_WRIST
    n = len(frames_data)
    person_height = phases['person_height']

    # Calculate speeds
    speeds = []
    for i in range(1, n):
        w1 = frames_data[i - 1]['keypoints']
        w2 = frames_data[i]['keypoints']
        if w1[hit_w, 2] > 0.3 and w2[hit_w, 2] > 0.3:
            spd = dist(w1[hit_w, :2], w2[hit_w, :2]) * fps
            speeds.append(spd)
        else:
            speeds.append(0)

    if not speeds:
        return 50, 0.0

    max_speed = float(np.max(speeds))
    normalized_speed = max_speed / person_height if person_height > 0 else 0

    # Score based on speed relative to body size
    # Elite: > 3.0 body lengths/sec
    if normalized_speed > 3.0:
        score = 92
    elif normalized_speed > 2.0:
        score = 78
    elif normalized_speed > 1.2:
        score = 60
    elif normalized_speed > 0.6:
        score = 45
    else:
        score = 25

    return clamp(score), round(max_speed, 2)


def calc_contact_point(frames_data: List[Dict], phases: Dict, is_left_handed: bool) -> Tuple[int, float]:
    """Check arm extension at contact."""
    contact = phases['contact_frame']
    n = len(frames_data)
    contact = min(contact, n - 1)

    hit_s = L_SHOULDER if is_left_handed else R_SHOULDER
    hit_e = L_ELBOW if is_left_handed else R_ELBOW
    hit_w = L_WRIST if is_left_handed else R_WRIST

    # Check arm extension at contact
    kp = frames_data[contact]['keypoints']
    if kp[hit_s, 2] < 0.3 or kp[hit_e, 2] < 0.3 or kp[hit_w, 2] < 0.3:
        return 50, 0.0

    arm_angle = angle_between(kp[hit_s, :2], kp[hit_e, :2], kp[hit_w, :2])

    # Full extension = ~170-180 degrees
    score = 0
    if arm_angle >= 170:
        score += 60
    elif arm_angle >= 155:
        score += 45
    elif arm_angle >= 130:
        score += 30
    else:
        score += 10

    # Check contact height relative to peak
    peak = phases['jump_peak']
    peak_hip_y = phases['hip_ys'][peak]
    contact_hip_y = phases['hip_ys'][contact]
    person_height = phases['person_height']

    height_diff = abs(peak_hip_y - contact_hip_y) / person_height if person_height > 0 else 0

    if height_diff < 0.05:
        score += 40
    elif height_diff < 0.15:
        score += 30
    elif height_diff < 0.30:
        score += 15
    else:
        score += 5

    return clamp(score), round(arm_angle, 1)


def calc_wrist_snap(frames_data: List[Dict], phases: Dict, is_left_handed: bool, fps: float) -> Tuple[int, float]:
    """Measure wrist angular velocity after contact."""
    contact = phases['contact_frame']
    n = len(frames_data)
    ft_end = phases['follow_through_end']

    hit_s = L_SHOULDER if is_left_handed else R_SHOULDER
    hit_e = L_ELBOW if is_left_handed else R_ELBOW
    hit_w = L_WRIST if is_left_handed else R_WRIST

    # Track wrist direction changes after contact
    angles_after = []
    for i in range(contact, min(ft_end + 1, n - 1)):
        kp = frames_data[i]['keypoints']
        if kp[hit_s, 2] < 0.3 or kp[hit_e, 2] < 0.3 or kp[hit_w, 2] < 0.3:
            angles_after.append(None)
            continue
        angle = angle_of_line(kp[hit_e, :2], kp[hit_w, :2])
        angles_after.append(angle)

    # Clean up Nones
    valid_angles = [(i, a) for i, a in enumerate(angles_after) if a is not None]
    if len(valid_angles) < 3:
        return 50, 0.0

    # Calculate angular velocities
    ang_velocities = []
    for j in range(1, len(valid_angles)):
        di = valid_angles[j][0] - valid_angles[j - 1][0]
        da = valid_angles[j][1] - valid_angles[j - 1][1]
        if di > 0:
            ang_velocities.append(abs(da / di) * fps)

    if not ang_velocities:
        return 50, 0.0

    max_ang_vel = float(np.max(ang_velocities))

    # Score: faster snap = better
    if max_ang_vel > 500:
        score = 90
    elif max_ang_vel > 300:
        score = 75
    elif max_ang_vel > 150:
        score = 55
    else:
        score = 35

    return clamp(score), round(max_ang_vel, 2)


def calc_contact_height(frames_data: List[Dict], phases: Dict, is_left_handed: bool) -> Tuple[int, float]:
    """Wrist height at contact relative to peak jump."""
    contact = phases['contact_frame']
    peak = phases['jump_peak']
    n = len(frames_data)
    contact = min(contact, n - 1)
    peak = min(peak, n - 1)

    hit_w = L_WRIST if is_left_handed else R_WRIST

    kp_contact = frames_data[contact]['keypoints']
    kp_peak = frames_data[peak]['keypoints']

    if kp_contact[hit_w, 2] < 0.3 or kp_peak[hit_w, 2] < 0.3:
        # Fallback to hip_y
        peak_hip_y = phases['hip_ys'][peak]
        contact_hip_y = phases['hip_ys'][contact]
        person_height = phases['person_height']
        height_diff = (contact_hip_y - peak_hip_y) / person_height if person_height > 0 else 0
    else:
        # Use actual wrist height
        contact_wrist_y = kp_contact[hit_w, 1]
        # Find max wrist height around peak
        wrist_ys = []
        for i in range(max(0, peak - 5), min(n, peak + 6)):
            kp = frames_data[i]['keypoints']
            if kp[hit_w, 2] > 0.3:
                wrist_ys.append(kp[hit_w, 1])
        if wrist_ys:
            min_wrist_y = min(wrist_ys)  # Highest point = lowest y
            person_height = phases['person_height']
            height_diff = (contact_wrist_y - min_wrist_y) / person_height if person_height > 0 else 0
        else:
            height_diff = 0.1

    # Score: closer to 0 (contact at peak) = better
    if height_diff < 0.05:
        score = 95
    elif height_diff < 0.15:
        score = 80
    elif height_diff < 0.30:
        score = 60
    elif height_diff < 0.50:
        score = 40
    else:
        score = 25

    return clamp(score), round(height_diff, 3)


def calc_follow_through(frames_data: List[Dict], phases: Dict, is_left_handed: bool) -> Tuple[int, float]:
    """Track hitting arm follow-through path."""
    contact = phases['contact_frame']
    ft_end = phases['follow_through_end']
    n = len(frames_data)

    hit_w = L_WRIST if is_left_handed else R_WRIST
    off_hip = R_HIP if is_left_handed else L_HIP

    if ft_end <= contact:
        return 50, 0.0

    # Track wrist path after contact
    wrist_positions = []
    for i in range(contact, min(ft_end + 1, n)):
        kp = frames_data[i]['keypoints']
        if kp[hit_w, 2] > 0.3:
            wrist_positions.append(kp[hit_w, :2].copy())

    if len(wrist_positions) < 2:
        return 50, 0.0

    # Measure how far wrist travels
    total_travel = 0
    for i in range(1, len(wrist_positions)):
        total_travel += dist(wrist_positions[i], wrist_positions[i - 1])

    # Check if wrist crosses body midline
    # Get hip center x at contact
    kp_contact = frames_data[min(contact, n - 1)]['keypoints']
    if kp_contact[L_HIP, 2] > 0.3 and kp_contact[R_HIP, 2] > 0.3:
        midline_x = midpoint(kp_contact[L_HIP, :2], kp_contact[R_HIP, :2])[0]
    else:
        midline_x = wrist_positions[0][0]

    # Check if any wrist position crosses midline
    crosses_midline = False
    for wp in wrist_positions:
        if abs(wp[0] - midline_x) < phases['person_height'] * 0.1:
            crosses_midline = True
            break

    person_height = phases['person_height']
    normalized_travel = total_travel / person_height if person_height > 0 else 0

    score = 0
    # Good follow-through: significant travel
    if normalized_travel > 1.5:
        score += 45
    elif normalized_travel > 0.8:
        score += 35
    elif normalized_travel > 0.4:
        score += 20
    else:
        score += 10

    # Crossing midline
    if crosses_midline:
        score += 35
    else:
        # Check if wrist at least moves toward midline
        if wrist_positions:
            final_x = wrist_positions[-1][0]
            start_x = wrist_positions[0][0]
            moved_toward = abs(final_x - midline_x) < abs(start_x - midline_x)
            if moved_toward:
                score += 20
            else:
                score += 5

    # Downward motion at end (wrist should finish low)
    if len(wrist_positions) >= 2:
        if wrist_positions[-1][1] > wrist_positions[0][1]:
            score += 20
        else:
            score += 5

    return clamp(score), round(normalized_travel, 3)


def calc_landing_balance(frames_data: List[Dict], phases: Dict) -> Tuple[int, float]:
    """Check landing balance after jump."""
    peak = phases['jump_peak']
    n = len(frames_data)
    person_height = phases['person_height']

    # Find landing: frames after peak where hip_y returns near max
    if peak >= n - 3:
        return 50, 0.0

    # Search for landing (hip_y rising back to near approach level)
    peak_hip_y = phases['hip_ys'][peak]
    approach_hip_y = phases['hip_ys'][phases['plant_frame']]
    landing_frame = peak

    for i in range(peak + 1, n):
        if phases['hip_ys'][i] >= approach_hip_y - person_height * 0.05:
            landing_frame = i
            break
    else:
        landing_frame = n - 1

    if landing_frame >= n:
        landing_frame = n - 1

    kp = frames_data[landing_frame]['keypoints']

    score = 0

    # Check knee angle at landing (should be bent < 160)
    knee_scores = []
    for knee_idx, ankle_idx, hip_idx in [(L_KNEE, L_ANKLE, L_HIP), (R_KNEE, R_ANKLE, R_HIP)]:
        if kp[knee_idx, 2] > 0.3 and kp[ankle_idx, 2] > 0.3 and kp[hip_idx, 2] > 0.3:
            knee_angle = angle_between(kp[hip_idx, :2], kp[knee_idx, :2], kp[ankle_idx, :2])
            if knee_angle < 160:
                knee_scores.append(80)
            elif knee_angle < 175:
                knee_scores.append(55)
            else:
                knee_scores.append(30)

    if knee_scores:
        score += int(np.mean(knee_scores))
    else:
        score += 30

    # Check hip level (both hips should be roughly level)
    if kp[L_HIP, 2] > 0.3 and kp[R_HIP, 2] > 0.3:
        hip_diff = abs(kp[L_HIP, 1] - kp[R_HIP, 1])
        if hip_diff < person_height * 0.03:
            score += 20
        elif hip_diff < person_height * 0.08:
            score += 12
        else:
            score += 5

    # Both feet visible
    if kp[L_ANKLE, 2] > 0.3 and kp[R_ANKLE, 2] > 0.3:
        score += 15
    elif kp[L_ANKLE, 2] > 0.3 or kp[R_ANKLE, 2] > 0.3:
        score += 8

    return clamp(score), 0.0


# ─── Feedback Generation ─────────────────────────────────────────────────────

def generate_phase_feedback(phase_name: str, scores: Dict[str, int], score_value: int) -> str:
    """Generate 2-3 sentence specific feedback for a phase."""
    if phase_name == "approach":
        speed = scores.get('approach_speed', 50)
        angle = scores.get('approach_angle', 50)
        rhythm = scores.get('footwork_rhythm', 50)
        arms = scores.get('arms_swing_back', 50)
        step = scores.get('last_step_length', 50)

        feedback_parts = []
        if speed < 60:
            feedback_parts.append("Your approach speed is below optimal, limiting momentum for the jump. Try taking more explosive, longer strides in your final three steps.")
        elif speed > 85:
            feedback_parts.append("Excellent approach speed that generates strong momentum for your jump.")
        else:
            feedback_parts.append("Your approach speed is moderate. Focus on gradually accelerating through your final three steps to build more momentum.")

        if angle < 60:
            feedback_parts.append("The approach angle could be more diagonal to the net, around 45 degrees, to better load your hitting shoulder.")
        elif rhythm < 60:
            feedback_parts.append("Work on a more consistent, accelerating footwork rhythm (slow-to-fast pattern) in your approach.")

        if arms < 55:
            feedback_parts.append("Your arms aren't swinging back far enough during the approach, which reduces jump power. Focus on a full armswing back past your hips.")

        if not feedback_parts:
            feedback_parts.append("Your approach shows good fundamentals with solid speed and direction. Continue refining the rhythm and arm mechanics for even more power.")

        return " ".join(feedback_parts[:3])

    elif phase_name == "jump":
        vjc = scores.get('vertical_jump_conversion', 50)
        rot = scores.get('hip_shoulder_rotation', 50)
        body = scores.get('body_position_air', 50)

        feedback_parts = []
        if vjc < 60:
            feedback_parts.append("Your jump isn't converting enough horizontal momentum into vertical height. Focus on a more explosive plant step with a deep knee bend.")
        elif vjc > 85:
            feedback_parts.append("Great conversion of approach speed into vertical jump height.")

        if rot < 55:
            feedback_parts.append("Increase hip-shoulder separation during your jump to generate more rotational torque for a powerful swing.")
        elif rot > 85:
            feedback_parts.append("Excellent hip-shoulder rotation creating strong torque for the swing.")

        if body < 55:
            feedback_parts.append("Work on maintaining better body position in the air, with a slight arch and your hitting arm loaded back ready to swing.")
        elif body > 85:
            feedback_parts.append("Your body position at peak jump is excellent, setting up a powerful attack position.")

        if not feedback_parts:
            feedback_parts.append("Your jump mechanics are solid. Focus on maximizing both height and rotation to increase hitting power.")

        return " ".join(feedback_parts[:3])

    elif phase_name == "contact":
        bow = scores.get('bow_and_arrow', 50)
        arm_spd = scores.get('arm_swing_speed', 50)
        contact_pt = scores.get('contact_point', 50)
        wrist_snap = scores.get('wrist_snap', 50)
        contact_h = scores.get('contact_height', 50)

        feedback_parts = []
        if bow < 55:
            feedback_parts.append("Your bow-and-arrow loading position needs improvement. Focus on getting your hitting elbow high and back with the wrist behind your head before swinging.")
        elif bow > 85:
            feedback_parts.append("Excellent bow-and-arrow loading position that maximizes power potential.")

        if arm_spd < 55:
            feedback_parts.append("Your arm swing speed is below optimal. Work on a faster, more whip-like swing starting from a loaded position.")
        elif arm_spd > 85:
            feedback_parts.append("Impressive arm swing speed generating excellent hitting power.")

        if contact_pt < 60:
            feedback_parts.append("Focus on reaching full arm extension at contact and hitting at the peak of your jump for maximum power and court coverage.")
        elif wrist_snap < 60:
            feedback_parts.append("Add more wrist snap at contact to generate topspin and make the ball harder to pass.")

        if not feedback_parts:
            feedback_parts.append("Your contact mechanics are strong with good arm speed and extension. Fine-tune your wrist snap for added spin and control.")

        return " ".join(feedback_parts[:3])

    elif phase_name == "followThrough":
        ft = scores.get('follow_through', 50)
        landing = scores.get('landing_balance', 50)

        feedback_parts = []
        if ft < 55:
            feedback_parts.append("Your follow-through is cut short. Let your hitting arm continue across your body toward the opposite hip after contact for better ball control and power transfer.")
        elif ft > 85:
            feedback_parts.append("Great follow-through with your arm fully extending across your body.")

        if landing < 55:
            feedback_parts.append("Work on landing with bent knees and balanced footing to reduce injury risk and prepare for the next play. Land with both feet and absorb the impact through your legs.")
        elif landing > 85:
            feedback_parts.append("Excellent balanced landing with proper knee bend, ready for the next play.")

        if not feedback_parts:
            feedback_parts.append("Your follow-through and landing are fundamentally sound. Keep focusing on a full arm swing through and soft, balanced landings.")

        return " ".join(feedback_parts[:3])

    return "Keep working on the fundamentals of this phase."


def generate_strengths_weaknesses(scores: Dict[str, int]) -> Tuple[List[str], List[str]]:
    """Generate top 3 strengths and weaknesses."""
    checkpoints = {
        'approach_speed': 'Approach Speed',
        'approach_angle': 'Approach Angle',
        'last_step_length': 'Last Step Length',
        'footwork_rhythm': 'Footwork Rhythm',
        'arms_swing_back': 'Arms Swing Back',
        'vertical_jump_conversion': 'Vertical Jump Conversion',
        'hip_shoulder_rotation': 'Hip-Shoulder Rotation',
        'body_position_air': 'Body Position in Air',
        'bow_and_arrow': 'Bow and Arrow Load',
        'arm_swing_speed': 'Arm Swing Speed',
        'contact_point': 'Contact Point',
        'wrist_snap': 'Wrist Snap',
        'contact_height': 'Contact Height',
        'follow_through': 'Follow Through',
        'landing_balance': 'Landing Balance',
    }

    explanations = {
        'approach_speed': 'generates strong momentum for the jump',
        'approach_angle': 'creates optimal diagonal path to the net',
        'last_step_length': 'provides a powerful braking step for the jump',
        'footwork_rhythm': 'builds acceleration effectively with a slow-to-fast pattern',
        'arms_swing_back': 'loads energy for a higher vertical jump',
        'vertical_jump_conversion': 'efficiently converts horizontal speed into vertical height',
        'hip_shoulder_rotation': 'creates torque for a powerful arm swing',
        'body_position_air': 'sets up an optimal athletic hitting position',
        'bow_and_arrow': 'maximizes power potential with proper arm loading',
        'arm_swing_speed': 'generates exceptional hitting power',
        'contact_point': 'ensures maximum power and court coverage at the ball',
        'wrist_snap': 'adds topspin for a harder ball to pass',
        'contact_height': 'hits the ball at the highest possible point',
        'follow_through': 'ensures full power transfer and ball control',
        'landing_balance': 'reduces injury risk and prepares for the next play',
    }

    weak_explanations = {
        'approach_speed': 'limits momentum, reducing jump height and hitting power',
        'approach_angle': 'reduces the ability to load the hitting shoulder properly',
        'last_step_length': 'limits the braking force needed for a powerful jump',
        'footwork_rhythm': 'reduces approach efficiency and jump timing',
        'arms_swing_back': 'loses energy that could add height to the jump',
        'vertical_jump_conversion': 'wastes approach momentum instead of converting it to jump height',
        'hip_shoulder_rotation': 'limits rotational power for the arm swing',
        'body_position_air': 'reduces hitting power and control at contact',
        'bow_and_arrow': 'limits power potential by not loading the arm properly',
        'arm_swing_speed': 'reduces hitting power significantly',
        'contact_point': 'loses power and reduces the ability to hit over the block',
        'wrist_snap': 'results in flat hits that are easier to dig',
        'contact_height': 'allows blockers to reach the ball more easily',
        'follow_through': 'reduces power transfer and ball control',
        'landing_balance': 'increases injury risk and slows transition to next play',
    }

    sorted_items = sorted(scores.items(), key=lambda x: x[1], reverse=True)

    strengths = []
    for key, val in sorted_items[:3]:
        name = checkpoints.get(key, key)
        expl = explanations.get(key, 'shows good execution')
        strengths.append(f"{name}: {expl}")

    weaknesses = []
    for key, val in sorted_items[-3:]:
        name = checkpoints.get(key, key)
        expl = weak_explanations.get(key, 'needs improvement')
        weaknesses.append(f"{name}: {expl}")

    weaknesses.reverse()

    return strengths, weaknesses


def generate_coach_notes(scores: Dict[str, int], estimated_level: str) -> str:
    """Generate 3-5 sentences of coaching advice."""
    sorted_items = sorted(scores.items(), key=lambda x: x[1])

    weakest = sorted_items[:3]
    strongest = sorted_items[-3:]

    notes = ""

    if estimated_level in ['beginner', 'intermediate']:
        notes = f"Focus on building a consistent approach with accelerating footwork and a full armswing to maximize your jump height. "
        weak_names = [k.replace('_', ' ') for k, v in weakest]
        if weak_names:
            notes += f"Your main areas for improvement are {', '.join(weak_names)}. "
        notes += "Work on these fundamentals before adding more advanced techniques like increased rotation or arm speed. "
        notes += "Film yourself regularly and compare to elite hitters to develop a visual model of proper technique."
    elif estimated_level == 'advanced':
        weak_names = [k.replace('_', ' ') for k, v in weakest[:2]]
        notes = f"You have solid fundamentals with room to refine your technique for maximum power. "
        if weak_names:
            notes += f"Focus specifically on improving {', '.join(weak_names)} to take your hitting to the next level. "
        notes += "At this level, small mechanical improvements translate to significant performance gains. "
        notes += "Consider working with a coach on video analysis to fine-tune these specific areas."
    else:
        notes = "Your technique is at an elite level with strong mechanics across most checkpoints. "
        weak_names = [k.replace('_', ' ') for k, v in weakest[:2]]
        if weak_names:
            notes += f"Even at this level, continue refining {', '.join(weak_names)} to maintain consistency. "
        notes += "Focus on maintaining these mechanics under game pressure and fatigue conditions. "
        notes += "Use this analysis as a baseline for tracking mechanical consistency across matches and training sessions."

    return notes


def estimate_level(avg_score: float) -> str:
    if avg_score >= 82:
        return 'elite'
    elif avg_score >= 65:
        return 'advanced'
    elif avg_score >= 45:
        return 'intermediate'
    else:
        return 'beginner'


def estimate_approach_speed_label(score: int) -> str:
    if score >= 85:
        return 'explosive'
    elif score >= 65:
        return 'fast'
    elif score >= 45:
        return 'moderate'
    else:
        return 'slow'


# ─── Main Analysis Function ──────────────────────────────────────────────────

def analyze_video(video_path: str) -> Dict[str, Any]:
    """Main analysis function."""
    # Extract keypoints
    frames_data, fps, duration, width, height = extract_keypoints(video_path)

    if not frames_data:
        raise ValueError("No person detected in video. Ensure the video shows a clear view of a volleyball player spiking.")

    # Track player
    frames_data = track_player(frames_data)

    # Interpolate missing keypoints
    frames_data = interpolate_missing(frames_data)

    if len(frames_data) < 5:
        raise ValueError(f"Too few frames with valid detections ({len(frames_data)}). Need at least 5 frames for analysis.")

    # Detect handedness
    is_left_handed = detect_handedness(frames_data)

    # Detect phases
    phases = detect_phases(frames_data, fps, is_left_handed)

    # Compute all metrics
    scores = {}

    # Approach phase
    s, m = calc_approach_speed(frames_data, phases, fps)
    scores['approach_speed'] = s
    approach_speed_val = m

    s, m = calc_approach_angle(frames_data, phases)
    scores['approach_angle'] = s

    s, m = calc_last_step_length(frames_data, phases, is_left_handed)
    scores['last_step_length'] = s

    s, m = calc_footwork_rhythm(frames_data, phases, fps)
    scores['footwork_rhythm'] = s

    s, m = calc_arms_swing_back(frames_data, phases, is_left_handed)
    scores['arms_swing_back'] = s

    # Jump phase
    s, m = calc_vertical_jump_conversion_impl(frames_data, phases, fps)
    scores['vertical_jump_conversion'] = s
    max_jump_height = abs(phases['hip_ys'][phases['plant_frame']] - phases['hip_ys'][phases['jump_peak']])

    s, m = calc_hip_shoulder_rotation(frames_data, phases)
    scores['hip_shoulder_rotation'] = s
    peak_rotation = m

    s, m = calc_body_position_air(frames_data, phases)
    scores['body_position_air'] = s

    # Contact phase
    s, m = calc_bow_and_arrow(frames_data, phases, is_left_handed)
    scores['bow_and_arrow'] = s

    s, m = calc_arm_swing_speed(frames_data, phases, is_left_handed, fps)
    scores['arm_swing_speed'] = s
    max_wrist_speed = m

    s, m = calc_contact_point(frames_data, phases, is_left_handed)
    scores['contact_point'] = s

    s, m = calc_wrist_snap(frames_data, phases, is_left_handed, fps)
    scores['wrist_snap'] = s

    s, m = calc_contact_height(frames_data, phases, is_left_handed)
    scores['contact_height'] = s

    # Follow-through phase
    s, m = calc_follow_through(frames_data, phases, is_left_handed)
    scores['follow_through'] = s

    s, m = calc_landing_balance(frames_data, phases)
    scores['landing_balance'] = s

    # Phase scores
    approach_score = int(np.mean([
        scores['approach_speed'], scores['approach_angle'],
        scores['last_step_length'], scores['footwork_rhythm'],
        scores['arms_swing_back']
    ]))

    jump_score = int(np.mean([
        scores['vertical_jump_conversion'], scores['hip_shoulder_rotation'],
        scores['body_position_air']
    ]))

    contact_score = int(np.mean([
        scores['bow_and_arrow'], scores['arm_swing_speed'],
        scores['contact_point'], scores['wrist_snap'],
        scores['contact_height']
    ]))

    ft_score = int(np.mean([
        scores['follow_through'], scores['landing_balance']
    ]))

    avg_score = float(np.mean(list(scores.values())))

    phase_analysis = {
        'approach': {
            'score': clamp(approach_score),
            'feedback': generate_phase_feedback('approach', scores, approach_score)
        },
        'jump': {
            'score': clamp(jump_score),
            'feedback': generate_phase_feedback('jump', scores, jump_score)
        },
        'contact': {
            'score': clamp(contact_score),
            'feedback': generate_phase_feedback('contact', scores, contact_score)
        },
        'followThrough': {
            'score': clamp(ft_score),
            'feedback': generate_phase_feedback('followThrough', scores, ft_score)
        }
    }

    strengths, weaknesses = generate_strengths_weaknesses(scores)

    level = estimate_level(avg_score)
    approach_speed_label = estimate_approach_speed_label(scores['approach_speed'])
    coach_notes = generate_coach_notes(scores, level)
    overall_power = clamp(int(np.mean([
        scores['approach_speed'], scores['arm_swing_speed'],
        scores['vertical_jump_conversion'], scores['bow_and_arrow'],
        scores['hip_shoulder_rotation'], scores['contact_point']
    ])))

    result = {
        'scores': {k: clamp(v) for k, v in scores.items()},
        'phaseAnalysis': phase_analysis,
        'topStrengths': strengths,
        'topWeaknesses': weaknesses,
        'coachNotes': coach_notes,
        'estimatedLevel': level,
        'estimatedApproachSpeed': approach_speed_label,
        'overallPower': overall_power,
        'metrics': {
            'max_jump_height_px': round(max_jump_height, 2),
            'approach_speed_px_per_sec': round(approach_speed_val, 2),
            'max_wrist_speed_px_per_sec': round(max_wrist_speed, 2),
            'peak_hip_shoulder_angle_deg': round(peak_rotation, 1),
            'frames_analyzed': len(frames_data),
            'video_fps': round(fps, 2),
            'video_duration_sec': round(duration, 2),
        }
    }

    return result


def convert_to_native(obj):
    """Recursively convert numpy types to Python native types for JSON serialization."""
    if isinstance(obj, dict):
        return {k: convert_to_native(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [convert_to_native(v) for v in obj]
    elif isinstance(obj, (np.integer,)):
        return int(obj)
    elif isinstance(obj, (np.floating,)):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return convert_to_native(obj.tolist())
    elif isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python3 spike_pose_analysis.py <video_path> [output_json_path]"}))
        sys.exit(1)

    video_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    if not os.path.isfile(video_path):
        print(json.dumps({"error": f"Video file not found: {video_path}"}))
        sys.exit(1)

    try:
        result = analyze_video(video_path)
        result = convert_to_native(result)
        output_json = json.dumps(result, indent=2)

        # Print to stdout
        print(output_json)

        # Write to file if path provided
        if output_path:
            os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True) if os.path.dirname(output_path) else None
            with open(output_path, 'w') as f:
                f.write(output_json)

    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"error": error_msg}))
        sys.exit(1)


if __name__ == '__main__':
    main()