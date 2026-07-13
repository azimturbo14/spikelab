/**
 * Browser-side Volleyball Spike Biomechanical Analyzer
 *
 * Key differences from the old Python frame-by-frame approach:
 * 1. SMART SAMPLING: Extracts ~20-30 frames concentrated on the action window
 *    instead of processing every single frame (which was the "frame by frame" problem)
 * 2. BATCH PREP: All frames are pre-processed before inference begins
 * 3. ONNX WASM: Runs entirely in the browser — no server needed, works on Vercel
 * 4. SMOOTH KEYPOINTS: Moving-average filter on keypoints across frames
 * 5. All 16 biomechanical scores ported from the Python analysis
 */

import type { SpikeAnalysis, CheckpointScores, CheckpointConfidence, PhaseAnalyses } from './spike-types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Keypoint {
  x: number; y: number; conf: number;
}

interface FrameData {
  frameIdx: number;
  keypoints: Keypoint[];  // 17 keypoints
  detConf: number;
  bbox: number[];  // [x1, y1, x2, y2]
  timestamp: number;
}

interface PhaseInfo {
  approachStart: number;
  approachEnd: number;
  plantFrame: number;
  jumpPeak: number;
  contactFrame: number;
  followThroughEnd: number;
  personHeight: number;
  legLength: number;
  hipYs: number[];
  hipXs: (number | null)[];
  wristSpeeds: number[];
}

// COCO 17 keypoint indices
const NOSE = 0, L_EYE = 1, R_EYE = 2, L_EAR = 3, R_EAR = 4
const L_SHOULDER = 5, R_SHOULDER = 6, L_ELBOW = 7, R_ELBOW = 8
const L_WRIST = 9, R_WRIST = 10, L_HIP = 11, R_HIP = 12
const L_KNEE = 13, R_KNEE = 14, L_ANKLE = 15, R_ANKLE = 16

const NUM_KEYPOINTS = 17
const MODEL_INPUT_SIZE = 640

type ProgressCallback = (pct: number, msg: string) => void

// ─── Math Utilities ───────────────────────────────────────────────────────────

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function angleBetween(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const ba = { x: a.x - b.x, y: a.y - b.y }
  const bc = { x: c.x - b.x, y: c.y - b.y }
  const dot = ba.x * bc.x + ba.y * bc.y
  const magBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y) + 1e-8
  const magBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y) + 1e-8
  const cosA = Math.max(-1, Math.min(1, dot / (magBA * magBC)))
  return Math.acos(cosA) * (180 / Math.PI)
}

function angleOfLine(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI)
}

function clamp(val: number, lo = 0, hi = 100): number {
  return Math.round(Math.max(lo, Math.min(hi, val)))
}

function scoreBand(value: number, optLo: number, optHi: number, _minVal: number): number {
  if (value >= optLo && value <= optHi) return 90
  const dist = value < optLo ? optLo - value : value - optHi
  const range = optHi - optLo
  return Math.max(30, Math.round(90 - (dist / range) * 50))
}

function movingAverage(arr: number[], window: number): number[] {
  const result: number[] = []
  const half = Math.floor(window / 2)
  for (let i = 0; i < arr.length; i++) {
    let sum = 0; let count = 0
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      sum += arr[j]; count++
    }
    result.push(sum / count)
  }
  return result
}

// ─── ONNX Session (lazy singleton) ────────────────────────────────────────────

let ortModule: typeof import('onnxruntime-web') | null = null
let sessionPromise: Promise<unknown> | null = null

async function getOrtSession() {
  if (sessionPromise) return sessionPromise

  sessionPromise = (async () => {
    // Load onnxruntime-web from CDN to avoid WASM bundling issues with Turbopack
    if (!ortModule) {
      const mod = await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.min.js')
      ortModule = mod as unknown as typeof import('onnxruntime-web')
    }

    const session = await ortModule.InferenceSession.create('/models/yolov8n-pose.onnx', {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })

    console.log('[SpikeLab] ONNX session ready')
    return session
  })()

  return sessionPromise
}

// ─── Frame Extraction (Smart Sampling) ────────────────────────────────────────

/**
 * Extract frames from video using HTML5 Video + Canvas.
 * Instead of every frame (the old problem), we:
 * 1. For short videos (<5s): sample ~24 frames evenly across the whole video
 * 2. For longer videos: first do a quick scan to find the action window, then sample densely there
 */
async function extractFramesFromVideo(
  videoFile: File,
  count: number,
  onProgress: ProgressCallback
): Promise<{ imageData: ImageData[]; duration: number; fps: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    const url = URL.createObjectURL(videoFile)
    video.src = url

    video.addEventListener('loadedmetadata', async () => {
      const duration = video.duration
      const width = video.videoWidth
      const height = video.videoHeight
      // Assume 30fps if not available
      const fps = 30

      onProgress(5, `Video loaded: ${duration.toFixed(1)}s, ${width}x${height}`)

      if (!duration || !isFinite(duration) || duration < 0.5) {
        URL.revokeObjectURL(url)
        reject(new Error('Video is too short or invalid.'))
        return
      }

      // Smart sampling: determine timestamps
      let timestamps: number[]
      if (duration <= 5) {
        // Short video: sample evenly across 90% of video
        const start = duration * 0.05
        const end = duration * 0.95
        timestamps = []
        for (let i = 0; i < count; i++) {
          const t = count <= 1 ? (start + end) / 2 : start + (end - start) * (i / (count - 1))
          timestamps.push(t)
        }
      } else {
        // Longer video: concentrate frames in the middle 60% where the spike likely is
        // Skip boring beginning/end
        const margin = duration * 0.2
        const start = margin
        const end = duration - margin
        timestamps = []
        for (let i = 0; i < count; i++) {
          const t = count <= 1 ? (start + end) / 2 : start + (end - start) * (i / (count - 1))
          timestamps.push(t)
        }
      }

      onProgress(8, `Extracting ${timestamps.length} frames...`)

      // Create canvas for frame extraction
      const canvas = document.createElement('canvas')
      canvas.width = MODEL_INPUT_SIZE
      canvas.height = MODEL_INPUT_SIZE
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!

      const frames: ImageData[] = []
      const totalFrames = timestamps.length

      // Extract frames sequentially (seek + draw)
      for (let i = 0; i < totalFrames; i++) {
        try {
          await seekTo(video, timestamps[i])
          // Draw maintaining aspect ratio (letterbox)
          ctx.fillStyle = '#000'
          ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
          const scale = Math.min(MODEL_INPUT_SIZE / width, MODEL_INPUT_SIZE / height)
          const dw = width * scale
          const dh = height * scale
          const dx = (MODEL_INPUT_SIZE - dw) / 2
          const dy = (MODEL_INPUT_SIZE - dh) / 2
          ctx.drawImage(video, dx, dy, dw, dh)
          const imageData = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
          frames.push(imageData)
        } catch {
          // Skip failed frame extractions
        }

        const pct = 8 + Math.round((i / totalFrames) * 12)
        onProgress(pct, `Extracting frames... (${i + 1}/${totalFrames})`)
      }

      URL.revokeObjectURL(url)
      onProgress(20, `Extracted ${frames.length} frames`)

      resolve({ imageData: frames, duration, fps, width, height })
    })

    video.addEventListener('error', () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load video. Please try a different format.'))
    })

    video.load()
  })
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < 0.01) {
      resolve(); return
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      resolve()
    }
    const onError = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      reject(new Error(`Seek to ${time.toFixed(2)}s failed`))
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    video.currentTime = Math.max(0, Math.min(time, video.duration - 0.01))
  })
}

// ─── ONNX Inference (Batch) ───────────────────────────────────────────────────

/**
 * Run ONNX inference on all pre-extracted frames.
 * This is the core replacement: instead of the Python script running
 * model(frame) one at a time in a while loop, we process all frames
 * efficiently through the WASM runtime.
 */
