'use client'

/**
 * Client-side YOLOv8-Pose volleyball spike analysis.
 * Runs entirely in the browser using ONNX Runtime Web.
 *
 * Pipeline:  Video File → Frame Extraction → ONNX Inference → Phase Detection → 16 Biomechanical Scores
 */

import type {
  SpikeAnalysis,
  CheckpointScores,
  CheckpointConfidence,
  PhaseAnalyses,
} from '@/lib/spike-types'

/* ═══════════════════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════════════════ */

// COCO 17-keypoint indices
const NOSE = 0
const L_EYE = 1
const R_EYE = 2
const L_EAR = 3
const R_EAR = 4
const L_SHOULDER = 5
const R_SHOULDER = 6
const L_ELBOW = 7
const R_ELBOW = 8
const L_WRIST = 9
const R_WRIST = 10
const L_HIP = 11
const R_HIP = 12
const L_KNEE = 13
const R_KNEE = 14
const L_ANKLE = 15
const R_ANKLE = 16

const NUM_KEYPOINTS = 17

// ONNX model constants
const MODEL_INPUT_SIZE = 640
const MODEL_OUTPUT_COLS = 56 // 4 bbox + 1 obj + 1 cls + 17*3 kpts
const CONF_THRESHOLD = 0.25
const NMS_IOU_THRESHOLD = 0.45
const KP_CONF_THRESHOLD = 0.3

// Frame extraction
const TARGET_FRAME_COUNT = 18
const MIN_FRAME_COUNT = 6
const MOTION_THRESHOLD = 30 // pixel diff to consider a frame "interesting"

/* ═══════════════════════════════════════════════════════════════════════════════
   Types (internal)
   ═══════════════════════════════════════════════════════════════════════════════ */

interface Point2D {
  x: number
  y: number
}

/** Single keypoint: position + detection confidence */
interface Keypoint {
  x: number
  y: number
  confidence: number
}

/** Per-frame detection result */
interface FrameDetection {
  frameIdx: number
  timestamp: number
  keypoints: Keypoint[]        // 17 keypoints
  detConfidence: number
  bbox: [number, number, number, number] // x1, y1, x2, y2
}

/** Phase boundaries detected from keypoint time-series */
interface Phases {
  approachStart: number
  approachEnd: number
  plantFrame: number
  jumpStart: number
  jumpPeak: number
  contactFrame: number
  followThroughEnd: number
  personHeight: number
  legLength: number
  hipYs: number[]
  hipXs: number[]
  wristSpeeds: number[]
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Math Utilities
   ═══════════════════════════════════════════════════════════════════════════════ */

function dist(a: Point2D, b: Point2D): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function angleBetween(a: Point2D, b: Point2D, c: Point2D): number {
  const ba = { x: a.x - b.x, y: a.y - b.y }
  const bc = { x: c.x - b.x, y: c.y - b.y }
  const dot = ba.x * bc.x + ba.y * bc.y
  const magBA = Math.sqrt(ba.x ** 2 + ba.y ** 2)
  const magBC = Math.sqrt(bc.x ** 2 + bc.y ** 2)
  const denom = magBA * magBC + 1e-8
  const cos = Math.max(-1, Math.min(1, dot / denom))
  return (Math.acos(cos) * 180) / Math.PI
}

function angleOfLine(a: Point2D, b: Point2D): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

function clamp(val: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(val)))
}

function scoreBand(value: number, bestLo: number, bestHi: number, worst: number): number {
  if (bestLo <= value && value <= bestHi) return 95
  const distFromBest = value < bestLo ? bestLo - value : value - bestHi
  const maxDist = Math.max(Math.abs(bestLo - worst), Math.abs(bestHi - worst))
  if (maxDist < 1e-8) return 95
  const ratio = 1 - Math.min(distFromBest / maxDist, 1)
  return clamp(30 + ratio * 65)
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length)
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function smooth(series: number[], window = 3): number[] {
  if (series.length < window) return [...series]
  const result: number[] = []
  const half = Math.floor(window / 2)
  for (let i = 0; i < series.length; i++) {
    const lo = Math.max(0, i - half)
    const hi = Math.min(series.length, i + half + 1)
    let sum = 0
    for (let j = lo; j < hi; j++) sum += series[j]
    result.push(sum / (hi - lo))
  }
  return result
}

function kpXY(kps: Keypoint[], idx: number): Point2D {
  return { x: kps[idx].x, y: kps[idx].y }
}

function kpConf(kps: Keypoint[], idx: number): number {
  return kps[idx].confidence
}

/** Yield to the event loop so the UI doesn't freeze */
function yieldToUI(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

/** Normalize a measurement by full body height for resolution invariance */
function normalizeByHeight(value: number, personHeight: number): number {
  return personHeight > 0 ? value / personHeight : 0
}

/** Confidence-weighted scoring helper: weight each frame's contribution by min keypoint confidence */
function confidenceWeightedScore(
  frames: FrameDetection[],
  frameIndices: number[],
  kpIndices: number[],
  computeFn: (kp: Keypoint[], frameIdx: number) => number,
): [number, number] {
  let weightedSum = 0
  let totalWeight = 0
  for (const fi of frameIndices) {
    if (fi < 0 || fi >= frames.length) continue
    const kp = frames[fi].keypoints
    const minConf = Math.min(...kpIndices.map(ki => kp[ki].confidence))
    if (minConf < KP_CONF_THRESHOLD) continue
    const raw = computeFn(kp, fi)
    weightedSum += raw * minConf
    totalWeight += minConf
  }
  if (totalWeight < 0.1) return [50, 0] // not enough data
  return [weightedSum / totalWeight, totalWeight / frameIndices.length]
}

/* ═══════════════════════════════════════════════════════════════════════════════
   1. Frame Extraction
   ═══════════════════════════════════════════════════════════════════════════════ */

interface ExtractedFrame {
  imageData: ImageData
  timestamp: number
  width: number
  height: number
}

async function extractFrames(
  file: File,
  onProgress: (msg: string, pct: number) => void,
): Promise<ExtractedFrame[]> {
  onProgress('Loading video...', 2)

  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'

  // Load video metadata
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('Cannot load video file'))
    video.src = url
  })

  const duration = video.duration
  const vw = video.videoWidth
  const vh = video.videoHeight

  if (!duration || duration < 0.5) {
    URL.revokeObjectURL(url)
    throw new Error('Video is too short. Please upload a video at least 1 second long.')
  }

  // Determine number of frames to extract
  let numFrames = TARGET_FRAME_COUNT
  if (duration < 2) numFrames = Math.max(MIN_FRAME_COUNT, Math.floor(duration * 8))
  else if (duration < 4) numFrames = Math.max(MIN_FRAME_COUNT, Math.floor(duration * 5))

  // Generate candidate timestamps uniformly spread
  const candidates: number[] = []
  const margin = 0.05 // avoid first/last 50ms
  for (let i = 0; i < numFrames * 3; i++) {
    const t = margin + ((duration - 2 * margin) * i) / (numFrames * 3 - 1)
    candidates.push(t)
  }

  // Create canvas for frame capture
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  // We'll resize to a max dimension for inference while preserving aspect ratio
  // But extract at reasonable resolution (max 1280px)
  const maxDim = 1280
  const scale = Math.min(1, maxDim / Math.max(vw, vh))
  canvas.width = Math.round(vw * scale)
  canvas.height = Math.round(vh * scale)

  // Extract all candidate frames
  onProgress('Extracting video frames...', 5)
  const allFrames: ExtractedFrame[] = []

  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i]
    video.currentTime = t
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
    })
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    allFrames.push({
      imageData,
      timestamp: t,
      width: canvas.width,
      height: canvas.height,
    })
    if (i % 10 === 0) {
      onProgress(`Extracting frames... (${i + 1}/${candidates.length})`, 5 + Math.floor((i / candidates.length) * 10))
      await yieldToUI()
    }
  }

  URL.revokeObjectURL(url)

  // Motion detection: pick frames with most motion (interesting moments)
  onProgress('Selecting key frames via motion detection...', 15)
  const selected = selectFramesByMotion(allFrames, numFrames)

  onProgress(`Selected ${selected.length} key frames for analysis`, 20)
  return selected
}

/** Select frames by motion magnitude — prefer frames where something is happening */
function selectFramesByMotion(frames: ExtractedFrame[], targetCount: number): ExtractedFrame[] {
  if (frames.length <= targetCount) return frames

  // Compute motion between consecutive frames
  const motions: number[] = [0] // first frame has no predecessor
  for (let i = 1; i < frames.length; i++) {
    const m = frameDifference(frames[i - 1].imageData, frames[i].imageData)
    motions.push(m)
  }

  // Also include first and last frames always
  const selected: ExtractedFrame[] = [frames[0]]

  // Select top-motion frames
  const remaining = frames.slice(1, -1)
  const remainingMotion = motions.slice(1, -1)
  const slots = targetCount - 2 // reserve 2 for first/last

  if (slots <= 0) {
    selected.push(frames[frames.length - 1])
    return selected
  }

  // Create index array and sort by motion descending
  const indices = remaining.map((_, i) => i).sort((a, b) => remainingMotion[b] - remainingMotion[a])

  // Take top N but also ensure some uniform spacing
  const taken = new Set<number>()
  // First take half by motion
  const motionSlots = Math.ceil(slots * 0.6)
  const evenSlots = slots - motionSlots

  for (let i = 0; i < Math.min(motionSlots, indices.length); i++) {
    taken.add(indices[i])
  }

  // Then take evenly spaced frames
  const step = Math.floor(remaining.length / (evenSlots + 1))
  for (let i = 1; i <= evenSlots; i++) {
    const idx = Math.min(i * step, remaining.length - 1)
    taken.add(idx)
  }

  // Add remaining frames sorted by index
  const sortedTaken = Array.from(taken).sort((a, b) => a - b)
  for (const idx of sortedTaken) {
    selected.push(remaining[idx])
  }

  selected.push(frames[frames.length - 1])
  selected.sort((a, b) => a.timestamp - b.timestamp)

  return selected
}

/** Simple frame difference metric (average pixel difference in grayscale) */
function frameDifference(a: ImageData, b: ImageData): number {
  const da = a.data
  const db = b.data
  const len = Math.min(da.length, db.length)
  // Sample every 16th pixel for speed
  let sum = 0
  let count = 0
  for (let i = 0; i < len; i += 64) {
    // Quick grayscale: (R+G+B)/3
    const ga = (da[i] + da[i + 1] + da[i + 2]) / 3
    const gb = (db[i] + db[i + 1] + db[i + 2]) / 3
    sum += Math.abs(ga - gb)
    count++
  }
  return count > 0 ? sum / count : 0
}

/* ═══════════════════════════════════════════════════════════════════════════════
   2. YOLOv8-Pose ONNX Inference
   ═══════════════════════════════════════════════════════════════════════════════ */

let cachedSession: InferenceSession | null = null

