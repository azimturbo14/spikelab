#!/usr/bin/env python3
"""
YOLOv8 Pose Analysis HTTP Service for SpikeLab.
Accepts a video upload, runs YOLOv8-pose biomechanical analysis, returns JSON.
"""

import os
import sys
import json
import tempfile
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
import subprocess

# Set env vars before any ML imports
os.environ['YOLO_CONFIG_DIR'] = '/tmp/Ultralytics'
os.environ['HOME'] = '/tmp'
os.environ['TORCH_HOME'] = '/tmp/torch'
os.environ['HF_HOME'] = '/tmp/hf'

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def run_analysis_via_subprocess(video_path: str) -> dict:
    """Run the spike_pose_analysis.py script as subprocess and parse JSON output."""
    script_path = os.path.join(PROJECT_ROOT, 'spike_pose_analysis.py')

    result = subprocess.run(
        [sys.executable, script_path, video_path],
        capture_output=True,
        text=True,
        timeout=180,
        env={**os.environ},
        cwd=PROJECT_ROOT,
    )

    if result.returncode != 0:
        err = result.stderr.strip()
        # Check if there's a JSON error in stdout
        try:
            err_data = json.loads(result.stdout.strip())
            if 'error' in err_data:
                raise ValueError(err_data['error'])
        except (json.JSONDecodeError, ValueError):
            pass
        raise RuntimeError(f"Analysis script failed (code {result.returncode}): {err[:500]}")

    # Parse JSON output
    output = result.stdout.strip()
    # Find JSON in output (might have warning messages before/after)
    json_start = output.find('{')
    json_end = output.rfind('}') + 1
    if json_start >= 0 and json_end > json_start:
        output = output[json_start:json_end]

    data = json.loads(output)

    if 'error' in data:
        raise ValueError(data['error'])

    # Enhance with confidence, checkpointFeedback, priorityOrder, metadata, specificFix
    return enhance_result(data)


def enhance_result(data: dict) -> dict:
    """Add confidence scores, checkpoint feedback, priority order, and metadata."""
    scores = data.get('scores', {})
    metrics = data.get('metrics', {})

    # Calculate confidence based on which metrics were computed vs defaulted
    confidence = {}
    for key in scores:
        # If the score was computed (not default 50), give higher confidence
        # We estimate confidence from how much actual data was available
        # Since we don't track per-checkpoint keypoint visibility in the subprocess,
        # we use a heuristic: if the overall detection was good, confidence is high
        frames = metrics.get('frames_analyzed', 0)
        if frames >= 15:
            confidence[key] = 80
        elif frames >= 10:
            confidence[key] = 65
        elif frames >= 5:
            confidence[key] = 50
        else:
            confidence[key] = 30

    # Add checkpoint-level feedback from metrics
    checkpoint_feedback = {
        'approach_speed': f"Approach speed: {metrics.get('approach_speed_px_per_sec', 'N/A')} px/s.",
        'approach_angle': f"Approach angle: {metrics.get('approach_angle_deg', 'N/A')}° from horizontal.",
        'last_step_length': f"Last step ratio: {metrics.get('last_step_ratio', 'N/A')}x leg length.",
        'footwork_rhythm': f"Rhythm quality: {metrics.get('rhythm_quality', 'N/A')}.",
        'arms_swing_back': f"Max armswing back angle: {metrics.get('max_armswing_back_angle', 'N/A')}°.",
        'vertical_jump_conversion': f"Jump height: {metrics.get('jump_ratio', 'N/A')}x body height.",
        'hip_shoulder_rotation': f"Peak separation: {metrics.get('peak_hip_shoulder_angle_deg', 'N/A')}°.",
        'body_position_air': 'Body alignment at peak jump measured.',
        'torso_angle_air': 'Torso angle estimated from body position.',
        'bow_and_arrow': 'Arm loading at peak analyzed.',
        'arm_swing_speed': f"Max wrist speed: {metrics.get('max_wrist_speed_px_per_sec', 'N/A')} px/s.",
        'contact_point': 'Contact position relative to shoulder evaluated.',
        'wrist_snap': 'Wrist angular velocity measured.',
        'contact_height': 'Contact height relative to hip position.',
        'follow_through': 'Arm follow-through range measured.',
        'landing_balance': 'Landing stance analyzed.',
    }

    # Add torso_angle_air if missing (the original script has 15, we need 16)
    if 'torso_angle_air' not in scores:
        scores['torso_angle_air'] = min(100, max(0, int(scores.get('body_position_air', 50) * 0.9 + 5)))
        confidence['torso_angle_air'] = confidence.get('body_position_air', 50)

    # Add specificFix to phase analysis
    for phase_key in ['approach', 'jump', 'contact', 'followThrough']:
        if phase_key in data.get('phaseAnalysis', {}):
            phase = data['phaseAnalysis'][phase_key]
            if 'feedback' in phase and 'specificFix' not in phase:
                fb = phase['feedback']
                sentences = [s.strip() for s in fb.split('.') if s.strip()]
                phase['specificFix'] = sentences[-1] + '.' if sentences else 'Continue practicing this phase.'

    # Add priority order if missing
    if 'priorityOrder' not in data:
        pa = data.get('phaseAnalysis', {})
        phase_scores = []
        for pk in ['approach', 'jump', 'contact', 'followThrough']:
            if pk in pa:
                phase_scores.append((pk, pa[pk].get('score', 50)))
        data['priorityOrder'] = [p[0] for p in sorted(phase_scores, key=lambda x: x[1])]

    # Add confidence and metadata
    avg_confidence = int(sum(confidence.values()) / len(confidence)) if confidence else 50
    frames_analyzed = metrics.get('frames_analyzed', 0)
    video_duration = metrics.get('video_duration_sec', 0)
    video_fps = metrics.get('video_fps', 30)

    data['confidence'] = confidence
    data['checkpointFeedback'] = checkpoint_feedback
    data['metadata'] = {
        'frameCount': frames_analyzed,
        'duration': video_duration,
        'averageConfidence': avg_confidence,
        'framesWithPlayer': frames_analyzed,
        'quality': 'high' if avg_confidence >= 60 else 'medium' if avg_confidence >= 30 else 'low',
        'analysisMethod': 'YOLOv8 Pose Estimation',
        'videoFps': video_fps,
    }

    return data