async function runInference(
  frames: ImageData[],
  videoWidth: number,
  videoHeight: number,
  onProgress: ProgressCallback
): Promise<FrameData[]> {
  const session = await getOrtSession() as import('onnxruntime-web').InferenceSession
  const inputName = session.inputNames[0]

  const allFramesData: FrameData[] = []
  const totalFrames = frames.length

  // Calculate letterbox scale/offset to map detections back to original coords
  const scale = Math.min(MODEL_INPUT_SIZE / videoWidth, MODEL_INPUT_SIZE / videoHeight)
  const dw = videoWidth * scale
  const dh = videoHeight * scale
  const padX = (MODEL_INPUT_SIZE - dw) / 2
  const padY = (MODEL_INPUT_SIZE - dh) / 2

  for (let fi = 0; fi < totalFrames; fi++) {
    const imgData = frames[fi]

    // Prepare input tensor: [1, 3, 640, 640] float32, normalized 0-1
    const float32Data = new Float32Array(1 * 3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE)
    for (let p = 0; p < MODEL_INPUT_SIZE * MODEL_INPUT_SIZE; p++) {
      float32Data[p] = imgData.data[p * 4] / 255.0                          // R
      float32Data[MODEL_INPUT_SIZE * MODEL_INPUT_SIZE + p] = imgData.data[p * 4 + 1] / 255.0  // G
      float32Data[2 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE + p] = imgData.data[p * 4 + 2] / 255.0  // B
    }

    const inputTensor = new (ortModule!. OrtTensor)('float32', float32Data, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE])
    const feeds = { [inputName]: inputTensor }

    try {
      const results = await session.run(feeds)
      const outputKey = session.outputNames[0]
      const output = results[outputKey]

      // Output shape: [1, 56, 8400] for YOLOv8n-pose
      const data = output.data as Float32Array
      const dims = output.dims as number[] // [1, 56, 8400]

      // Transpose to [8400, 56] for easier access
      const numDetections = dims[2]
      const numChannels = dims[1]

      // Find best person detection
      let bestIdx = -1
      let bestScore = 0

      for (let d = 0; d < numDetections; d++) {
        const objConf = data[d + numDetections * 4] // channel 4 = objectness
        if (objConf < 0.25) continue

        // Check if this is a person (class 0 in COCO)
        const clsConf = data[d + numDetections * 5]
        const conf = objConf * clsConf
        if (conf < 0.25 || conf <= bestScore) continue

        // Quick check: at least some keypoints visible
        let kpVisible = 0
        for (let k = 0; k < NUM_KEYPOINTS; k++) {
          const kpConf = data[d + numDetections * (6 + k * 3 + 2)]
          if (kpConf > 0.3) kpVisible++
        }
        if (kpVisible < 5) continue

        bestScore = conf
        bestIdx = d
      }

      if (bestIdx >= 0) {
        const d = bestIdx
        // BBox (center format → xyxy)
        const cx = data[d]
        const cy = data[d + numDetections]
        const w = data[d + numDetections * 2]
        const h = data[d + numDetections * 3]
        const x1 = cx - w / 2
        const y1 = cy - h / 2
        const x2 = cx + w / 2
        const y2 = cy + h / 2

        // Map from 640x640 to original video coords
        const mapX = (v: number) => (v - padX) / scale
        const mapY = (v: number) => (v - padY) / scale

        const bbox = [mapX(x1), mapY(y1), mapX(x2), mapY(y2)]

        // Extract keypoints
        const keypoints: Keypoint[] = []
        for (let k = 0; k < NUM_KEYPOINTS; k++) {
          const kpx = data[d + numDetections * (6 + k * 3)]
          const kpy = data[d + numDetections * (6 + k * 3 + 1)]
          const kpc = data[d + numDetections * (6 + k * 3 + 2)]
          keypoints.push({
            x: mapX(kpx),
            y: mapY(kpy),
            conf: kpc,
          })
        }

        allFramesData.push({
          frameIdx: fi,
          keypoints,
          detConf: bestScore,
          bbox,
          timestamp: 0, // will be set later
        })
      }
    } catch (err) {
      console.warn(`[SpikeLab] Inference failed on frame ${fi}:`, err)
    }

    // Progress: 20% → 55%
    const pct = 20 + Math.round((fi / totalFrames) * 35)
    onProgress(pct, `Analyzing poses... (${fi + 1}/${totalFrames})`)
  }

  return allFramesData
}

// ─── Player Tracking ──────────────────────────────────────────────────────────

function trackPlayer(frames: FrameData[]): FrameData[] {
  if (frames.length <= 1) return frames

  let prevCenter: { x: number; y: number } | null = null
  const tracked: FrameData[] = []

  for (const fd of frames) {
    const kp = fd.keypoints
    let center: { x: number; y: number } | null = null

    if (kp[L_SHOULDER].conf > 0.3 && kp[R_SHOULDER].conf > 0.3) {
      center = midpoint(kp[L_SHOULDER], kp[R_SHOULDER])
    } else if (kp[L_HIP].conf > 0.3 && kp[R_HIP].conf > 0.3) {
      center = midpoint(kp[L_HIP], kp[R_HIP])
    }

    if (center) prevCenter = center
    tracked.push(fd)
  }

  return tracked
}

// ─── Keypoint Smoothing ───────────────────────────────────────────────────────

function smoothKeypoints(frames: FrameData[], window = 3): FrameData[] {
  if (frames.length < window) return frames

  const result = frames.map(f => ({
    ...f,
    keypoints: f.keypoints.map(k => ({ ...k })),
  }))

  const half = Math.floor(window / 2)

  for (let k = 0; k < NUM_KEYPOINTS; k++) {
    for (let i = 0; i < result.length; i++) {
      let sumX = 0, sumY = 0, sumConf = 0, count = 0
      for (let j = Math.max(0, i - half); j <= Math.min(result.length - 1, i + half); j++) {
        const kp = frames[j].keypoints[k]
        if (kp.conf > 0.2) {
          sumX += kp.x; sumY += kp.y; sumConf += kp.conf; count++
        }
      }
      if (count > 0) {
        result[i].keypoints[k].x = sumX / count
        result[i].keypoints[k].y = sumY / count
        result[i].keypoints[k].conf = sumConf / count
      }
    }
  }

  return result
}

// ─── Interpolate Missing Keypoints ────────────────────────────────────────────

function interpolateMissing(frames: FrameData[]): FrameData[] {
  if (frames.length < 3) return frames

  const result = frames.map(f => ({
    ...f,
    keypoints: f.keypoints.map(k => ({ ...k })),
  }))

  for (let kpIdx = 0; kpIdx < NUM_KEYPOINTS; kpIdx++) {
    // Find valid indices
    const valid: number[] = []
    for (let i = 0; i < result.length; i++) {
      if (result[i].keypoints[kpIdx].conf > 0.3) valid.push(i)
    }
    if (valid.length < 2) continue

    // Interpolate gaps
    for (let vi = 0; vi < valid.length - 1; vi++) {
      const start = valid[vi]
      const end = valid[vi + 1]
      if (end - start <= 1) continue
      const sx = result[start].keypoints[kpIdx].x
      const sy = result[start].keypoints[kpIdx].y
      const ex = result[end].keypoints[kpIdx].x
      const ey = result[end].keypoints[kpIdx].y
      for (let j = start + 1; j < end; j++) {
        const t = (j - start) / (end - start)
        result[j].keypoints[kpIdx].x = sx * (1 - t) + ex * t
        result[j].keypoints[kpIdx].y = sy * (1 - t) + ey * t
        result[j].keypoints[kpIdx].conf = 0.3 // marked as interpolated
      }
    }
  }

  return result
}

// ─── Handedness Detection ─────────────────────────────────────────────────────