interface InferenceSession {
  run(input: Float32Array): Promise<Float32Array>
  dispose(): void
}

async function loadOnnxSession(
  onProgress: (msg: string, pct: number) => void,
): Promise<InferenceSession> {
  if (cachedSession) return cachedSession

  onProgress('Loading AI pose model (this may take a moment)...', 22)

  // Load onnxruntime-web from CDN to avoid bundler WASM issues
  // @ts-expect-error -- ort is loaded from CDN
  let ort: typeof import('onnxruntime-web') = (window as Record<string, unknown>).ort
  if (!ort) {
    onProgress('Downloading ONNX Runtime...', 24)
    const ortScript = document.createElement('script')
    ortScript.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.min.js'
    ortScript.async = true
    document.head.appendChild(ortScript)
    await new Promise<void>((resolve, reject) => {
      ortScript.onload = () => resolve()
      ortScript.onerror = () => reject(new Error('Failed to load ONNX Runtime'))
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ort = (window as any).ort
  }

  // Configure WASM paths - use CDN
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/'
  ort.env.wasm.numThreads = 1

  const session = await ort.InferenceSession.create('/models/yolov8n-pose.onnx', {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })

  const inputNames = session.inputNames
  const outputNames = session.outputNames

  cachedSession = {
    run(input: Float32Array): Promise<Float32Array> {
      const tensor = new ort.Tensor('float32', input, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE])
      const feeds = { [inputNames[0]]: tensor }
      return session.run(feeds).then((results) => {
        const output = results[outputNames[0]]
        return output.data as Float32Array
      })
    },
    dispose() {
      session.release()
      cachedSession = null
    },
  }

  onProgress('AI model loaded', 28)
  return cachedSession
}

/** Preprocess an ImageData to NCHW float32 tensor normalized [0,1] */
function preprocessFrame(frame: ImageData): Float32Array {
  const { width, height, data } = frame

  // Create an offscreen canvas to resize to 640x640
  const canvas = document.createElement('canvas')
  canvas.width = MODEL_INPUT_SIZE
  canvas.height = MODEL_INPUT_SIZE
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(
    // Create an ImageBitmap-like source from ImageData
    createImageSource(data, width, height) as unknown as CanvasImageSource,
    0,
    0,
    MODEL_INPUT_SIZE,
    MODEL_INPUT_SIZE,
  )

  const resized = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
  const pixels = resized.data

  // Allocate NCHW tensor: [1, 3, 640, 640]
  const tensor = new Float32Array(1 * 3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE)
  const channelSize = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE

  for (let i = 0; i < channelSize; i++) {
    const pi = i * 4
    // RGB order, normalize to [0, 1]
    tensor[i] = pixels[pi] / 255                     // R channel
    tensor[channelSize + i] = pixels[pi + 1] / 255   // G channel
    tensor[2 * channelSize + i] = pixels[pi + 2] / 255 // B channel
  }

  return tensor
}

/** Create a canvas-backed source from raw pixel data */
function createImageSource(data: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const imgData = new ImageData(new Uint8ClampedArray(data), w, h)
  ctx.putImageData(imgData, 0, 0)
  return c
}

/** Post-process raw ONNX output into detections */
function postProcess(
  output: Float32Array,
  origWidth: number,
  origHeight: number,
): { keypoints: Keypoint[]; confidence: number; bbox: [number, number, number, number] } | null {
  // Output shape: [1, 56, 8400] → transpose to [8400, 56]
  const numDetections = 8400
  const detections: {
    cx: number
    cy: number
    w: number
    h: number
    objConf: number
    clsConf: number
    kps: number[] // flat 51 values: 17 * 3 (x, y, conf)
  }[] = []

  for (let i = 0; i < numDetections; i++) {
    // Column-major: output[col * 8400 + row]
    const cx = output[i]
    const cy = output[1 * numDetections + i]
    const w = output[2 * numDetections + i]
    const h = output[3 * numDetections + i]
    const objConf = sigmoid(output[4 * numDetections + i])
    const clsConf = sigmoid(output[5 * numDetections + i])

    const conf = objConf * clsConf
    if (conf < CONF_THRESHOLD) continue

    // Extract keypoints (indices 6..56, 17*3=51 values)
    const kps: number[] = []
    for (let k = 0; k < 51; k++) {
      const val = output[(6 + k) * numDetections + i]
      kps.push(k < 34 ? val : sigmoid(val)) // x,y raw; conf sigmoid
    }

    detections.push({ cx, cy, w, h, objConf, clsConf, kps })
  }

  if (detections.length === 0) return null

  // Scale detections from 640x640 to original image size
  const scaleX = origWidth / MODEL_INPUT_SIZE
  const scaleY = origHeight / MODEL_INPUT_SIZE

  for (const d of detections) {
    d.cx *= scaleX
    d.cy *= scaleY
    d.w *= scaleX
    d.h *= scaleY
    for (let k = 0; k < 17; k++) {
      d.kps[k * 3] *= scaleX
      d.kps[k * 3 + 1] *= scaleY
    }
  }

  // NMS
  const kept = nms(detections, NMS_IOU_THRESHOLD)
  if (kept.length === 0) return null

  // Pick the detection with the highest confidence (prefer larger bbox as tiebreaker)
  let best = kept[0]
  for (let i = 1; i < kept.length; i++) {
    const score = kept[i].objConf * 1000 + kept[i].w * kept[i].h
    const bestScore = best.objConf * 1000 + best.w * best.h
    if (score > bestScore) best = kept[i]
  }

  // Convert bbox from cx,cy,w,h to x1,y1,x2,y2
  const x1 = best.cx - best.w / 2
  const y1 = best.cy - best.h / 2
  const x2 = best.cx + best.w / 2
  const y2 = best.cy + best.h / 2

  // Build keypoints array
  const keypoints: Keypoint[] = []
  for (let k = 0; k < NUM_KEYPOINTS; k++) {
    keypoints.push({
      x: best.kps[k * 3],
      y: best.kps[k * 3 + 1],
      confidence: best.kps[k * 3 + 2],
    })
  }

  return {
    keypoints,
    confidence: best.objConf,
    bbox: [x1, y1, x2, y2],
  }
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/** Non-Maximum Suppression */
function nms(
  dets: { cx: number; cy: number; w: number; h: number; objConf: number; kps: number[] }[],
  iouThreshold: number,
): typeof dets {
  if (dets.length === 0) return []

  // Sort by confidence descending
  const sorted = [...dets].sort((a, b) => b.objConf - a.objConf)
  const kept: typeof dets = []
  const suppressed = new Set<number>()

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue
    kept.push(sorted[i])
    const ax1 = sorted[i].cx - sorted[i].w / 2
    const ay1 = sorted[i].cy - sorted[i].h / 2
    const ax2 = sorted[i].cx + sorted[i].w / 2
    const ay2 = sorted[i].cy + sorted[i].h / 2

    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed.has(j)) continue
      const bx1 = sorted[j].cx - sorted[j].w / 2
      const by1 = sorted[j].cy - sorted[j].h / 2
      const bx2 = sorted[j].cx + sorted[j].w / 2
      const by2 = sorted[j].cy + sorted[j].h / 2

      const ix1 = Math.max(ax1, bx1)
      const iy1 = Math.max(ay1, by1)
      const ix2 = Math.min(ax2, bx2)
      const iy2 = Math.min(ay2, by2)

      const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1)
      const areaA = (ax2 - ax1) * (ay2 - ay1)
      const areaB = (bx2 - bx1) * (by2 - by1)
      const union = areaA + areaB - inter + 1e-8

      if (inter / union > iouThreshold) {
        suppressed.add(j)
      }
    }
  }

  return kept
}

/** Run inference on all extracted frames */
async function runInference(
  frames: ExtractedFrame[],
  session: InferenceSession,
  onProgress: (msg: string, pct: number) => void,
): Promise<FrameDetection[]> {
  const detections: FrameDetection[] = []

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const tensor = preprocessFrame(frame.imageData)
    const output = await session.run(tensor)
    const result = postProcess(output, frame.width, frame.height)

    if (result) {
      detections.push({
        frameIdx: i,
        timestamp: frame.timestamp,
        keypoints: result.keypoints,
        detConfidence: result.confidence,
        bbox: result.bbox,
      })
    }

    const pct = 30 + Math.floor(((i + 1) / frames.length) * 20)
    onProgress(`Analyzing pose in frame ${i + 1}/${frames.length}...`, pct)

    // Yield every 3 frames to keep UI responsive
    if (i % 3 === 0) await yieldToUI()
  }

  return detections
}

/* ═══════════════════════════════════════════════════════════════════════════════
   3. Player Tracking & Interpolation
   ═══════════════════════════════════════════════════════════════════════════════ */

/** Simple proximity-based player tracker */
function trackPlayer(frames: FrameDetection[]): FrameDetection[] {
  if (frames.length <= 1) return frames

  const tracked: FrameDetection[] = [frames[0]]
  let prevCenter: Point2D | null = null

  // Initialize prev center from first frame
  const kp0 = frames[0].keypoints
  if (kpConf(kp0, L_SHOULDER) > KP_CONF_THRESHOLD && kpConf(kp0, R_SHOULDER) > KP_CONF_THRESHOLD) {
    prevCenter = midpoint(kpXY(kp0, L_SHOULDER), kpXY(kp0, R_SHOULDER))
  } else if (kpConf(kp0, L_HIP) > KP_CONF_THRESHOLD && kpConf(kp0, R_HIP) > KP_CONF_THRESHOLD) {
    prevCenter = midpoint(kpXY(kp0, L_HIP), kpXY(kp0, R_HIP))
  } else {
    prevCenter = { x: kp0[NOSE].x, y: kp0[NOSE].y }
  }

  for (let i = 1; i < frames.length; i++) {
    const fd = frames[i]
    const kp = fd.keypoints

    let center: Point2D
    if (kpConf(kp, L_SHOULDER) > KP_CONF_THRESHOLD && kpConf(kp, R_SHOULDER) > KP_CONF_THRESHOLD) {
      center = midpoint(kpXY(kp, L_SHOULDER), kpXY(kp, R_SHOULDER))
    } else if (kpConf(kp, L_HIP) > KP_CONF_THRESHOLD && kpConf(kp, R_HIP) > KP_CONF_THRESHOLD) {
      center = midpoint(kpXY(kp, L_HIP), kpXY(kp, R_HIP))
    } else {
      center = { x: kp[NOSE].x, y: kp[NOSE].y }
    }

    const d = dist(center, prevCenter)
    // If the detection is too far away, it's probably a different person; skip
    if (d < 500) {
      tracked.push(fd)
      prevCenter = center
    }
  }

  return tracked
}