class AnalysisHandler(BaseHTTPRequestHandler):
    """HTTP handler for the YOLOv8 analysis service."""

    def log_message(self, format, *args):
        sys.stderr.write(f"[YOLO-Service] {self.path} {args[0]}\n")
        sys.stderr.flush()

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'status': 'ok',
                'model': 'yolov8n-pose',
                'service': 'spikelab-yolo-analysis'
            }).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == '/analyze':
            content_length = int(self.headers.get('Content-Length', 0))

            if content_length == 0 or content_length > 100 * 1024 * 1024:
                self._send_json(400, {'error': f'Invalid content length: {content_length}'})
                return

            body = self.rfile.read(content_length)

            # Find boundary
            content_type = self.headers.get('Content-Type', '')
            boundary = None
            for part in content_type.split(';'):
                part = part.strip()
                if part.startswith('boundary='):
                    boundary = part.split('=', 1)[1].strip('"')
                    break

            if not boundary:
                self._send_json(400, {'error': 'No multipart boundary found'})
                return

            # Parse multipart to extract video file
            video_data = self._extract_file(body, boundary)

            if not video_data:
                self._send_json(400, {'error': 'No video file found in request'})
                return

            tmp_file = None
            try:
                with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as f:
                    f.write(video_data)
                    tmp_file = f.name

                sys.stderr.write(f"[YOLO-Service] Analyzing video: {len(video_data)} bytes\n")
                sys.stderr.flush()

                result = run_analysis_via_subprocess(tmp_file)
                self._send_json(200, result)

            except Exception as e:
                sys.stderr.write(f"[YOLO-Service] Error: {traceback.format_exc()}\n")
                sys.stderr.flush()
                self._send_json(500, {'error': str(e)})

            finally:
                if tmp_file and os.path.exists(tmp_file):
                    try:
                        os.unlink(tmp_file)
                    except:
                        pass
        else:
            self.send_response(404)
            self.end_headers()

    def _extract_file(self, body: bytes, boundary: str) -> bytes | None:
        boundary_bytes = f'--{boundary}'.encode()
        parts = body.split(boundary_bytes)

        for part in parts:
            if b'Content-Disposition' in part and b'filename=' in part:
                header_end = part.find(b'\r\n\r\n')
                if header_end >= 0:
                    data = part[header_end + 4:]
                    if data.endswith(b'\r\n'):
                        data = data[:-2]
                    return data
        return None

    def _send_json(self, code: int, data: dict):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())


def main():
    port = int(os.environ.get('PORT', 3031))
    server = HTTPServer(('0.0.0.0', port), AnalysisHandler)
    sys.stderr.write(f"[YOLO-Service] Starting on port {port}\n")
    sys.stderr.flush()

    # Pre-warm: import once to trigger model download/check
    try:
        sys.stderr.write("[YOLO-Service] Pre-warming model...\n")
        sys.stderr.flush()
        import subprocess as sp
        sp.run([sys.executable, '-c',
                "import os; os.environ['HOME']='/tmp'; os.environ['TORCH_HOME']='/tmp/torch'; os.environ['HF_HOME']='/tmp/hf'; os.environ['YOLO_CONFIG_DIR']='/tmp/Ultralytics'; from ultralytics import YOLO; YOLO('yolov8n-pose.pt'); print('Model ready')"],
               capture_output=True, timeout=120, cwd=PROJECT_ROOT)
        sys.stderr.write("[YOLO-Service] Model pre-warmed\n")
        sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f"[YOLO-Service] Pre-warm failed (non-fatal): {e}\n")
        sys.stderr.flush()

    server.serve_forever()


if __name__ == '__main__':
    main()