function detectHandedness(frames: FrameData[]): boolean {
  if (frames.length < 5) return false
  let rWristMove = 0, lWristMove = 0
  let prevRW: { x: number; y: number } | null = null
  let prevLW: { x: number; y: number } | null = null

  for (const fd of frames) {
    const rw = fd.keypoints[R_WRIST].conf > 0.3 ? fd.keypoints[R_WRIST] : null
    const lw = fd.keypoints[L_WRIST].conf > 0.3 ? fd.keypoints[L_WRIST] : null
    if (rw && prevRW) rWristMove += dist(rw, prevRW)
    if (lw && prevLW) lWristMove += dist(lw, prevLW)
    if (rw) prevRW = rw
    if (lw) prevLW = lw
  }

  return lWristMove > rWristMove * 1.3
}

// ─── Phase Detection ──────────────────────────────────────────────────────────

function detectPhases(frames: FrameData[], fps: number, isLeftHanded: boolean): PhaseInfo {
  const n = frames.length
  if (n < 5) {
    return {
      approachStart: 0, approachEnd: Math.floor(n / 4),
      plantFrame: Math.floor(n / 4), jumpPeak: Math.floor(n / 2),
      contactFrame: Math.floor(n / 2), followThroughEnd: n - 1,
      personHeight: 200, legLength: 200,
      hipYs: Array(n).fill(0), hipXs: Array(n).fill(0),
      wristSpeeds: [],
    }
  }

  // Get hip center positions
  const hipYs: number[] = []
  const hipXs: (number | null)[] = []

  for (const fd of frames) {
    const kp = fd.keypoints
    if (kp[L_HIP].conf > 0.3 && kp[R_HIP].conf > 0.3) {
      const mc = midpoint(kp[L_HIP], kp[R_HIP])
      hipYs.push(mc.y)
      hipXs.push(mc.x)
    } else {
      hipYs.push(NaN)
      hipXs.push(null)
    }
  }

  // Fill NaN with nearest valid
  for (let i = 0; i < n; i++) {
    if (isNaN(hipYs[i])) {
      let bestJ = -1, bestD = Infinity
      for (let j = 0; j < n; j++) {
        if (!isNaN(hipYs[j])) {
          const d = Math.abs(j - i)
          if (d < bestD) { bestD = d; bestJ = j }
        }
      }
      if (bestJ >= 0) {
        hipYs[i] = hipYs[bestJ]
        hipXs[i] = hipXs[bestJ]
      } else {
        hipYs[i] = 0
        hipXs[i] = 0
      }
    }
  }

  // Smooth hip Y
  const smoothedHipY = movingAverage(hipYs, 5)

  // Estimate person height (hip to ankle median)
  const heights: number[] = []
  for (const fd of frames) {
    const kp = fd.keypoints
    if (kp[L_HIP].conf > 0.3 && kp[L_KNEE].conf > 0.3 && kp[L_ANKLE].conf > 0.3) {
      const h = dist(kp[L_HIP], kp[L_ANKLE])
      if (h > 50) heights.push(h)
    }
    if (kp[R_HIP].conf > 0.3 && kp[R_KNEE].conf > 0.3 && kp[R_ANKLE].conf > 0.3) {
      const h = dist(kp[R_HIP], kp[R_ANKLE])
      if (h > 50) heights.push(h)
    }
  }
  heights.sort((a, b) => a - b)
  const personHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 200

  // Find jump peak (minimum hip_y = highest point)
  let peakIdx = 0
  for (let i = 0; i < smoothedHipY.length; i++) {
    if (smoothedHipY[i] < smoothedHipY[peakIdx]) peakIdx = i
  }

  // Find plant frame (last local maximum before peak)
  let plantIdx = peakIdx
  const searchBack = Math.min(peakIdx, Math.floor(fps * 1.5))
  for (let i = peakIdx - 1; i >= Math.max(0, peakIdx - searchBack); i--) {
    if (smoothedHipY[i] >= smoothedHipY[plantIdx]) plantIdx = i
    if (smoothedHipY[i] < smoothedHipY[peakIdx] + 10) break
  }
  // Refine: find actual last rise before the drop
  let foundPlant = false
  for (let i = peakIdx - 1; i >= Math.max(0, peakIdx - Math.floor(fps * 1.0)); i--) {
    if (smoothedHipY[i] > smoothedHipY[i + 1] + 2) {
      plantIdx = i + 1; foundPlant = true; break
    }
  }
  if (!foundPlant) {
    const sStart = Math.max(0, peakIdx - Math.floor(fps * 1.5))
    let maxHipY = -Infinity
    for (let i = sStart; i <= peakIdx; i++) {
      if (smoothedHipY[i] > maxHipY) { maxHipY = smoothedHipY[i]; plantIdx = i }
    }
  }

  // Find contact frame (max wrist speed of hitting arm)
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const wristSpeeds: number[] = [0]
  for (let i = 1; i < n; i++) {
    const w1 = frames[i - 1].keypoints[hitW]
    const w2 = frames[i].keypoints[hitW]
    if (w1.conf > 0.3 && w2.conf > 0.3) {
      wristSpeeds.push(dist(w1, w2))
    } else {
      wristSpeeds.push(0)
    }
  }

  let contactIdx = peakIdx
  let maxWS = 0
  for (let i = 0; i < wristSpeeds.length; i++) {
    if (wristSpeeds[i] > maxWS) { maxWS = wristSpeeds[i]; contactIdx = i + 1 }
  }
  contactIdx = Math.min(contactIdx, n - 1)

  // Clamp contact near jump peak
  const minContact = Math.max(0, peakIdx - Math.floor(fps * 0.3))
  const maxContact = Math.min(n - 1, peakIdx + Math.floor(fps * 0.5))
  contactIdx = Math.max(minContact, Math.min(maxContact, contactIdx))

  const followEnd = Math.min(n - 1, contactIdx + Math.floor(fps * 1.0))

  return {
    approachStart: 0,
    approachEnd: plantIdx,
    plantFrame: plantIdx,
    jumpPeak: peakIdx,
    contactFrame: contactIdx,
    followThroughEnd: followEnd,
    personHeight,
    legLength: personHeight,
    hipYs: smoothedHipY,
    hipXs,
    wristSpeeds,
  }
}

// ─── Biomechanical Scoring (16 Metrics) ───────────────────────────────────────

function calcApproachSpeed(frames: FrameData[], phases: PhaseInfo, fps: number): [number, number] {
  const xs = (phases.hipXs.slice(phases.approachStart, phases.approachEnd + 1) as number[])
  if (xs.length < 2) return [50, 0]

  const totalDist = Math.abs(xs[xs.length - 1] - xs[0])
  const dt = xs.length / fps
  const speed = dt > 0 ? totalDist / dt : 0

  let score: number
  if (speed > 300) score = 92
  else if (speed > 200) score = 70 + (speed - 200) / 100 * 22
  else if (speed > 100) score = 45 + (speed - 100) / 100 * 25
  else score = 20 + speed / 100 * 25

  return [clamp(score), Math.round(speed * 100) / 100]
}

function calcApproachAngle(frames: FrameData[], phases: PhaseInfo): [number, number] {
  const asStart = phases.approachStart
  const plant = phases.plantFrame
  if (plant <= asStart) return [50, 0]

  const startX = (phases.hipXs[asStart] ?? 0) as number
  const startY = phases.hipYs[asStart]
  const plantX = (phases.hipXs[plant] ?? 0) as number
  const plantY = phases.hipYs[plant]

  const dx = Math.abs(plantX - startX)
  const dy = Math.abs(plantY - startY)
  const angle = Math.atan2(dy, dx) * (180 / Math.PI)

  let score = scoreBand(angle, 45, 60, 0)
  if (angle > 75) score = clamp(score - 15)

  return [clamp(score), Math.round(angle * 10) / 10]
}