/** Linearly interpolate missing keypoints */
function interpolateMissing(frames: FrameDetection[]): FrameDetection[] {
  if (frames.length < 3) return frames

  const result = frames.map((f) => ({
    ...f,
    keypoints: f.keypoints.map((k) => ({ ...k })),
  }))

  for (let kpIdx = 0; kpIdx < NUM_KEYPOINTS; kpIdx++) {
    const valid: number[] = []
    for (let i = 0; i < result.length; i++) {
      if (result[i].keypoints[kpIdx].confidence > KP_CONF_THRESHOLD) {
        valid.push(i)
      }
    }
    if (valid.length < 2) continue

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
        result[j].keypoints[kpIdx].confidence = KP_CONF_THRESHOLD // mark as interpolated
      }
    }
  }

  return result
}

/** Detect if the player is left-handed */
function detectHandedness(frames: FrameDetection[]): boolean {
  if (frames.length < 5) return false

  let rWristMovement = 0
  let lWristMovement = 0
  let prevRW: Point2D | null = null
  let prevLW: Point2D | null = null

  for (const fd of frames) {
    const kp = fd.keypoints
    const rw = kpConf(kp, R_WRIST) > KP_CONF_THRESHOLD ? kpXY(kp, R_WRIST) : null
    const lw = kpConf(kp, L_WRIST) > KP_CONF_THRESHOLD ? kpXY(kp, L_WRIST) : null

    if (rw && prevRW) rWristMovement += dist(rw, prevRW)
    if (lw && prevLW) lWristMovement += dist(lw, prevLW)

    prevRW = rw
    prevLW = lw
  }

  return lWristMovement > rWristMovement * 1.3
}

/* ═══════════════════════════════════════════════════════════════════════════════
   4. Phase Detection
   ═══════════════════════════════════════════════════════════════════════════════ */