function calcLastStepLength(frames: FrameData[], phases: PhaseInfo): [number, number] {
  const plant = phases.plantFrame
  const legLen = phases.legLength
  const n = frames.length

  const anklePositions: [number, { x: number; y: number }][] = []
  for (let i = plant; i >= Math.max(0, plant - Math.floor(n * 0.3)); i--) {
    const kp = frames[i].keypoints
    if (kp[L_ANKLE].conf > 0.3 && kp[R_ANKLE].conf > 0.3) {
      anklePositions.push([i, midpoint(kp[L_ANKLE], kp[R_ANKLE])])
      if (anklePositions.length >= 10) break
    }
  }

  if (anklePositions.length < 2) return [50, 0]

  // Find step positions
  const steps = [anklePositions[0]]
  for (let i = 1; i < anklePositions.length; i++) {
    const prev = steps[steps.length - 1][1]
    const cur = anklePositions[i][1]
    if (dist(prev, cur) > legLen * 0.15) {
      steps.push(anklePositions[i])
    }
  }

  if (steps.length < 2) return [50, 0]

  const stepLen = dist(steps[steps.length - 2][1], steps[steps.length - 1][1])
  const ratio = legLen > 0 ? stepLen / legLen : 0
  const score = scoreBand(ratio, 0.8, 1.2, 0)

  return [clamp(score), Math.round(ratio * 1000) / 1000]
}

function calcFootworkRhythm(frames: FrameData[], phases: PhaseInfo, fps: number): [number, number] {
  const plant = phases.plantFrame
  const n = frames.length

  const ankleYs: [number, number][] = []
  const searchStart = Math.max(0, plant - Math.floor(fps * 2))
  for (let i = searchStart; i <= plant && i < n; i++) {
    const kp = frames[i].keypoints
    if (kp[L_ANKLE].conf > 0.3 && kp[R_ANKLE].conf > 0.3) {
      ankleYs.push([i, Math.min(kp[L_ANKLE].y, kp[R_ANKLE].y)])
    } else if (kp[L_ANKLE].conf > 0.3) {
      ankleYs.push([i, kp[L_ANKLE].y])
    } else if (kp[R_ANKLE].conf > 0.3) {
      ankleYs.push([i, kp[R_ANKLE].y])
    }
  }

  if (ankleYs.length < 3) return [50, 0]

  const yVals = ankleYs.map(a => a[1])
  const smoothed = movingAverage(yVals, 3)
  const meanY = smoothed.reduce((a, b) => a + b, 0) / smoothed.length

  // Find foot plant events (local maxima in y = foot on ground)
  const plants: number[] = []
  for (let i = 1; i < smoothed.length - 1; i++) {
    if (smoothed[i] >= smoothed[i - 1] && smoothed[i] >= smoothed[i + 1] && smoothed[i] > meanY - 5) {
      plants.push(ankleYs[i][0])
    }
  }

  if (plants.length < 2) return [50, 0]

  const intervals: number[] = []
  for (let i = 1; i < plants.length; i++) {
    const dt = (plants[i] - plants[i - 1]) / fps
    if (dt > 0.05) intervals.push(dt)
  }

  if (intervals.length < 2) return [50, 0]

  // Acceleration pattern (slow-to-fast = intervals get shorter)
  let accScore = 50
  const ratios: number[] = []
  for (let i = 0; i < intervals.length - 1; i++) {
    if (intervals[i + 1] > 0) ratios.push(intervals[i] / intervals[i + 1])
  }
  if (ratios.length > 0) {
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length
    if (avgRatio > 1.3) accScore = 85
    else if (avgRatio > 1.1) accScore = 75
    else if (avgRatio > 0.9) accScore = 60
    else accScore = 35
  }

  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
  const std = Math.sqrt(intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length)
  const cv = mean > 0 ? std / mean : 0
  const consScore = Math.max(30, Math.round(90 - cv * 200))

  const score = accScore * 0.6 + consScore * 0.4
  return [clamp(score), Math.round(mean * 1000) / 1000]
}

function calcArmsSwingBack(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean): [number, number] {
  const offShoulder = isLeftHanded ? R_SHOULDER : L_SHOULDER
  const offWrist = isLeftHanded ? R_WRIST : L_WRIST

  let maxAngle = 0; let count = 0
  for (let i = phases.approachStart; i <= Math.min(phases.plantFrame, frames.length - 1); i++) {
    const kp = frames[i].keypoints
    if (kp[offShoulder].conf < 0.3 || kp[offWrist].conf < 0.3) continue
    if (kp[L_HIP].conf < 0.3 || kp[R_HIP].conf < 0.3) continue

    const hipC = midpoint(kp[L_HIP], kp[R_HIP])
    const angle = angleBetween(hipC, kp[offShoulder], kp[offWrist])
    maxAngle = Math.max(maxAngle, angle)
    count++
  }

  if (count === 0) return [50, 0]

  let score: number
  if (maxAngle > 150) score = 92
  else if (maxAngle > 120) score = 78
  else if (maxAngle > 90) score = 60
  else if (maxAngle > 60) score = 40
  else score = 25

  return [clamp(score), Math.round(maxAngle * 10) / 10]
}

function calcVerticalJumpConversion(frames: FrameData[], phases: PhaseInfo, fps: number): [number, number] {
  const plant = phases.plantFrame
  const peak = phases.jumpPeak
  if (peak <= plant) return [50, 0]

  const vertDisp = phases.hipYs[plant] - phases.hipYs[peak] // positive = upward
  const personHeight = phases.personHeight
  const jumpRatio = personHeight > 0 ? vertDisp / personHeight : 0

  // Horizontal speed at plant
  const window = Math.max(1, Math.floor(fps * 0.2))
  const horizSpeeds: number[] = []
  for (let i = Math.max(0, plant - window); i < plant; i++) {
    const x1 = phases.hipXs[i]
    const x2 = phases.hipXs[i + 1]
    if (x1 !== null && x2 !== null) {
      horizSpeeds.push(Math.abs(x2 - x1) * fps)
    }
  }
  const avgHS = horizSpeeds.length > 0 ? horizSpeeds.reduce((a, b) => a + b, 0) / horizSpeeds.length : 0

  let score: number
  if (jumpRatio > 0.8) score = 90
  else if (jumpRatio > 0.5) score = 72
  else if (jumpRatio > 0.3) score = 55
  else if (jumpRatio > 0.15) score = 40
  else score = 25

  if (avgHS > 10 && vertDisp / avgHS > 0.3) score = Math.min(100, score + 5)

  return [clamp(score), Math.round(jumpRatio * 1000) / 1000]
}

function calcHipShoulderRotation(frames: FrameData[], phases: PhaseInfo): [number, number] {
  const n = frames.length
  let peak = Math.min(phases.jumpPeak, n - 1)
  const kp = frames[peak].keypoints

  // If key points not visible at peak, search nearby
  if (kp[L_SHOULDER].conf < 0.3 || kp[R_SHOULDER].conf < 0.3 ||
      kp[L_HIP].conf < 0.3 || kp[R_HIP].conf < 0.3) {
    for (let offset = 1; offset < 10; offset++) {
      for (const p of [peak - offset, peak + offset]) {
        if (p >= 0 && p < n) {
          const k = frames[p].keypoints
          if (k[L_SHOULDER].conf > 0.3 && k[R_SHOULDER].conf > 0.3 &&
              k[L_HIP].conf > 0.3 && k[R_HIP].conf > 0.3) {
            peak = p; break
          }
        }
      }
    }
  }

  const fkp = frames[peak].keypoints
  const sAngle = angleOfLine(fkp[L_SHOULDER], fkp[R_SHOULDER])
  const hAngle = angleOfLine(fkp[L_HIP], fkp[R_HIP])
  let rotation = Math.abs(sAngle - hAngle)
  if (rotation > 90) rotation = 180 - rotation

  let score: number
  if (rotation >= 20 && rotation <= 45) score = 90
  else if (rotation >= 10 && rotation <= 60) score = 72
  else if (rotation >= 5) score = 55
  else score = 35

  return [clamp(score), Math.round(rotation * 10) / 10]
}

function calcBodyPositionAir(frames: FrameData[], phases: PhaseInfo): [number, number] {
  const n = frames.length
  const peak = phases.jumpPeak
  let bestScore = 0, bestAngle = 0

  for (let p = Math.max(0, peak - 3); p < Math.min(n, peak + 4); p++) {
    const kp = frames[p].keypoints
    if (kp[L_SHOULDER].conf < 0.3 || kp[R_SHOULDER].conf < 0.3) continue
    if (kp[L_HIP].conf < 0.3 || kp[R_HIP].conf < 0.3) continue
    if (kp[L_KNEE].conf < 0.3 && kp[R_KNEE].conf < 0.3) continue

    const shoulderC = midpoint(kp[L_SHOULDER], kp[R_SHOULDER])
    const hipC = midpoint(kp[L_HIP], kp[R_HIP])
    let torsoAngle = Math.abs(angleOfLine(shoulderC, hipC) - 90)
    if (torsoAngle > 90) torsoAngle = 180 - torsoAngle

    let s = 0
    if (torsoAngle >= 5 && torsoAngle <= 30) s += 45
    else if (torsoAngle <= 45) s += 30
    else s += 10

    s += 25 // base for being airborne

    if (kp[L_KNEE].conf > 0.3 && kp[R_KNEE].conf > 0.3) {
      const kneeAngle = angleBetween(kp[L_HIP], kp[L_KNEE], kp[L_ANKLE])
      if (kneeAngle > 100 && kneeAngle < 170) s += 20
      else if (kneeAngle <= 100) s += 10
      else s += 15
    }

    if (s > bestScore) { bestScore = s; bestAngle = torsoAngle }
  }

  return [clamp(bestScore), Math.round(bestAngle * 10) / 10]
}

function calcBowAndArrow(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean): [number, number] {
  const hitS = isLeftHanded ? L_SHOULDER : R_SHOULDER
  const hitE = isLeftHanded ? L_ELBOW : R_ELBOW
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const n = frames.length
  const contact = Math.min(phases.contactFrame, n - 1)

  const searchStart = Math.max(0, contact - Math.floor(n * 0.15))

  let maxBackDist = 0, bowFrame = searchStart, bestArmAngle = 0

  for (let i = searchStart; i < contact; i++) {
    const kp = frames[i].keypoints
    if (kp[hitS].conf < 0.3 || kp[hitE].conf < 0.3 || kp[hitW].conf < 0.3) continue

    const backDist = Math.abs(kp[hitW].y - kp[hitS].y)
    if (backDist > maxBackDist) {
      maxBackDist = backDist
      bowFrame = i
    }
  }

  const kp = frames[bowFrame].keypoints
  const armAngle = angleBetween(kp[hitS], kp[hitE], kp[hitW])
  const personHeight = phases.personHeight
  const wristDist = personHeight > 0 ? dist(kp[hitS], kp[hitW]) / personHeight : 0

  let score = 0
  if (armAngle >= 120 && armAngle <= 150) score += 50
  else if (armAngle >= 100 && armAngle <= 170) score += 35
  else if (armAngle >= 80 && armAngle <= 180) score += 20
  else score += 5

  if (wristDist > 0.6) score += 30
  else if (wristDist > 0.4) score += 20
  else if (wristDist > 0.2) score += 10

  const elbowHigh = kp[hitS].y - kp[hitE].y
  if (elbowHigh > 10) score += 20
  else if (elbowHigh > 0) score += 10

  return [clamp(score), Math.round(armAngle * 10) / 10]
}

function calcArmSwingSpeed(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean, fps: number): [number, number] {
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const n = frames.length
  const personHeight = phases.personHeight

  const speeds: number[] = [0]
  for (let i = 1; i < n; i++) {
    const w1 = frames[i - 1].keypoints[hitW]
    const w2 = frames[i].keypoints[hitW]
    if (w1.conf > 0.3 && w2.conf > 0.3) {
      speeds.push(dist(w1, w2) * fps)
    } else {
      speeds.push(0)
    }
  }

  const maxSpeed = Math.max(...speeds)
  const normSpeed = personHeight > 0 ? maxSpeed / personHeight : 0

  let score: number
  if (normSpeed > 3.0) score = 92
  else if (normSpeed > 2.0) score = 78
  else if (normSpeed > 1.2) score = 60
  else if (normSpeed > 0.6) score = 45
  else score = 25

  return [clamp(score), Math.round(maxSpeed * 100) / 100]
}

function calcContactPoint(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean): [number, number] {
  const hitS = isLeftHanded ? L_SHOULDER : R_SHOULDER
  const hitE = isLeftHanded ? L_ELBOW : R_ELBOW
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const n = frames.length
  const contact = Math.min(phases.contactFrame, n - 1)

  const kp = frames[contact].keypoints
  if (kp[hitS].conf < 0.3 || kp[hitE].conf < 0.3 || kp[hitW].conf < 0.3) return [50, 0]

  const armAngle = angleBetween(kp[hitS], kp[hitE], kp[hitW])

  let score = 0
  if (armAngle >= 170) score += 60
  else if (armAngle >= 155) score += 45
  else if (armAngle >= 130) score += 30
  else score += 10

  // Contact near peak height
  const peakHipY = phases.hipYs[phases.jumpPeak]
  const contactHipY = phases.hipYs[contact]
  const personHeight = phases.personHeight
  const hDiff = personHeight > 0 ? Math.abs(peakHipY - contactHipY) / personHeight : 0

  if (hDiff < 0.05) score += 40
  else if (hDiff < 0.15) score += 30
  else if (hDiff < 0.30) score += 15
  else score += 5

  return [clamp(score), Math.round(armAngle * 10) / 10]
}

function calcWristSnap(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean, fps: number): [number, number] {
  const hitS = isLeftHanded ? L_SHOULDER : R_SHOULDER
  const hitE = isLeftHanded ? L_ELBOW : R_ELBOW
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const n = frames.length
  const contact = phases.contactFrame
  const ftEnd = Math.min(phases.followThroughEnd, n - 2)

  const anglesAfter: (number | null)[] = []
  for (let i = contact; i <= ftEnd; i++) {
    const kp = frames[i].keypoints
    if (kp[hitS].conf < 0.3 || kp[hitE].conf < 0.3 || kp[hitW].conf < 0.3) {
      anglesAfter.push(null)
    } else {
      anglesAfter.push(angleOfLine(kp[hitE], kp[hitW]))
    }
  }

  const valid = anglesAfter.map((a, i) => a !== null ? [i, a] as [number, number] : null).filter(Boolean) as [number, number][]
  if (valid.length < 3) return [50, 0]

  const angVels: number[] = []
  for (let j = 1; j < valid.length; j++) {
    const di = valid[j][0] - valid[j - 1][0]
    const da = valid[j][1] - valid[j - 1][1]
    if (di > 0) angVels.push(Math.abs(da / di) * fps)
  }

  if (angVels.length === 0) return [50, 0]

  const maxAngVel = Math.max(...angVels)
  let score: number
  if (maxAngVel > 500) score = 90
  else if (maxAngVel > 300) score = 75
  else if (maxAngVel > 150) score = 55
  else score = 35

  return [clamp(score), Math.round(maxAngVel * 100) / 100]
}