function detectPhases(
  frames: FrameDetection[],
  fps: number,
  isLeftHanded: boolean,
): Phases {
  const n = frames.length
  if (n < 5) {
    return {
      approachStart: 0,
      approachEnd: Math.floor(n / 4),
      plantFrame: Math.floor(n / 4),
      jumpStart: Math.floor(n / 4),
      jumpPeak: Math.floor(n / 2),
      contactFrame: Math.floor(n / 2),
      followThroughEnd: n - 1,
      personHeight: 200,
      legLength: 200,
      hipYs: new Array(n).fill(0),
      hipXs: new Array(n).fill(0),
      wristSpeeds: new Array(n).fill(0),
    }
  }

  // Collect hip center positions
  const hipYs: (number | null)[] = []
  const hipXs: (number | null)[] = []

  for (const fd of frames) {
    const kp = fd.keypoints
    if (kpConf(kp, L_HIP) > KP_CONF_THRESHOLD && kpConf(kp, R_HIP) > KP_CONF_THRESHOLD) {
      const hc = midpoint(kpXY(kp, L_HIP), kpXY(kp, R_HIP))
      hipYs.push(hc.y)
      hipXs.push(hc.x)
    } else {
      hipYs.push(null)
      hipXs.push(null)
    }
  }

  // Fill nulls with nearest valid
  for (let i = 0; i < n; i++) {
    if (hipYs[i] !== null) continue
    let bestJ = -1
    let bestD = Infinity
    for (let j = 0; j < n; j++) {
      if (hipYs[j] !== null) {
        const d = Math.abs(j - i)
        if (d < bestD) {
          bestD = d
          bestJ = j
        }
      }
    }
    if (bestJ >= 0) {
      hipYs[i] = hipYs[bestJ]!
      hipXs[i] = hipXs[bestJ]!
    } else {
      hipYs[i] = 0
      hipXs[i] = 0
    }
  }

  const filledHipYs = hipYs as number[]
  const filledHipXs = hipXs as number[]
  const smoothedHipY = smooth(filledHipYs, 5)

  // Estimate full body height and leg length separately
  const fullHeights: number[] = []
  const legLengths: number[] = []
  for (const fd of frames) {
    const kp = fd.keypoints
    // Leg length
    if (kpConf(kp, L_HIP) > KP_CONF_THRESHOLD && kpConf(kp, L_KNEE) > KP_CONF_THRESHOLD && kpConf(kp, L_ANKLE) > KP_CONF_THRESHOLD) {
      const h = dist(kpXY(kp, L_HIP), kpXY(kp, L_ANKLE))
      if (h > 50) legLengths.push(h)
    }
    if (kpConf(kp, R_HIP) > KP_CONF_THRESHOLD && kpConf(kp, R_KNEE) > KP_CONF_THRESHOLD && kpConf(kp, R_ANKLE) > KP_CONF_THRESHOLD) {
      const h = dist(kpXY(kp, R_HIP), kpXY(kp, R_ANKLE))
      if (h > 50) legLengths.push(h)
    }
    // Full body height: nose-to-ankle, or shoulder-to-ankle * 1.3 as fallback
    const noseVis = kpConf(kp, NOSE) > KP_CONF_THRESHOLD
    if (noseVis) {
      if (kpConf(kp, L_ANKLE) > KP_CONF_THRESHOLD) {
        const h = dist(kpXY(kp, NOSE), kpXY(kp, L_ANKLE))
        if (h > 100) fullHeights.push(h)
      }
      if (kpConf(kp, R_ANKLE) > KP_CONF_THRESHOLD) {
        const h = dist(kpXY(kp, NOSE), kpXY(kp, R_ANKLE))
        if (h > 100) fullHeights.push(h)
      }
    } else {
      if (kpConf(kp, L_SHOULDER) > KP_CONF_THRESHOLD && kpConf(kp, L_ANKLE) > KP_CONF_THRESHOLD) {
        const h = dist(kpXY(kp, L_SHOULDER), kpXY(kp, L_ANKLE)) * 1.3
        if (h > 100) fullHeights.push(h)
      }
      if (kpConf(kp, R_SHOULDER) > KP_CONF_THRESHOLD && kpConf(kp, R_ANKLE) > KP_CONF_THRESHOLD) {
        const h = dist(kpXY(kp, R_SHOULDER), kpXY(kp, R_ANKLE)) * 1.3
        if (h > 100) fullHeights.push(h)
      }
    }
  }
  const personHeight = fullHeights.length > 0 ? median(fullHeights) : (legLengths.length > 0 ? median(legLengths) * 1.3 : 200)
  const legLength = legLengths.length > 0 ? median(legLengths) : personHeight * 0.47

  // Jump peak = minimum hip_y (highest point in image)
  let peakIdx = 0
  for (let i = 1; i < n; i++) {
    if (smoothedHipY[i] < smoothedHipY[peakIdx]) peakIdx = i
  }

  // Find plant frame: last local maximum in hip_y before peak
  let plantIdx = peakIdx
  const searchBack = Math.min(peakIdx, Math.round(fps * 1.5))
  for (let i = peakIdx - 1; i >= peakIdx - searchBack; i--) {
    if (i < 0) break
    if (smoothedHipY[i] >= smoothedHipY[plantIdx]) plantIdx = i
    if (smoothedHipY[i] < smoothedHipY[peakIdx] + 10) break
  }
  // Refine: find last rise before the drop
  const searchBack2 = Math.min(peakIdx, Math.round(fps * 1.0))
  let foundRise = false
  for (let i = peakIdx - 1; i >= peakIdx - searchBack2; i--) {
    if (i < 0) break
    if (smoothedHipY[i] > smoothedHipY[i + 1] + 2) {
      plantIdx = i + 1
      foundRise = true
      break
    }
  }
  if (!foundRise) {
    // Fallback: highest hip_y before peak
    const s = Math.max(0, peakIdx - Math.round(fps * 1.5))
    let maxHipY = smoothedHipY[s]
    let maxIdx = s
    for (let i = s; i <= peakIdx; i++) {
      if (smoothedHipY[i] > maxHipY) {
        maxHipY = smoothedHipY[i]
        maxIdx = i
      }
    }
    plantIdx = maxIdx
  }

  // Approach: frames before plant
  const approachStart = 0
  const approachEnd = plantIdx

  // Find contact frame: max wrist speed of hitting arm
  const hitWrist = isLeftHanded ? L_WRIST : R_WRIST
  const wristSpeeds: number[] = [0]
  for (let i = 1; i < n; i++) {
    const w1 = frames[i - 1].keypoints
    const w2 = frames[i].keypoints
    if (kpConf(w1, hitWrist) > KP_CONF_THRESHOLD && kpConf(w2, hitWrist) > KP_CONF_THRESHOLD) {
      wristSpeeds.push(dist(kpXY(w1, hitWrist), kpXY(w2, hitWrist)))
    } else {
      wristSpeeds.push(0)
    }
  }

  let contactIdx = 0
  let maxWS = 0
  for (let i = 0; i < wristSpeeds.length; i++) {
    if (wristSpeeds[i] > maxWS) {
      maxWS = wristSpeeds[i]
      contactIdx = i
    }
  }
  contactIdx = contactIdx + 1 // offset by 1 since speeds are between consecutive frames
  if (contactIdx >= n) contactIdx = n - 1

  // Clamp contact near peak
  const minContact = Math.max(0, peakIdx - Math.round(fps * 0.3))
  const maxContact = Math.min(n - 1, peakIdx + Math.round(fps * 0.5))
  contactIdx = Math.max(minContact, Math.min(maxContact, contactIdx))

  // Follow-through end
  const followEnd = Math.min(n - 1, contactIdx + Math.round(fps * 1.0))

  return {
    approachStart,
    approachEnd,
    plantFrame: plantIdx,
    jumpStart: plantIdx,
    jumpPeak: peakIdx,
    contactFrame: contactIdx,
    followThroughEnd: followEnd,
    personHeight,
    legLength,
    hipYs: smoothedHipY,
    hipXs: filledHipXs,
    wristSpeeds,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   5. Biomechanical Scoring Functions (ported from Python)
   ═══════════════════════════════════════════════════════════════════════════════ */

function calcApproachSpeed(frames: FrameDetection[], phases: Phases, fps: number): [number, number] {
  const xs = phases.hipXs.slice(phases.approachStart, Math.min(phases.approachEnd + 1, phases.hipXs.length))
  if (xs.length < 2) return [50, 0]

  // Cumulative path length instead of net displacement
  let totalDist = 0
  for (let i = 1; i < xs.length; i++) {
    totalDist += Math.abs(xs[i] - xs[i - 1])
  }

  const dt = xs.length / fps
  const rawSpeed = dt > 0 ? totalDist / dt : 0
  const speed = normalizeByHeight(rawSpeed, phases.personHeight)

  let score: number
  if (speed > 3.0) score = 92
  else if (speed > 2.0) score = 70 + ((speed - 2.0) / 1.0) * 22
  else if (speed > 1.0) score = 45 + ((speed - 1.0) / 1.0) * 25
  else score = 20 + (speed / 1.0) * 25

  return [clamp(score), Math.round(speed * 1000) / 1000]
}

function calcApproachAngle(frames: FrameDetection[], phases: Phases): [number, number] {
  const as = phases.approachStart
  const plant = phases.plantFrame
  const n = frames.length
  if (plant <= as + 1 || plant >= n) return [50, 0]

  // Movement direction: from mid-approach to plant
  const midApproach = Math.floor((as + plant) / 2)
  const moveDx = (phases.hipXs[plant] || 0) - (phases.hipXs[midApproach] || 0)
  const moveDy = (phases.hipYs[plant] || 0) - (phases.hipYs[midApproach] || 0)
  if (Math.abs(moveDx) + Math.abs(moveDy) < 5) return [50, 0]

  // Shoulder line angle at plant
  const kpPlant = frames[plant].keypoints
  if (kpConf(kpPlant, L_SHOULDER) < KP_CONF_THRESHOLD || kpConf(kpPlant, R_SHOULDER) < KP_CONF_THRESHOLD) {
    return [50, 0]
  }
  const shoulderAngle = angleOfLine(kpXY(kpPlant, L_SHOULDER), kpXY(kpPlant, R_SHOULDER))

  // Movement direction angle
  const moveAngle = (Math.atan2(moveDy, moveDx) * 180) / Math.PI

  // Angle between shoulder line and movement direction
  let angle = Math.abs(shoulderAngle - moveAngle)
  if (angle > 180) angle = 360 - angle
  if (angle > 90) angle = 180 - angle

  // A good approach has ~70-80° between shoulder line and movement direction
  // (player moving roughly perpendicular to their shoulder line = netward)
  let score = scoreBand(angle, 70, 80, 0)
  if (angle > 85) score = clamp(score - 15)

  return [clamp(score), Math.round(angle * 10) / 10]
}

function calcLastStepLength(frames: FrameDetection[], phases: Phases): [number, number] {
  const plant = phases.plantFrame
  const legLength = phases.legLength

  // Collect ankle positions before plant
  const ankleCenters: { idx: number; center: Point2D }[] = []
  const searchLimit = Math.max(0, plant - Math.round(frames.length * 0.3))

  for (let i = plant; i >= searchLimit; i--) {
    const kp = frames[i].keypoints
    if (kpConf(kp, L_ANKLE) > KP_CONF_THRESHOLD && kpConf(kp, R_ANKLE) > KP_CONF_THRESHOLD) {
      ankleCenters.push({
        idx: i,
        center: midpoint(kpXY(kp, L_ANKLE), kpXY(kp, R_ANKLE)),
      })
      if (ankleCenters.length >= 10) break
    }
  }

  if (ankleCenters.length < 2) return [50, 0]

  // Detect step changes
  const steps = [ankleCenters[0]]
  for (let i = 1; i < ankleCenters.length; i++) {
    if (dist(ankleCenters[i].center, steps[steps.length - 1].center) > legLength * 0.15) {
      steps.push(ankleCenters[i])
    }
  }

  if (steps.length < 2) return [50, 0]

  const stepLength = dist(steps[steps.length - 2].center, steps[steps.length - 1].center)
  const ratio = legLength > 0 ? stepLength / legLength : 0
  const score = scoreBand(ratio, 0.8, 1.2, 0)

  return [clamp(score), Math.round(ratio * 1000) / 1000]
}

function calcFootworkRhythm(frames: FrameDetection[], phases: Phases, fps: number): [number, number] {
  const plant = phases.plantFrame
  const n = frames.length

  const ankleYs: { idx: number; y: number }[] = []
  const startFrame = Math.max(0, plant - Math.round(fps * 2))

  for (let i = startFrame; i <= plant && i < n; i++) {
    const kp = frames[i].keypoints
    if (kpConf(kp, L_ANKLE) > KP_CONF_THRESHOLD && kpConf(kp, R_ANKLE) > KP_CONF_THRESHOLD) {
      ankleYs.push({ idx: i, y: Math.min(kpXY(kp, L_ANKLE).y, kpXY(kp, R_ANKLE).y) })
    } else if (kpConf(kp, L_ANKLE) > KP_CONF_THRESHOLD) {
      ankleYs.push({ idx: i, y: kpXY(kp, L_ANKLE).y })
    } else if (kpConf(kp, R_ANKLE) > KP_CONF_THRESHOLD) {
      ankleYs.push({ idx: i, y: kpXY(kp, R_ANKLE).y })
    }
  }

  if (ankleYs.length < 3) return [50, 0]

  const yVals = ankleYs.map((a) => a.y)
  const sm = smooth(yVals, 3)

  // Find foot plants: local maxima in y (lowest physical position)
  const plants: number[] = []
  const meanY = mean(sm)
  for (let i = 1; i < sm.length - 1; i++) {
    if (sm[i] >= sm[i - 1] && sm[i] >= sm[i + 1] && sm[i] > meanY - 5) {
      plants.push(ankleYs[i].idx)
    }
  }

  if (plants.length < 2) return [50, 0]

  const intervals: number[] = []
  for (let i = 1; i < plants.length; i++) {
    const dt = (plants[i] - plants[i - 1]) / fps
    if (dt > 0.05) intervals.push(dt)
  }

  if (intervals.length < 2) return [50, 0]

  // Acceleration pattern (slow-to-fast: intervals get shorter)
  let accelerationScore = 50
  if (intervals.length >= 2) {
    const ratios: number[] = []
    for (let i = 0; i < intervals.length - 1; i++) {
      if (intervals[i + 1] > 0) ratios.push(intervals[i] / intervals[i + 1])
    }
    if (ratios.length > 0) {
      const avgRatio = mean(ratios)
      if (avgRatio > 1.3) accelerationScore = 85
      else if (avgRatio > 1.1) accelerationScore = 75
      else if (avgRatio > 0.9) accelerationScore = 60
      else accelerationScore = 35
    }
  }

  // Consistency
  const cv = stdDev(intervals) / (mean(intervals) + 1e-8)
  const consistencyScore = Math.max(30, 90 - cv * 200)

  const score = accelerationScore * 0.6 + consistencyScore * 0.4
  return [clamp(score), Math.round(mean(intervals) * 1000) / 1000]
}

function calcArmsSwingBack(
  frames: FrameDetection[],
  phases: Phases,
  isLeftHanded: boolean,
): [number, number] {
  const plant = phases.plantFrame
  const asStart = phases.approachStart

  const offShoulder = isLeftHanded ? R_SHOULDER : L_SHOULDER
  const offWrist = isLeftHanded ? R_WRIST : L_WRIST

  const frameIndices: number[] = []
  for (let i = asStart; i <= Math.min(plant, frames.length - 1); i++) {
    frameIndices.push(i)
  }

  // Use confidence-weighted scoring for back angle
  const [weightedAngle, conf] = confidenceWeightedScore(
    frames, frameIndices,
    [offShoulder, offWrist, L_HIP, R_HIP],
    (kp) => {
      const hipC = midpoint(kpXY(kp, L_HIP), kpXY(kp, R_HIP))
      return angleBetween(hipC, kpXY(kp, offShoulder), kpXY(kp, offWrist))
    },
  )

  if (conf < 0.15) return [50, 0]

  let score: number
  if (weightedAngle > 150) score = 92
  else if (weightedAngle > 120) score = 78
  else if (weightedAngle > 90) score = 60
  else if (weightedAngle > 60) score = 40
  else score = 25

  return [clamp(score), Math.round(weightedAngle * 10) / 10]
}

function calcVerticalJumpConversion(
  frames: FrameDetection[],
  phases: Phases,
  fps: number,
): [number, number] {
  const plant = phases.plantFrame
  const peak = phases.jumpPeak

  if (peak <= plant) return [50, 0]

  const vertDisp = phases.hipYs[plant] - phases.hipYs[peak]

  // Horizontal speed at plant
  const window = Math.max(1, Math.round(fps * 0.2))
  const horizSpeeds: number[] = []
  for (let i = Math.max(0, plant - window); i < plant; i++) {
    if (i + 1 < phases.hipXs.length) {
      horizSpeeds.push(Math.abs(phases.hipXs[i + 1] - phases.hipXs[i]) * fps)
    }
  }
  const avgHorizSpeed = horizSpeeds.length > 0 ? mean(horizSpeeds) : 0

  const personHeight = phases.personHeight
  const jumpRatio = personHeight > 0 ? vertDisp / personHeight : 0

  let score: number
  if (jumpRatio > 0.8) score = 90
  else if (jumpRatio > 0.5) score = 72
  else if (jumpRatio > 0.3) score = 55
  else if (jumpRatio > 0.15) score = 40
  else score = 25

  // Bonus for good conversion ratio
  const ratio = avgHorizSpeed > 10 ? vertDisp / avgHorizSpeed : 0
  if (ratio > 0.3) score = Math.min(100, score + 5)

  return [clamp(score), Math.round(jumpRatio * 1000) / 1000]
}

function calcHipShoulderRotation(frames: FrameDetection[], phases: Phases): [number, number] {
  const n = frames.length
  let peak = Math.min(phases.jumpPeak, n - 1)

  const kp = frames[peak].keypoints
  let found = false

  // Try to find a frame with all 4 keypoints
  if (
    kpConf(kp, L_SHOULDER) > KP_CONF_THRESHOLD &&
    kpConf(kp, R_SHOULDER) > KP_CONF_THRESHOLD &&
    kpConf(kp, L_HIP) > KP_CONF_THRESHOLD &&
    kpConf(kp, R_HIP) > KP_CONF_THRESHOLD
  ) {
    found = true
  }

  if (!found) {
    for (let offset = 1; offset < 10 && !found; offset++) {
      for (const p of [peak - offset, peak + offset]) {
        if (p >= 0 && p < n) {
          const k = frames[p].keypoints
          if (
            kpConf(k, L_SHOULDER) > KP_CONF_THRESHOLD &&
            kpConf(k, R_SHOULDER) > KP_CONF_THRESHOLD &&
            kpConf(k, L_HIP) > KP_CONF_THRESHOLD &&
            kpConf(k, R_HIP) > KP_CONF_THRESHOLD
          ) {
            peak = p
            found = true
            break
          }
        }
      }
    }
  }

  const fkp = frames[peak].keypoints
  if (
    kpConf(fkp, L_SHOULDER) < KP_CONF_THRESHOLD ||
    kpConf(fkp, R_SHOULDER) < KP_CONF_THRESHOLD ||
    kpConf(fkp, L_HIP) < KP_CONF_THRESHOLD ||
    kpConf(fkp, R_HIP) < KP_CONF_THRESHOLD
  ) {
    return [50, 0]
  }

  const sAngle = angleOfLine(kpXY(fkp, L_SHOULDER), kpXY(fkp, R_SHOULDER))
  const hAngle = angleOfLine(kpXY(fkp, L_HIP), kpXY(fkp, R_HIP))

  let rotation = Math.abs(sAngle - hAngle)
  if (rotation > 90) rotation = 180 - rotation

  let score: number
  if (rotation >= 20 && rotation <= 45) score = 90
  else if (rotation >= 10 && rotation <= 60) score = 72
  else if (rotation >= 5) score = 55
  else score = 35

  return [clamp(score), Math.round(rotation * 10) / 10]
}

function calcBodyPositionAir(frames: FrameDetection[], phases: Phases): [number, number] {
  const n = frames.length
  const peak = Math.min(phases.jumpPeak, n - 1)

  const frameIndices: number[] = []
  for (let p = Math.max(0, peak - 3); p < Math.min(n, peak + 4); p++) {
    frameIndices.push(p)
  }

  const [weightedScore, conf] = confidenceWeightedScore(
    frames, frameIndices,
    [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_KNEE, R_KNEE],
    (kp) => {
      const shoulderC = midpoint(kpXY(kp, L_SHOULDER), kpXY(kp, R_SHOULDER))
      const hipC = midpoint(kpXY(kp, L_HIP), kpXY(kp, R_HIP))

      let torsoAngle = Math.abs(angleOfLine(shoulderC, hipC) - 90)
      if (torsoAngle > 90) torsoAngle = 180 - torsoAngle

      let s = 0
      if (torsoAngle >= 5 && torsoAngle <= 30) s += 45
      else if (torsoAngle <= 45) s += 30
      else s += 10

      s += 25 // base for being airborne

      if (kpConf(kp, L_KNEE) > KP_CONF_THRESHOLD && kpConf(kp, R_KNEE) > KP_CONF_THRESHOLD) {
        const kneeAngle = angleBetween(kpXY(kp, L_HIP), kpXY(kp, L_KNEE), kpXY(kp, L_ANKLE))
        if (kneeAngle > 100 && kneeAngle < 170) s += 20
        else if (kneeAngle <= 100) s += 10
        else s += 15
      }

      return s
    },
  )

  return [clamp(weightedScore), Math.round(conf * 100)]
}

function calcTorsoAngleAir(frames: FrameDetection[], phases: Phases): [number, number] {
  const n = frames.length
  const peak = Math.min(phases.jumpPeak, n - 1)

  const frameIndices: number[] = []
  for (let p = Math.max(0, peak - 3); p < Math.min(n, peak + 4); p++) {
    frameIndices.push(p)
  }

  const [weightedAngle, conf] = confidenceWeightedScore(
    frames, frameIndices,
    [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP],
    (kp) => {
      const shoulderC = midpoint(kpXY(kp, L_SHOULDER), kpXY(kp, R_SHOULDER))
      const hipC = midpoint(kpXY(kp, L_HIP), kpXY(kp, R_HIP))

      // Angle from vertical (0 = perfectly upright)
      let torsoAngle = Math.abs(angleOfLine(shoulderC, hipC) - 90)
      if (torsoAngle > 90) torsoAngle = 180 - torsoAngle
      return torsoAngle
    },
  )

  if (conf < 0.1) return [50, 0]

  // Optimal torso angle in air: slight backward lean ~10-25 degrees
  const score = scoreBand(weightedAngle, 10, 25, 60)
  return [clamp(score), Math.round(weightedAngle * 10) / 10]
}

function calcBowAndArrow(
  frames: FrameDetection[],
  phases: Phases,
  isLeftHanded: boolean,
): [number, number] {
  const contact = phases.contactFrame
  const n = frames.length

  const hitS = isLeftHanded ? L_SHOULDER : R_SHOULDER
  const hitE = isLeftHanded ? L_ELBOW : R_ELBOW
  const hitW = isLeftHanded ? L_WRIST : R_WRIST

  const searchStart = Math.max(0, contact - Math.round(n * 0.15))
  const searchEnd = contact

  let bestFrameScore = -1
  let bestArmAngle = 0
  let count = 0

  for (let i = searchStart; i < Math.min(searchEnd, n); i++) {
    const kp = frames[i].keypoints
    if (kpConf(kp, hitS) < KP_CONF_THRESHOLD || kpConf(kp, hitE) < KP_CONF_THRESHOLD || kpConf(kp, hitW) < KP_CONF_THRESHOLD) continue

    const shoulder = kpXY(kp, hitS)
    const elbow = kpXY(kp, hitE)
    const wrist = kpXY(kp, hitW)
    const personHeight = phases.personHeight

    const armAngle = angleBetween(shoulder, elbow, wrist)
    const wristBehindBody = wrist.y < shoulder.y  // wrist above shoulder in image coords = behind in side view
    const elbowHigh = elbow.y < shoulder.y  // elbow above shoulder

    // Score this frame's bow position
    let frameScore = 0

    // Arm angle component (90-160° is ideal bow)
    if (armAngle >= 120 && armAngle <= 150) frameScore += 40
    else if (armAngle >= 90 && armAngle <= 160) frameScore += 25
    else if (armAngle >= 70 && armAngle <= 175) frameScore += 12
    else frameScore += 3

    // Wrist behind body (above shoulder in image coords)
    if (wristBehindBody) frameScore += 25
    else frameScore += 3

    // Elbow high (above shoulder in image coords)
    if (elbowHigh) frameScore += 25
    else frameScore += 5

    // Wrist distance from shoulder (normalized by full body height)
    const wristDist = normalizeByHeight(dist(shoulder, wrist), personHeight)
    if (wristDist > 0.5) frameScore += 10
    else if (wristDist > 0.3) frameScore += 5
    else frameScore += 2

    if (frameScore > bestFrameScore) {
      bestFrameScore = frameScore
      bestArmAngle = armAngle
    }
    count++
  }

  if (count === 0) return [50, 0]

  return [clamp(bestFrameScore), Math.round(bestArmAngle * 10) / 10]
}

function calcArmSwingSpeed(
  frames: FrameDetection[],
  phases: Phases,
  isLeftHanded: boolean,
  fps: number,
): [number, number] {
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const n = frames.length
  const personHeight = phases.personHeight

  const speeds: number[] = [0]
  for (let i = 1; i < n; i++) {
    const w1 = frames[i - 1].keypoints
    const w2 = frames[i].keypoints
    if (kpConf(w1, hitW) > KP_CONF_THRESHOLD && kpConf(w2, hitW) > KP_CONF_THRESHOLD) {
      speeds.push(dist(kpXY(w1, hitW), kpXY(w2, hitW)) * fps)
    } else {
      speeds.push(0)
    }
  }

  const maxSpeed = Math.max(...speeds)
  const normalizedSpeed = normalizeByHeight(maxSpeed, personHeight)

  let score: number
  if (normalizedSpeed > 3.0) score = 92
  else if (normalizedSpeed > 2.0) score = 78
  else if (normalizedSpeed > 1.2) score = 60
  else if (normalizedSpeed > 0.6) score = 45
  else score = 25

  return [clamp(score), Math.round(maxSpeed * 100) / 100]
}

function calcContactPoint(
  frames: FrameDetection[],
  phases: Phases,
  isLeftHanded: boolean,
): [number, number] {
  const n = frames.length
  let contact = Math.min(phases.contactFrame, n - 1)

  const hitS = isLeftHanded ? L_SHOULDER : R_SHOULDER
  const hitE = isLeftHanded ? L_ELBOW : R_ELBOW
  const hitW = isLeftHanded ? L_WRIST : R_WRIST

  const kp = frames[contact].keypoints
  if (kpConf(kp, hitS) < KP_CONF_THRESHOLD || kpConf(kp, hitE) < KP_CONF_THRESHOLD || kpConf(kp, hitW) < KP_CONF_THRESHOLD) {
    return [50, 0]
  }

  const armAngle = angleBetween(kpXY(kp, hitS), kpXY(kp, hitE), kpXY(kp, hitW))

  let score = 0
  if (armAngle >= 170) score += 60
  else if (armAngle >= 155) score += 45
  else if (armAngle >= 130) score += 30
  else score += 10

  // Check contact height relative to peak
  const peak = Math.min(phases.jumpPeak, n - 1)
  const peakHipY = phases.hipYs[peak]
  const contactHipY = phases.hipYs[contact]
  const personHeight = phases.personHeight
  const heightDiff = normalizeByHeight(Math.abs(peakHipY - contactHipY), personHeight)

  if (heightDiff < 0.05) score += 40
  else if (heightDiff < 0.15) score += 30
  else if (heightDiff < 0.3) score += 15
  else score += 5

  return [clamp(score), Math.round(armAngle * 10) / 10]
}

function calcWristSnap(
  frames: FrameDetection[],
  phases: Phases,
  isLeftHanded: boolean,
  fps: number,
): [number, number] {
  const contact = phases.contactFrame
  const n = frames.length
  const ftEnd = phases.followThroughEnd

  const hitS = isLeftHanded ? L_SHOULDER : R_SHOULDER
  const hitE = isLeftHanded ? L_ELBOW : R_ELBOW
  const hitW = isLeftHanded ? L_WRIST : R_WRIST

  const anglesAfter: (number | null)[] = []
  for (let i = contact; i <= Math.min(ftEnd, n - 1); i++) {
    const kp = frames[i].keypoints
    if (kpConf(kp, hitS) < KP_CONF_THRESHOLD || kpConf(kp, hitE) < KP_CONF_THRESHOLD || kpConf(kp, hitW) < KP_CONF_THRESHOLD) {
      anglesAfter.push(null)
      continue
    }
    anglesAfter.push(angleOfLine(kpXY(kp, hitE), kpXY(kp, hitW)))
  }

  const validAngles: { idx: number; angle: number }[] = []
  for (let i = 0; i < anglesAfter.length; i++) {
    if (anglesAfter[i] !== null) validAngles.push({ idx: i, angle: anglesAfter[i]! })
  }

  if (validAngles.length < 3) return [50, 0]

  const angVelocities: number[] = []
  for (let j = 1; j < validAngles.length; j++) {
    const di = validAngles[j].idx - validAngles[j - 1].idx
    const da = validAngles[j].angle - validAngles[j - 1].angle
    if (di > 0) angVelocities.push(Math.abs(da / di) * fps)
  }

  if (angVelocities.length === 0) return [50, 0]

  const maxAngVel = Math.max(...angVelocities)

  let score: number
  if (maxAngVel > 500) score = 90
  else if (maxAngVel > 300) score = 75
  else if (maxAngVel > 150) score = 55
  else score = 35

  return [clamp(score), Math.round(maxAngVel * 100) / 100]
}

function calcContactHeight(
  frames: FrameDetection[],
  phases: Phases,
  isLeftHanded: boolean,
): [number, number] {
  const n = frames.length
  const contact = Math.min(phases.contactFrame, n - 1)
  const peak = Math.min(phases.jumpPeak, n - 1)
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const personHeight = phases.personHeight

  // Find peak wrist height in a window around the jump peak
  const windowStart = Math.max(0, peak - 5)
  const windowEnd = Math.min(n, peak + 6)
  const wristYs: number[] = []
  for (let i = windowStart; i < windowEnd; i++) {
    if (kpConf(frames[i].keypoints, hitW) > KP_CONF_THRESHOLD) {
      wristYs.push(frames[i].keypoints[hitW].y)
    }
  }

  if (wristYs.length === 0) return [50, 0]

  const minWristY = Math.min(...wristYs) // highest point in image coords

  // Measure how close contact frame's wrist Y is to the peak wrist Y
  let heightDiff: number
  if (kpConf(frames[contact].keypoints, hitW) > KP_CONF_THRESHOLD) {
    const contactWristY = frames[contact].keypoints[hitW].y
    heightDiff = normalizeByHeight(contactWristY - minWristY, personHeight)
  } else {
    // Fallback to hip-based measurement
    const peakHipY = phases.hipYs[peak]
    const contactHipY = phases.hipYs[contact]
    heightDiff = normalizeByHeight(contactHipY - peakHipY, personHeight)
  }

  let score: number
  if (heightDiff < 0.03) score = 95
  else if (heightDiff < 0.1) score = 85
  else if (heightDiff < 0.2) score = 70
  else if (heightDiff < 0.35) score = 50
  else if (heightDiff < 0.5) score = 35
  else score = 20

  return [clamp(score), Math.round(heightDiff * 1000) / 1000]
}

function calcFollowThrough(
  frames: FrameDetection[],
  phases: Phases,
  isLeftHanded: boolean,
): [number, number] {
  const contact = phases.contactFrame
  const ftEnd = phases.followThroughEnd
  const n = frames.length

  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const oppHip = isLeftHanded ? R_HIP : L_HIP

  if (ftEnd <= contact || contact >= n) return [50, 0]

  // Collect wrist positions and velocities after contact
  const wristData: { pos: Point2D; speed: number }[] = []
  for (let i = contact; i <= Math.min(ftEnd, n - 1); i++) {
    const kp = frames[i].keypoints
    if (kpConf(kp, hitW) > KP_CONF_THRESHOLD) {
      const pos = kpXY(kp, hitW)
      const speed = i > contact && kpConf(frames[i - 1].keypoints, hitW) > KP_CONF_THRESHOLD
        ? dist(pos, kpXY(frames[i - 1].keypoints, hitW))
        : 0
      wristData.push({ pos, speed })
    }
  }

  if (wristData.length < 2) return [50, 0]

  // 1. Total arc length (normalized by person height)
  let arcLength = 0
  for (let i = 1; i < wristData.length; i++) {
    arcLength += dist(wristData[i].pos, wristData[i - 1].pos)
  }
  const normalizedArc = normalizeByHeight(arcLength, phases.personHeight)

  let arcScore: number
  if (normalizedArc > 1.2) arcScore = 35
  else if (normalizedArc > 0.6) arcScore = 25
  else if (normalizedArc > 0.3) arcScore = 15
  else arcScore = 5

  // 2. Whether wrist crosses opposite-side hip X
  const kpContact = frames[Math.min(contact, n - 1)].keypoints
  let oppHipX = wristData[0].pos.x // fallback
  if (kpConf(kpContact, oppHip) > KP_CONF_THRESHOLD) {
    oppHipX = kpXY(kpContact, oppHip).x
  }

  const crossesOppHip = wristData.some(
    (wd) => {
      // Wrist crosses to the opposite side of the body
      if (isLeftHanded) return wd.pos.x > oppHipX
      else return wd.pos.x < oppHipX
    }
  )
  const crossScore = crossesOppHip ? 35 : 8

  // 3. Smooth deceleration (not abrupt stop)
  const validSpeeds = wristData.map(wd => wd.speed).filter(s => s > 0)
  let decelScore = 15 // base
  if (validSpeeds.length >= 3) {
    const third = Math.max(1, Math.floor(validSpeeds.length / 3))
    const firstThirdAvg = mean(validSpeeds.slice(0, third))
    const lastThirdAvg = mean(validSpeeds.slice(-third))
    if (firstThirdAvg > 0 && lastThirdAvg < firstThirdAvg * 0.5) {
      decelScore = 30 // smooth deceleration
    } else if (firstThirdAvg > 0 && lastThirdAvg < firstThirdAvg * 0.8) {
      decelScore = 22
    }
  }

  // 4. Downward movement bonus
  const lastWrist = wristData[wristData.length - 1].pos
  const firstWrist = wristData[0].pos
  const downwardBonus = lastWrist.y > firstWrist.y ? 5 : 0

  const score = arcScore + crossScore + decelScore + downwardBonus
  return [clamp(score), Math.round(normalizedArc * 1000) / 1000]
}

function calcLandingBalance(frames: FrameDetection[], phases: Phases): [number, number] {
  const peak = phases.jumpPeak
  const n = frames.length
  const personHeight = phases.personHeight

  if (peak >= n - 3) return [50, 0]

  // Find landing frame
  const approachHipY = phases.hipYs[phases.plantFrame]
  let landingFrame = peak

  for (let i = peak + 1; i < n; i++) {
    if (phases.hipYs[i] >= approachHipY - personHeight * 0.05) {
      landingFrame = i
      break
    }
    if (i === n - 1) landingFrame = i
  }

  if (landingFrame >= n) landingFrame = n - 1

  const kp = frames[landingFrame].keypoints
  let score = 0

  // Knee angles at landing — deeper flexion is better for shock absorption
  const kneeScores: number[] = []
  const checks: [number, number, number][] = [
    [L_KNEE, L_ANKLE, L_HIP],
    [R_KNEE, R_ANKLE, R_HIP],
  ]
  for (const [kneeIdx, ankleIdx, hipIdx] of checks) {
    if (kpConf(kp, kneeIdx) > KP_CONF_THRESHOLD && kpConf(kp, ankleIdx) > KP_CONF_THRESHOLD && kpConf(kp, hipIdx) > KP_CONF_THRESHOLD) {
      const kneeAngle = angleBetween(kpXY(kp, hipIdx), kpXY(kp, kneeIdx), kpXY(kp, ankleIdx))
      // 90-130° is ideal for landing (deep flexion = good shock absorption)
      if (kneeAngle >= 90 && kneeAngle <= 130) kneeScores.push(90)
      else if (kneeAngle >= 80 && kneeAngle <= 150) kneeScores.push(75)
      else if (kneeAngle < 160) kneeScores.push(55)
      else if (kneeAngle < 175) kneeScores.push(35)
      else kneeScores.push(20)
    }
  }
  score += kneeScores.length > 0 ? Math.round(mean(kneeScores)) : 25

  // Hip drop measurement and levelness
  if (kpConf(kp, L_HIP) > KP_CONF_THRESHOLD && kpConf(kp, R_HIP) > KP_CONF_THRESHOLD) {
    const landingHipC = midpoint(kpXY(kp, L_HIP), kpXY(kp, R_HIP))
    const standingHipY = approachHipY || landingHipC.y
    const hipDrop = normalizeByHeight(landingHipC.y - standingHipY, personHeight)

    // Hip drop relative to standing position (positive = lower = good for landing)
    if (hipDrop > 0.05) score += 15  // hips dropped nicely
    else if (hipDrop > 0) score += 10
    else score += 5  // hips didn't drop = straight leg landing

    // Hip levelness
    const hipDiff = Math.abs(kpXY(kp, L_HIP).y - kpXY(kp, R_HIP).y)
    if (hipDiff < personHeight * 0.03) score += 10
    else if (hipDiff < personHeight * 0.08) score += 6
    else score += 2
  }

  // Both feet visible and roughly level (no excessive stagger)
  if (kpConf(kp, L_ANKLE) > KP_CONF_THRESHOLD && kpConf(kp, R_ANKLE) > KP_CONF_THRESHOLD) {
    const ankleYDiff = Math.abs(kpXY(kp, L_ANKLE).y - kpXY(kp, R_ANKLE).y)
    if (ankleYDiff < personHeight * 0.05) score += 10  // feet level
    else if (ankleYDiff < personHeight * 0.15) score += 6
    else score += 3
    score += 5  // bonus for both visible
  } else if (kpConf(kp, L_ANKLE) > KP_CONF_THRESHOLD || kpConf(kp, R_ANKLE) > KP_CONF_THRESHOLD) {
    score += 3
  }

  return [clamp(score), 0]
}

/* ═══════════════════════════════════════════════════════════════════════════════
   6. Feedback Generation (ported from Python)
   ═══════════════════════════════════════════════════════════════════════════════ */

function generatePhaseFeedback(
  phaseName: string,
  scores: Record<string, number>,
  _scoreValue: number,
): string {
  if (phaseName === 'approach') {
    const speed = scores['approach_speed'] ?? 50
    const angle = scores['approach_angle'] ?? 50
    const rhythm = scores['footwork_rhythm'] ?? 50
    const arms = scores['arms_swing_back'] ?? 50

    const parts: string[] = []
    if (speed < 60) {
      parts.push('Your approach speed is below optimal, limiting momentum for the jump. Try taking more explosive, longer strides in your final three steps.')
    } else if (speed > 85) {
      parts.push('Excellent approach speed that generates strong momentum for your jump.')
    } else {
      parts.push('Your approach speed is moderate. Focus on gradually accelerating through your final three steps to build more momentum.')
    }

    if (angle < 60) {
      parts.push('The approach angle could be more diagonal to the net, around 45 degrees, to better load your hitting shoulder.')
    } else if (rhythm < 60) {
      parts.push('Work on a more consistent, accelerating footwork rhythm (slow-to-fast pattern) in your approach.')
    }

    if (arms < 55) {
      parts.push("Your arms aren't swinging back far enough during the approach, which reduces jump power. Focus on a full armswing back past your hips.")
    }

    if (parts.length === 0) {
      parts.push('Your approach shows good fundamentals with solid speed and direction. Continue refining the rhythm and arm mechanics for even more power.')
    }

    return parts.slice(0, 3).join(' ')
  }

  if (phaseName === 'jump') {
    const vjc = scores['vertical_jump_conversion'] ?? 50
    const rot = scores['hip_shoulder_rotation'] ?? 50
    const body = scores['body_position_air'] ?? 50

    const parts: string[] = []
    if (vjc < 60) {
      parts.push("Your jump isn't converting enough horizontal momentum into vertical height. Focus on a more explosive plant step with a deep knee bend.")
    } else if (vjc > 85) {
      parts.push('Great conversion of approach speed into vertical jump height.')
    }

    if (rot < 55) {
      parts.push('Increase hip-shoulder separation during your jump to generate more rotational torque for a powerful swing.')
    } else if (rot > 85) {
      parts.push('Excellent hip-shoulder rotation creating strong torque for the swing.')
    }

    if (body < 55) {
      parts.push('Work on maintaining better body position in the air, with a slight arch and your hitting arm loaded back ready to swing.')
    } else if (body > 85) {
      parts.push('Your body position at peak jump is excellent, setting up a powerful attack position.')
    }

    if (parts.length === 0) {
      parts.push('Your jump mechanics are solid. Focus on maximizing both height and rotation to increase hitting power.')
    }

    return parts.slice(0, 3).join(' ')
  }

  if (phaseName === 'contact') {
    const bow = scores['bow_and_arrow'] ?? 50
    const armSpd = scores['arm_swing_speed'] ?? 50
    const contactPt = scores['contact_point'] ?? 50
    const wristSnap = scores['wrist_snap'] ?? 50

    const parts: string[] = []
    if (bow < 55) {
      parts.push('Your bow-and-arrow loading position needs improvement. Focus on getting your hitting elbow high and back with the wrist behind your head before swinging.')
    } else if (bow > 85) {
      parts.push('Excellent bow-and-arrow loading position that maximizes power potential.')
    }

    if (armSpd < 55) {
      parts.push('Your arm swing speed is below optimal. Work on a faster, more whip-like swing starting from a loaded position.')
    } else if (armSpd > 85) {
      parts.push('Impressive arm swing speed generating excellent hitting power.')
    }

    if (contactPt < 60) {
      parts.push('Focus on reaching full arm extension at contact and hitting at the peak of your jump for maximum power and court coverage.')
    } else if (wristSnap < 60) {
      parts.push('Add more wrist snap at contact to generate topspin and make the ball harder to pass.')
    }

    if (parts.length === 0) {
      parts.push('Your contact mechanics are strong with good arm speed and extension. Fine-tune your wrist snap for added spin and control.')
    }

    return parts.slice(0, 3).join(' ')
  }

  if (phaseName === 'followThrough') {
    const ft = scores['follow_through'] ?? 50
    const landing = scores['landing_balance'] ?? 50

    const parts: string[] = []
    if (ft < 55) {
      parts.push('Your follow-through is cut short. Let your hitting arm continue across your body toward the opposite hip after contact for better ball control and power transfer.')
    } else if (ft > 85) {
      parts.push('Great follow-through with your arm fully extending across your body.')
    }

    if (landing < 55) {
      parts.push('Work on landing with bent knees and balanced footing to reduce injury risk and prepare for the next play. Land with both feet and absorb the impact through your legs.')
    } else if (landing > 85) {
      parts.push('Excellent balanced landing with proper knee bend, ready for the next play.')
    }

    if (parts.length === 0) {
      parts.push('Your follow-through and landing are fundamentally sound. Keep focusing on a full arm swing through and soft, balanced landings.')
    }

    return parts.slice(0, 3).join(' ')
  }

  return 'Keep working on the fundamentals of this phase.'
}

function generateStrengthsAndWeaknesses(
  scores: Record<string, number>,
): [string[], string[]] {
  const checkpoints: Record<string, string> = {
    approach_speed: 'Approach Speed',
    approach_angle: 'Approach Angle',
    last_step_length: 'Last Step Length',
    footwork_rhythm: 'Footwork Rhythm',
    arms_swing_back: 'Arms Swing Back',
    vertical_jump_conversion: 'Vertical Jump Conversion',
    hip_shoulder_rotation: 'Hip-Shoulder Rotation',
    body_position_air: 'Body Position in Air',
    torso_angle_air: 'Torso Angle (Airborne)',
    bow_and_arrow: 'Bow and Arrow Load',
    arm_swing_speed: 'Arm Swing Speed',
    contact_point: 'Contact Point',
    wrist_snap: 'Wrist Snap',
    contact_height: 'Contact Height',
    follow_through: 'Follow Through',
    landing_balance: 'Landing Balance',
  }

  const explanations: Record<string, string> = {
    approach_speed: 'generates strong momentum for the jump',
    approach_angle: 'creates optimal diagonal path to the net',
    last_step_length: 'provides a powerful braking step for the jump',
    footwork_rhythm: 'builds acceleration effectively with a slow-to-fast pattern',
    arms_swing_back: 'loads energy for a higher vertical jump',
    vertical_jump_conversion: 'efficiently converts horizontal speed into vertical height',
    hip_shoulder_rotation: 'creates torque for a powerful arm swing',
    body_position_air: 'sets up an optimal athletic hitting position',
    torso_angle_air: 'positions the torso for maximum hitting power',
    bow_and_arrow: 'maximizes power potential with proper arm loading',
    arm_swing_speed: 'generates exceptional hitting power',
    contact_point: 'ensures maximum power and court coverage at the ball',
    wrist_snap: 'adds topspin for a harder ball to pass',
    contact_height: 'hits the ball at the highest possible point',
    follow_through: 'ensures full power transfer and ball control',
    landing_balance: 'reduces injury risk and prepares for the next play',
  }

  const weakExplanations: Record<string, string> = {
    approach_speed: 'limits momentum, reducing jump height and hitting power',
    approach_angle: 'reduces the ability to load the hitting shoulder properly',
    last_step_length: 'limits the braking force needed for a powerful jump',
    footwork_rhythm: 'reduces approach efficiency and jump timing',
    arms_swing_back: 'loses energy that could add height to the jump',
    vertical_jump_conversion: 'wastes approach momentum instead of converting it to jump height',
    hip_shoulder_rotation: 'limits rotational power for the arm swing',
    body_position_air: 'reduces hitting power and control at contact',
    torso_angle_air: 'reduces hitting power and ball control at contact',
    bow_and_arrow: 'limits power potential by not loading the arm properly',
    arm_swing_speed: 'reduces hitting power significantly',
    contact_point: 'loses power and reduces the ability to hit over the block',
    wrist_snap: 'results in flat hits that are easier to dig',
    contact_height: 'allows blockers to reach the ball more easily',
    follow_through: 'reduces power transfer and ball control',
    landing_balance: 'increases injury risk and slows transition to next play',
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])

  const strengths: string[] = []
  for (const [key, val] of sorted.slice(0, 3)) {
    const name = checkpoints[key] || key
    const expl = explanations[key] || 'shows good execution'
    strengths.push(`${name}: ${expl}`)
  }

  const weaknesses: string[] = []
  for (const [key, val] of sorted.slice(-3)) {
    const name = checkpoints[key] || key
    const expl = weakExplanations[key] || 'needs improvement'
    weaknesses.push(`${name}: ${expl}`)
  }
  weaknesses.reverse()

  return [strengths, weaknesses]
}

function generateCoachNotes(scores: Record<string, number>, estimatedLevel: string): string {
  const sorted = Object.entries(scores).sort((a, b) => a[1] - b[1])
  const weakest = sorted.slice(0, 3)
  const strongest = sorted.slice(-3)

  let notes = ''

  if (estimatedLevel === 'beginner' || estimatedLevel === 'intermediate') {
    notes = 'Focus on building a consistent approach with accelerating footwork and a full armswing to maximize your jump height. '
    const weakNames = weakest.map(([k]) => k.replace(/_/g, ' '))
    if (weakNames.length > 0) notes += `Your main areas for improvement are ${weakNames.join(', ')}. `
    notes += 'Work on these fundamentals before adding more advanced techniques like increased rotation or arm speed. '
    notes += 'Film yourself regularly and compare to elite hitters to develop a visual model of proper technique.'
  } else if (estimatedLevel === 'advanced') {
    const weakNames = weakest.slice(0, 2).map(([k]) => k.replace(/_/g, ' '))
    notes = 'You have solid fundamentals with room to refine your technique for maximum power. '
    if (weakNames.length > 0) notes += `Focus specifically on improving ${weakNames.join(', ')} to take your hitting to the next level. `
    notes += 'At this level, small mechanical improvements translate to significant performance gains. '
    notes += 'Consider working with a coach on video analysis to fine-tune these specific areas.'
  } else {
    const weakNames = weakest.slice(0, 2).map(([k]) => k.replace(/_/g, ' '))
    notes = 'Your technique is at an elite level with strong mechanics across most checkpoints. '
    if (weakNames.length > 0) notes += `Even at this level, continue refining ${weakNames.join(', ')} to maintain consistency. `
    notes += 'Focus on maintaining these mechanics under game pressure and fatigue conditions. '
    notes += 'Use this analysis as a baseline for tracking mechanical consistency across matches and training sessions.'
  }

  return notes
}

function estimateLevel(avgScore: number): string {
  if (avgScore >= 82) return 'elite'
  if (avgScore >= 65) return 'advanced'
  if (avgScore >= 45) return 'intermediate'
  return 'beginner'
}

function estimateApproachSpeedLabel(score: number): string {
  if (score >= 85) return 'explosive'
  if (score >= 65) return 'fast'
  if (score >= 45) return 'moderate'
  return 'slow'
}

/* ═══════════════════════════════════════════════════════════════════════════════
   7. Confidence Estimation
   ═══════════════════════════════════════════════════════════════════════════════ */

function computeConfidence(
  frames: FrameDetection[],
  phases: Phases,
): CheckpointConfidence {
  const conf: Record<string, number> = {}

  // For each checkpoint, estimate confidence based on keypoint visibility
  // in the relevant frames

  const avgKPConf = (frameIndices: number[], kpIndices: number[]): number => {
    const vals: number[] = []
    for (const fi of frameIndices) {
      if (fi >= 0 && fi < frames.length) {
        for (const ki of kpIndices) {
          vals.push(frames[fi].keypoints[ki].confidence)
        }
      }
    }
    return vals.length > 0 ? mean(vals) * 100 : 0
  }

  const approachFrames = Array.from(
    { length: phases.approachEnd - phases.approachStart + 1 },
    (_, i) => phases.approachStart + i,
  )
  const jumpFrames = Array.from(
    { length: phases.jumpPeak - phases.jumpStart + 1 },
    (_, i) => phases.jumpStart + i,
  )
  const contactFrames = [phases.contactFrame]
  const ftFrames = Array.from(
    { length: phases.followThroughEnd - phases.contactFrame + 1 },
    (_, i) => phases.contactFrame + i,
  )

  // Approach metrics
  conf['approach_speed'] = avgKPConf(approachFrames, [L_HIP, R_HIP])
  conf['approach_angle'] = avgKPConf(approachFrames, [L_HIP, R_HIP])
  conf['last_step_length'] = avgKPConf(approachFrames, [L_ANKLE, R_ANKLE])
  conf['footwork_rhythm'] = avgKPConf(approachFrames, [L_ANKLE, R_ANKLE])
  conf['arms_swing_back'] = avgKPConf(approachFrames, [L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST])

  // Jump metrics
  conf['vertical_jump_conversion'] = avgKPConf(jumpFrames, [L_HIP, R_HIP])
  conf['hip_shoulder_rotation'] = avgKPConf(jumpFrames, [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP])
  conf['body_position_air'] = avgKPConf(jumpFrames, [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_KNEE, R_KNEE])
  conf['torso_angle_air'] = avgKPConf(jumpFrames, [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP])

  // Contact metrics
  conf['bow_and_arrow'] = avgKPConf(contactFrames, [R_SHOULDER, R_ELBOW, R_WRIST])
  conf['arm_swing_speed'] = avgKPConf(ftFrames, [R_WRIST])
  conf['contact_point'] = avgKPConf(contactFrames, [R_SHOULDER, R_ELBOW, R_WRIST])
  conf['wrist_snap'] = avgKPConf(ftFrames, [R_SHOULDER, R_ELBOW, R_WRIST])
  conf['contact_height'] = avgKPConf(contactFrames, [R_WRIST])

  // Follow-through
  conf['follow_through'] = avgKPConf(ftFrames, [R_WRIST, L_HIP, R_HIP])
  conf['landing_balance'] = avgKPConf(
    [Math.min(phases.followThroughEnd, frames.length - 1)],
    [L_KNEE, R_KNEE, L_ANKLE, R_ANKLE, L_HIP, R_HIP],
  )

  return conf as unknown as CheckpointConfidence
}

function computeCheckpointFeedback(scores: CheckpointScores): Record<string, string> {
  const fb: Record<string, string> = {}

  const ckptLabels: Record<keyof CheckpointScores, string> = {
    approach_speed: 'Approach Speed',
    approach_angle: 'Approach Angle',
    last_step_length: 'Last Step Length',
    footwork_rhythm: 'Footwork Rhythm',
    arms_swing_back: 'Arms Swing Back on Plant',
    vertical_jump_conversion: 'Vertical Jump Conversion',
    hip_shoulder_rotation: 'Hip-Shoulder Rotation',
    body_position_air: 'Body Position in Air',
    torso_angle_air: 'Torso Angle (Airborne)',
    bow_and_arrow: 'Bow-and-Arrow Position',
    arm_swing_speed: 'Arm Swing Speed',
    contact_point: 'Contact Point',
    wrist_snap: 'Wrist Snap (Topspin)',
    contact_height: 'Contact Height',
    follow_through: 'Follow-Through',
    landing_balance: 'Landing Balance',
  }

  for (const [key, label] of Object.entries(ckptLabels)) {
    const score = scores[key as keyof CheckpointScores]
    if (score >= 76) {
      fb[key] = `${label} looks great — maintain this technique.`
    } else if (score >= 51) {
      fb[key] = `${label} is decent. Small improvements here will add up.`
    } else {
      fb[key] = `${label} needs significant work — prioritize this in training.`
    }
  }

  return fb
}

/* ═══════════════════════════════════════════════════════════════════════════════
   8. Priority Order
   ═══════════════════════════════════════════════════════════════════════════════ */

function computePriorityOrder(scores: CheckpointScores): string[] {
  // Prioritize: lowest scores first, weighted by phase importance
  // Contact phase is highest priority, then jump, then approach, then follow-through
  const phaseWeight: Record<string, number> = {
    bow_and_arrow: 1.4,
    arm_swing_speed: 1.3,
    contact_point: 1.5,
    wrist_snap: 1.2,
    contact_height: 1.4,
    vertical_jump_conversion: 1.3,
    hip_shoulder_rotation: 1.1,
    body_position_air: 1.0,
    torso_angle_air: 0.9,
    approach_speed: 1.0,
    approach_angle: 0.8,
    last_step_length: 0.9,
    footwork_rhythm: 0.9,
    arms_swing_back: 1.0,
    follow_through: 0.7,
    landing_balance: 0.6,
  }

  return Object.entries(scores)
    .map(([key, score]) => ({
      key,
      priority: (100 - (score as number)) * (phaseWeight[key] || 1),
    }))
    .sort((a, b) => b.priority - a.priority)
    .map((item) => item.key)
}

/* ═══════════════════════════════════════════════════════════════════════════════
   9. Main Export
   ═══════════════════════════════════════════════════════════════════════════════ */

export async function analyzeVideoInBrowser(
  videoFile: File,
  onProgress: (msg: string, pct: number) => void,
): Promise<SpikeAnalysis> {
  try {
    // ── Step 1: Extract frames ────────────────────────────────────────
    onProgress('Extracting frames from video...', 3)
    const frames = await extractFrames(videoFile, onProgress)

    if (frames.length === 0) {
      throw new Error('Could not extract any frames from the video.')
    }

    // ── Step 2: Load ONNX model & run inference ──────────────────────
    onProgress('Loading AI model...', 22)
    const session = await loadOnnxSession(onProgress)

    onProgress('Running pose detection...', 30)
    const rawDetections = await runInference(frames, session, onProgress)

    if (rawDetections.length === 0) {
      throw new Error(
        'No person detected in the video. Ensure the video shows a clear view of a volleyball player spiking.',
      )
    }

    // ── Step 3: Track & interpolate ───────────────────────────────────
    onProgress('Tracking player across frames...', 52)
    await yieldToUI()

    let trackedFrames = trackPlayer(rawDetections)
    trackedFrames = interpolateMissing(trackedFrames)

    if (trackedFrames.length < 5) {
      throw new Error(
        `Too few frames with valid detections (${trackedFrames.length}). Need at least 5 frames for analysis. Try a longer or clearer video.`,
      )
    }

    // ── Step 4: Detect handedness & phases ────────────────────────────
    onProgress('Detecting movement phases...', 55)
    await yieldToUI()

    const isLeftHanded = detectHandedness(trackedFrames)

    // Estimate FPS from frame timestamps
    const timestamps = trackedFrames.map((f) => f.timestamp)
    const dt = timestamps[timestamps.length - 1] - timestamps[0]
    const estimatedFps = dt > 0 ? (trackedFrames.length - 1) / dt : 10

    const phases = detectPhases(trackedFrames, estimatedFps, isLeftHanded)

    // ── Step 5: Compute all 16 biomechanical scores ───────────────────
    onProgress('Computing biomechanical scores...', 60)
    await yieldToUI()

    const scores: Record<string, number> = {}

    // Approach phase
    const [asSpeed, asSpeedVal] = calcApproachSpeed(trackedFrames, phases, estimatedFps)
    scores['approach_speed'] = asSpeed

    const [asAngle] = calcApproachAngle(trackedFrames, phases)
    scores['approach_angle'] = asAngle

    const [lastStep] = calcLastStepLength(trackedFrames, phases)
    scores['last_step_length'] = lastStep

    const [rhythm] = calcFootworkRhythm(trackedFrames, phases, estimatedFps)
    scores['footwork_rhythm'] = rhythm

    const [armsSwing] = calcArmsSwingBack(trackedFrames, phases, isLeftHanded)
    scores['arms_swing_back'] = armsSwing

    onProgress('Computing jump & contact scores...', 70)
    await yieldToUI()

    // Jump phase
    const [vjc] = calcVerticalJumpConversion(trackedFrames, phases, estimatedFps)
    scores['vertical_jump_conversion'] = vjc

    const [rotation] = calcHipShoulderRotation(trackedFrames, phases)
    scores['hip_shoulder_rotation'] = rotation

    const [bodyPos] = calcBodyPositionAir(trackedFrames, phases)
    scores['body_position_air'] = bodyPos

    const [torsoAngle] = calcTorsoAngleAir(trackedFrames, phases)
    scores['torso_angle_air'] = torsoAngle

    // Contact phase
    const [bowArrow] = calcBowAndArrow(trackedFrames, phases, isLeftHanded)
    scores['bow_and_arrow'] = bowArrow

    const [armSwingSpd] = calcArmSwingSpeed(trackedFrames, phases, isLeftHanded, estimatedFps)
    scores['arm_swing_speed'] = armSwingSpd

    const [contactPt] = calcContactPoint(trackedFrames, phases, isLeftHanded)
    scores['contact_point'] = contactPt

    const [wristSnap] = calcWristSnap(trackedFrames, phases, isLeftHanded, estimatedFps)
    scores['wrist_snap'] = wristSnap

    const [contactH] = calcContactHeight(trackedFrames, phases, isLeftHanded)
    scores['contact_height'] = contactH

    onProgress('Computing follow-through scores...', 80)
    await yieldToUI()

    // Follow-through phase
    const [followThru] = calcFollowThrough(trackedFrames, phases, isLeftHanded)
    scores['follow_through'] = followThru

    const [landingBal] = calcLandingBalance(trackedFrames, phases)
    scores['landing_balance'] = landingBal

    // ── Step 6: Compute phase scores ──────────────────────────────────
    const approachScore = clamp(
      mean([scores['approach_speed'], scores['approach_angle'], scores['last_step_length'], scores['footwork_rhythm'], scores['arms_swing_back']]),
    )
    const jumpScore = clamp(
      mean([scores['vertical_jump_conversion'], scores['hip_shoulder_rotation'], scores['body_position_air']]),
    )
    const contactScore = clamp(
      mean([scores['bow_and_arrow'], scores['arm_swing_speed'], scores['contact_point'], scores['wrist_snap'], scores['contact_height']]),
    )
    const ftScore = clamp(mean([scores['follow_through'], scores['landing_balance']]))

    const avgScore = mean(Object.values(scores))

    // ── Step 7: Generate feedback ─────────────────────────────────────
    onProgress('Generating coaching feedback...', 88)
    await yieldToUI()

    const phaseAnalysis: PhaseAnalyses = {
      approach: {
        score: approachScore,
        feedback: generatePhaseFeedback('approach', scores, approachScore),
      },
      jump: {
        score: jumpScore,
        feedback: generatePhaseFeedback('jump', scores, jumpScore),
      },
      contact: {
        score: contactScore,
        feedback: generatePhaseFeedback('contact', scores, contactScore),
      },
      followThrough: {
        score: ftScore,
        feedback: generatePhaseFeedback('followThrough', scores, ftScore),
      },
    }

    const [topStrengths, topWeaknesses] = generateStrengthsAndWeaknesses(scores)

    const level = estimateLevel(avgScore)
    const approachSpeedLabel = estimateApproachSpeedLabel(scores['approach_speed'])
    const coachNotes = generateCoachNotes(scores, level)
    const overallPower = clamp(
      mean([scores['approach_speed'], scores['arm_swing_speed'], scores['vertical_jump_conversion'], scores['bow_and_arrow'], scores['hip_shoulder_rotation'], scores['contact_point']]),
    )

    // Confidence
    const confidence = computeConfidence(trackedFrames, phases)
    const checkpointFeedback = computeCheckpointFeedback(scores as unknown as CheckpointScores)
    const priorityOrder = computePriorityOrder(scores as unknown as CheckpointScores)

    onProgress('Analysis complete!', 100)

    return {
      scores: scores as unknown as CheckpointScores,
      confidence,
      checkpointFeedback,
      phaseAnalysis,
      topStrengths,
      topWeaknesses,
      coachNotes,
      estimatedLevel: level,
      estimatedApproachSpeed: approachSpeedLabel,
      overallPower,
      priorityOrder,
      metadata: {
        frameCount: trackedFrames.length,
        duration: Math.round((timestamps[timestamps.length - 1] - timestamps[0]) * 100) / 100,
        resolution: `${frames[0]?.width || 0}x${frames[0]?.height || 0}`,
        framesWithPlayer: trackedFrames.length,
        averageConfidence: Math.round(mean(trackedFrames.map((f) => f.detConfidence)) * 100) / 100,
      },
    }
  } catch (err) {
    // Re-throw with clearer message
    if (err instanceof Error) throw err
    throw new Error(`Analysis failed: ${String(err)}`)
  }
}