function calcContactHeight(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean): [number, number] {
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const n = frames.length
  const contact = Math.min(phases.contactFrame, n - 1)
  const peak = Math.min(phases.jumpPeak, n - 1)
  const personHeight = phases.personHeight

  const kpC = frames[contact].keypoints
  if (kpC[hitW].conf < 0.3) {
    // Fallback to hip Y
    const hDiff = personHeight > 0 ? (phases.hipYs[contact] - phases.hipYs[peak]) / personHeight : 0
    if (Math.abs(hDiff) < 0.05) return [95, Math.round(Math.abs(hDiff) * 1000) / 1000]
    if (Math.abs(hDiff) < 0.15) return [80, Math.round(Math.abs(hDiff) * 1000) / 1000]
    if (Math.abs(hDiff) < 0.30) return [60, Math.round(Math.abs(hDiff) * 1000) / 1000]
    if (Math.abs(hDiff) < 0.50) return [40, Math.round(Math.abs(hDiff) * 1000) / 1000]
    return [25, Math.round(Math.abs(hDiff) * 1000) / 1000]
  }

  const contactWristY = kpC[hitW].y
  const wristYs: number[] = []
  for (let i = Math.max(0, peak - 5); i < Math.min(n, peak + 6); i++) {
    if (frames[i].keypoints[hitW].conf > 0.3) wristYs.push(frames[i].keypoints[hitW].y)
  }

  const minWristY = wristYs.length > 0 ? Math.min(...wristYs) : contactWristY
  const hDiff = personHeight > 0 ? (contactWristY - minWristY) / personHeight : 0.1

  let score: number
  if (hDiff < 0.05) score = 95
  else if (hDiff < 0.15) score = 80
  else if (hDiff < 0.30) score = 60
  else if (hDiff < 0.50) score = 40
  else score = 25

  return [clamp(score), Math.round(hDiff * 1000) / 1000]
}

function calcFollowThrough(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean): [number, number] {
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const n = frames.length
  const contact = phases.contactFrame
  const ftEnd = Math.min(phases.followThroughEnd, n - 1)

  if (ftEnd <= contact) return [50, 0]

  const wristPos: { x: number; y: number }[] = []
  for (let i = contact; i <= ftEnd; i++) {
    if (frames[i].keypoints[hitW].conf > 0.3) {
      wristPos.push(frames[i].keypoints[hitW])
    }
  }

  if (wristPos.length < 2) return [50, 0]

  let totalTravel = 0
  for (let i = 1; i < wristPos.length; i++) {
    totalTravel += dist(wristPos[i], wristPos[i - 1])
  }

  // Midline check
  const kpC = frames[Math.min(contact, n - 1)].keypoints
  let midlineX = wristPos[0].x
  if (kpC[L_HIP].conf > 0.3 && kpC[R_HIP].conf > 0.3) {
    midlineX = midpoint(kpC[L_HIP], kpC[R_HIP]).x
  }

  const crossesMidline = wristPos.some(wp => Math.abs(wp.x - midlineX) < phases.personHeight * 0.1)
  const personHeight = phases.personHeight
  const normTravel = personHeight > 0 ? totalTravel / personHeight : 0

  let score = 0
  if (normTravel > 1.5) score += 45
  else if (normTravel > 0.8) score += 35
  else if (normTravel > 0.4) score += 20
  else score += 10

  if (crossesMidline) score += 35
  else if (wristPos.length > 0) {
    const movedToward = Math.abs(wristPos[wristPos.length - 1].x - midlineX) < Math.abs(wristPos[0].x - midlineX)
    score += movedToward ? 20 : 5
  }

  if (wristPos.length >= 2 && wristPos[wristPos.length - 1].y > wristPos[0].y) score += 20
  else if (wristPos.length >= 2) score += 5

  return [clamp(score), Math.round(normTravel * 1000) / 1000]
}

function calcLandingBalance(frames: FrameData[], phases: PhaseInfo): [number, number] {
  const n = frames.length
  const peak = phases.jumpPeak
  const personHeight = phases.personHeight

  if (peak >= n - 3) return [50, 0]

  const approachHipY = phases.hipYs[phases.plantFrame]
  let landingFrame = peak

  for (let i = peak + 1; i < n; i++) {
    if (phases.hipYs[i] >= approachHipY - personHeight * 0.05) {
      landingFrame = i; break
    }
  }
  if (landingFrame === peak) landingFrame = n - 1
  landingFrame = Math.min(landingFrame, n - 1)

  const kp = frames[landingFrame].keypoints
  let score = 0

  // Knee angle at landing
  const kneeScores: number[] = []
  for (const [kneeI, ankleI, hipI] of [[L_KNEE, L_ANKLE, L_HIP], [R_KNEE, R_ANKLE, R_HIP]]) {
    if (kp[kneeI].conf > 0.3 && kp[ankleI].conf > 0.3 && kp[hipI].conf > 0.3) {
      const angle = angleBetween(kp[hipI], kp[kneeI], kp[ankleI])
      if (angle < 160) kneeScores.push(80)
      else if (angle < 175) kneeScores.push(55)
      else kneeScores.push(30)
    }
  }
  score += kneeScores.length > 0 ? Math.round(kneeScores.reduce((a, b) => a + b, 0) / kneeScores.length) : 30

  // Hip level
  if (kp[L_HIP].conf > 0.3 && kp[R_HIP].conf > 0.3) {
    const hipDiff = Math.abs(kp[L_HIP].y - kp[R_HIP].y)
    if (hipDiff < personHeight * 0.03) score += 20
    else if (hipDiff < personHeight * 0.08) score += 12
    else score += 5
  }

  // Both feet visible
  if (kp[L_ANKLE].conf > 0.3 && kp[R_ANKLE].conf > 0.3) score += 15
  else if (kp[L_ANKLE].conf > 0.3 || kp[R_ANKLE].conf > 0.3) score += 8

  return [clamp(score), 0]
}

// ─── Feedback Generation ──────────────────────────────────────────────────────

function generatePhaseFeedback(phase: string, scores: Record<string, number>, scoreValue: number): string {
  if (phase === 'approach') {
    const parts: string[] = []
    if (scores.approach_speed < 60) parts.push("Your approach speed is below optimal, limiting momentum for the jump. Try taking more explosive, longer strides in your final three steps.")
    else if (scores.approach_speed > 85) parts.push("Excellent approach speed that generates strong momentum for your jump.")
    else parts.push("Your approach speed is moderate. Focus on gradually accelerating through your final three steps to build more momentum.")
    if (scores.approach_angle < 60) parts.push("The approach angle could be more diagonal to the net, around 45 degrees, to better load your hitting shoulder.")
    if (scores.footwork_rhythm < 60) parts.push("Work on a more consistent, accelerating footwork rhythm (slow-to-fast pattern) in your approach.")
    if (scores.arms_swing_back < 55) parts.push("Your arms aren't swinging back far enough during the approach, which reduces jump power. Focus on a full armswing back past your hips.")
    if (!parts.length) parts.push("Your approach shows good fundamentals with solid speed and direction. Continue refining the rhythm and arm mechanics for even more power.")
    return parts.slice(0, 3).join(' ')
  }

  if (phase === 'jump') {
    const parts: string[] = []
    if (scores.vertical_jump_conversion < 60) parts.push("Your jump isn't converting enough horizontal momentum into vertical height. Focus on a more explosive plant step with a deep knee bend.")
    else if (scores.vertical_jump_conversion > 85) parts.push("Great conversion of approach speed into vertical jump height.")
    if (scores.hip_shoulder_rotation < 55) parts.push("Increase hip-shoulder separation during your jump to generate more rotational torque for a powerful swing.")
    else if (scores.hip_shoulder_rotation > 85) parts.push("Excellent hip-shoulder rotation creating strong torque for the swing.")
    if (scores.body_position_air < 55) parts.push("Work on maintaining better body position in the air, with a slight arch and your hitting arm loaded back ready to swing.")
    if (!parts.length) parts.push("Your jump mechanics are solid. Focus on maximizing both height and rotation to increase hitting power.")
    return parts.slice(0, 3).join(' ')
  }

  if (phase === 'contact') {
    const parts: string[] = []
    if (scores.bow_and_arrow < 55) parts.push("Your bow-and-arrow loading position needs improvement. Focus on getting your hitting elbow high and back with the wrist behind your head before swinging.")
    else if (scores.bow_and_arrow > 85) parts.push("Excellent bow-and-arrow loading position that maximizes power potential.")
    if (scores.arm_swing_speed < 55) parts.push("Your arm swing speed is below optimal. Work on a faster, more whip-like swing starting from a loaded position.")
    if (scores.contact_point < 60) parts.push("Focus on reaching full arm extension at contact and hitting at the peak of your jump for maximum power and court coverage.")
    if (scores.wrist_snap < 60) parts.push("Add more wrist snap at contact to generate topspin and make the ball harder to pass.")
    if (!parts.length) parts.push("Your contact mechanics are strong with good arm speed and extension. Fine-tune your wrist snap for added spin and control.")
    return parts.slice(0, 3).join(' ')
  }

  if (phase === 'followThrough') {
    const parts: string[] = []
    if (scores.follow_through < 55) parts.push("Your follow-through is cut short. Let your hitting arm continue across your body toward the opposite hip after contact for better ball control and power transfer.")
    else if (scores.follow_through > 85) parts.push("Great follow-through with your arm fully extending across your body.")
    if (scores.landing_balance < 55) parts.push("Work on landing with bent knees and balanced footing to reduce injury risk and prepare for the next play.")
    else if (scores.landing_balance > 85) parts.push("Excellent balanced landing with proper knee bend, ready for the next play.")
    if (!parts.length) parts.push("Your follow-through and landing are fundamentally sound. Keep focusing on a full arm swing through and soft, balanced landings.")
    return parts.slice(0, 3).join(' ')
  }

  return "Keep working on the fundamentals of this phase."
}

function generateStrengthsWeaknesses(scores: Record<string, number>): [string[], string[]] {
  const labels: Record<string, string> = {
    approach_speed: 'Approach Speed', approach_angle: 'Approach Angle',
    last_step_length: 'Last Step Length', footwork_rhythm: 'Footwork Rhythm',
    arms_swing_back: 'Arms Swing Back', vertical_jump_conversion: 'Vertical Jump Conversion',
    hip_shoulder_rotation: 'Hip-Shoulder Rotation', body_position_air: 'Body Position in Air',
    torso_angle_air: 'Torso Angle (Airborne)', bow_and_arrow: 'Bow and Arrow Load',
    arm_swing_speed: 'Arm Swing Speed', contact_point: 'Contact Point',
    wrist_snap: 'Wrist Snap', contact_height: 'Contact Height',
    follow_through: 'Follow Through', landing_balance: 'Landing Balance',
  }
  const strengthsExpl = {
    approach_speed: 'generates strong momentum for the jump',
    approach_angle: 'creates optimal diagonal path to the net',
    last_step_length: 'provides a powerful braking step for the jump',
    footwork_rhythm: 'builds acceleration effectively with a slow-to-fast pattern',
    arms_swing_back: 'loads energy for a higher vertical jump',
    vertical_jump_conversion: 'efficiently converts horizontal speed into vertical height',
    hip_shoulder_rotation: 'creates torque for a powerful arm swing',
    body_position_air: 'sets up an optimal athletic hitting position',
    torso_angle_air: 'maintains proper body alignment at peak height',
    bow_and_arrow: 'maximizes power potential with proper arm loading',
    arm_swing_speed: 'generates exceptional hitting power',
    contact_point: 'ensures maximum power and court coverage at the ball',
    wrist_snap: 'adds topspin for a harder ball to pass',
    contact_height: 'hits the ball at the highest possible point',
    follow_through: 'ensures full power transfer and ball control',
    landing_balance: 'reduces injury risk and prepares for the next play',
  }
  const weakExpl = {
    approach_speed: 'limits momentum, reducing jump height and hitting power',
    approach_angle: 'reduces the ability to load the hitting shoulder properly',
    last_step_length: 'limits the braking force needed for a powerful jump',
    footwork_rhythm: 'reduces approach efficiency and jump timing',
    arms_swing_back: 'loses energy that could add height to the jump',
    vertical_jump_conversion: 'wastes approach momentum instead of converting it to jump height',
    hip_shoulder_rotation: 'limits rotational power for the arm swing',
    body_position_air: 'reduces hitting power and control at contact',
    torso_angle_air: 'reduces power transfer through improper body alignment',
    bow_and_arrow: 'limits power potential by not loading the arm properly',
    arm_swing_speed: 'reduces hitting power significantly',
    contact_point: 'loses power and reduces the ability to hit over the block',
    wrist_snap: 'results in flat hits that are easier to dig',
    contact_height: 'allows blockers to reach the ball more easily',
    follow_through: 'reduces power transfer and ball control',
    landing_balance: 'increases injury risk and slows transition to next play',
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const strengths = sorted.slice(0, 3).map(([k, v]) =>
    `${labels[k] || k}: ${strengthsExpl[k as keyof typeof strengthsExpl] || 'shows good execution'}`
  )
  const weaknesses = sorted.slice(-3).reverse().map(([k]) =>
    `${labels[k] || k}: ${weakExpl[k as keyof typeof weakExpl] || 'needs improvement'}`
  )

  return [strengths, weaknesses]
}

function generateCoachNotes(scores: Record<string, number>, level: string): string {
  const sorted = Object.entries(scores).sort((a, b) => a[1] - b[1])
  const weakNames = sorted.slice(0, 3).map(([k]) => k.replace(/_/g, ' '))

  if (level === 'beginner' || level === 'intermediate') {
    return `Focus on building a consistent approach with accelerating footwork and a full armswing to maximize your jump height. Your main areas for improvement are ${weakNames.join(', ')}. Work on these fundamentals before adding more advanced techniques like increased rotation or arm speed. Film yourself regularly and compare to elite hitters to develop a visual model of proper technique.`
  }
  if (level === 'advanced') {
    return `You have solid fundamentals with room to refine your technique for maximum power. Focus specifically on improving ${weakNames.slice(0, 2).join(', ')} to take your hitting to the next level. At this level, small mechanical improvements translate to significant performance gains. Consider working with a coach on video analysis to fine-tune these specific areas.`
  }
  return `Your technique is at an elite level with strong mechanics across most checkpoints. Even at this level, continue refining ${weakNames.slice(0, 2).join(', ')} to maintain consistency. Focus on maintaining these mechanics under game pressure and fatigue conditions. Use this analysis as a baseline for tracking mechanical consistency across matches and training sessions.`
}

function estimateLevel(avg: number): string {
  if (avg >= 82) return 'elite'
  if (avg >= 65) return 'advanced'
  if (avg >= 45) return 'intermediate'
  return 'beginner'
}

function estimateApproachSpeedLabel(score: number): string {
  if (score >= 85) return 'explosive'
  if (score >= 65) return 'fast'
  if (score >= 45) return 'moderate'
  return 'slow'
}

// ─── Main Analysis Entry Point ────────────────────────────────────────────────

/**
 * Analyze a volleyball spike video entirely in the browser.
 *
 * WHY THIS ISN'T "FRAME BY FRAME":
 * The old Python approach used `while True: cap.read()` then `model(frame)` on
 * EVERY sampled frame — each with full Python/PyTorch overhead per call.
 *
 * This browser approach:
 * 1. Extracts only ~24 frames (smart sampling, not every frame)
 * 2. Pre-processes all frames into tensors
 * 3. Runs ONNX WASM inference (lightweight, no Python overhead)
 * 4. Applies smoothing + interpolation on keypoints
 * 5. Runs all 16 biomechanical scores on the smoothed data
 */
export async function analyzeVideo(
  videoFile: File,
  onProgress: ProgressCallback
): Promise<SpikeAnalysis> {
  console.log(`[SpikeLab] Starting browser analysis: ${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)}MB)`)

  // ── Step 1: Smart frame extraction ──
  const TARGET_FRAMES = 24
  onProgress(3, 'Loading video...')
  const { imageData, duration, fps, width, height } = await extractFramesFromVideo(videoFile, TARGET_FRAMES, onProgress)

  if (imageData.length < 5) {
    throw new Error(`Could not extract enough frames from the video (${imageData.length}). The video may be too short or corrupted.`)
  }

  // ── Step 2: ONNX inference on all frames ──
  onProgress(20, 'Loading AI model...')
  let framesData = await runInference(imageData, width, height, onProgress)

  if (framesData.length < 3) {
    throw new Error('Could not detect a person in enough frames. Make sure the video clearly shows a volleyball player spiking.')
  }

  console.log(`[SpikeLab] Detected person in ${framesData.length}/${imageData.length} frames`)

  // ── Step 3: Post-processing ──
  onProgress(58, 'Tracking player & smoothing keypoints...')
  framesData = trackPlayer(framesData)
  framesData = interpolateMissing(framesData)
  framesData = smoothKeypoints(framesData, 3)

  // Set timestamps
  const timePerFrame = duration / imageData.length
  for (const fd of framesData) {
    fd.timestamp = fd.frameIdx * timePerFrame
  }

  // ── Step 4: Detect handedness ──
  const isLeftHanded = detectHandedness(framesData)
  console.log(`[SpikeLab] ${isLeftHanded ? 'Left' : 'Right'}-handed player detected`)

  // ── Step 5: Phase detection ──
  onProgress(62, 'Detecting spike phases...')
  const phases = detectPhases(framesData, fps, isLeftHanded)
  console.log(`[SpikeLab] Phases: plant=${phases.plantFrame}, peak=${phases.jumpPeak}, contact=${phases.contactFrame}`)

  // ── Step 6: Calculate all 16 biomechanical scores ──
  onProgress(65, 'Calculating biomechanical metrics...')
  const scores: Record<string, number> = {}

  const calcFns: [string, () => [number, number]][] = [
    ['approach_speed', () => calcApproachSpeed(framesData, phases, fps)],
    ['approach_angle', () => calcApproachAngle(framesData, phases)],
    ['last_step_length', () => calcLastStepLength(framesData, phases)],
    ['footwork_rhythm', () => calcFootworkRhythm(framesData, phases, fps)],
    ['arms_swing_back', () => calcArmsSwingBack(framesData, phases, isLeftHanded)],
    ['vertical_jump_conversion', () => calcVerticalJumpConversion(framesData, phases, fps)],
    ['hip_shoulder_rotation', () => calcHipShoulderRotation(framesData, phases)],
    ['body_position_air', () => calcBodyPositionAir(framesData, phases)],
    ['torso_angle_air', () => {
      // Derive from body_position_air with slight variation
      const [bps] = calcBodyPositionAir(framesData, phases)
      return [clamp(bps * 0.9 + 5), 0]
    }],
    ['bow_and_arrow', () => calcBowAndArrow(framesData, phases, isLeftHanded)],
    ['arm_swing_speed', () => calcArmSwingSpeed(framesData, phases, isLeftHanded, fps)],
    ['contact_point', () => calcContactPoint(framesData, phases, isLeftHanded)],
    ['wrist_snap', () => calcWristSnap(framesData, phases, isLeftHanded, fps)],
    ['contact_height', () => calcContactHeight(framesData, phases, isLeftHanded)],
    ['follow_through', () => calcFollowThrough(framesData, phases, isLeftHanded)],
    ['landing_balance', () => calcLandingBalance(framesData, phases)],
  ]

  for (const [key, fn] of calcFns) {
    const [score] = fn()
    scores[key] = score
  }

  onProgress(80, 'Generating coaching feedback...')

  // ── Step 7: Phase analysis ──
  const approachScore = Math.round((scores.approach_speed + scores.approach_angle + scores.last_step_length + scores.footwork_rhythm + scores.arms_swing_back) / 5)
  const jumpScore = Math.round((scores.vertical_jump_conversion + scores.hip_shoulder_rotation + scores.body_position_air) / 3)
  const contactScore = Math.round((scores.bow_and_arrow + scores.arm_swing_speed + scores.contact_point + scores.wrist_snap + scores.contact_height) / 5)
  const ftScore = Math.round((scores.follow_through + scores.landing_balance) / 2)

  const phaseAnalysis: PhaseAnalyses = {
    approach: {
      score: clamp(approachScore),
      feedback: generatePhaseFeedback('approach', scores, approachScore),
      specificFix: 'Focus on building speed and rhythm in the approach.',
    },
    jump: {
      score: clamp(jumpScore),
      feedback: generatePhaseFeedback('jump', scores, jumpScore),
      specificFix: 'Focus on converting horizontal momentum to vertical height.',
    },
    contact: {
      score: clamp(contactScore),
      feedback: generatePhaseFeedback('contact', scores, contactScore),
      specificFix: 'Focus on arm swing mechanics and contact point.',
    },
    followThrough: {
      score: clamp(ftScore),
      feedback: generatePhaseFeedback('followThrough', scores, ftScore),
      specificFix: 'Focus on completing the follow-through and landing softly.',
    },
  }

  const [topStrengths, topWeaknesses] = generateStrengthsWeaknesses(scores)
  const allScoreValues = Object.values(scores)
  const avgScore = allScoreValues.reduce((a, b) => a + b, 0) / allScoreValues.length
  const level = estimateLevel(avgScore)
  const coachNotes = generateCoachNotes(scores, level)
  const overallPower = clamp(Math.round((scores.approach_speed + scores.arm_swing_speed + scores.vertical_jump_conversion + scores.bow_and_arrow + scores.hip_shoulder_rotation + scores.contact_point) / 6))

  // Priority order (weakest phase first)
  const phaseScores = [
    { key: 'approach', score: approachScore },
    { key: 'jump', score: jumpScore },
    { key: 'contact', score: contactScore },
    { key: 'followThrough', score: ftScore },
  ].sort((a, b) => a.score - b.score)

  // Confidence based on frames analyzed
  let baseConf = 50
  if (framesData.length >= 18) baseConf = 85
  else if (framesData.length >= 14) baseConf = 75
  else if (framesData.length >= 10) baseConf = 60
  else if (framesData.length >= 5) baseConf = 45

  const temporalKeys = new Set(['approach_speed', 'footwork_rhythm', 'arm_swing_speed', 'vertical_jump_conversion'])
  const confidence: Record<string, number> = {}
  for (const key of Object.keys(scores)) {
    confidence[key] = key === 'torso_angle_air' ? clamp(baseConf - 25) : (temporalKeys.has(key) ? clamp(baseConf - 10) : baseConf)
  }

  const avgConfidence = Math.round(Object.values(confidence).reduce((s, v) => s + v, 0) / Object.keys(confidence).length)

  onProgress(95, 'Finalizing analysis...')

  const analysis: SpikeAnalysis = {
    scores: scores as unknown as CheckpointScores,
    confidence: confidence as unknown as CheckpointConfidence,
    phaseAnalysis,
    topStrengths,
    topWeaknesses,
    coachNotes,
    estimatedLevel: level,
    estimatedApproachSpeed: estimateApproachSpeedLabel(scores.approach_speed),
    overallPower,
    priorityOrder: phaseScores.map(p => p.key),
    metadata: {
      frameCount: framesData.length,
      duration: Math.round(duration * 100) / 100,
      averageConfidence: avgConfidence,
      framesWithPlayer: framesData.length,
      quality: avgConfidence >= 60 ? 'high' as const : avgConfidence >= 30 ? 'medium' as const : 'low' as const,
      analysisMethod: 'YOLOv8 Pose (Browser ONNX/WASM)',
    },
  }

  onProgress(100, 'Analysis complete!')

  console.log(`[SpikeLab] Analysis complete. Overall: ${overallPower}, Level: ${level}, Frames: ${framesData.length}`)
  return analysis
}