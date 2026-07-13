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

let sessionPromise: Promise<unknown> | null = null

async function getOrtSession() {
  if (sessionPromise) return sessionPromise

  sessionPromise = (async () => {
    // Load onnxruntime-web via a loader module script from public/ort/
    // to completely bypass Turbopack/webpack bundling of WASM files.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ort = await new Promise<any>((resolve, reject) => {
      // Already loaded?
      if ((globalThis as any).ort) { resolve((globalThis as any).ort); return }

      const onReady = () => {
        globalThis.removeEventListener('ort-ready', onReady)
        resolve((globalThis as any).ort)
      }
      globalThis.addEventListener('ort-ready', onReady)

      // Check again after a tick (race condition guard)
      const s = document.createElement('script')
      s.type = 'module'
      s.src = '/ort/ort-loader.mjs'
      s.onerror = () => {
        globalThis.removeEventListener('ort-ready', onReady)
        reject(new Error('Failed to load ONNX Runtime. Please refresh the page.'))
      }
      document.head.appendChild(s)

      // Timeout safety
      setTimeout(() => {
        if (!(globalThis as any).ort) {
          globalThis.removeEventListener('ort-ready', onReady)
          reject(new Error('ONNX Runtime load timed out. Please refresh the page.'))
        }
      }, 30000)
    })

    const session = await ort.InferenceSession.create('/models/yolov8n-pose.onnx', {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })

    console.log('[SpikeLab] ONNX session ready')
    return session
  })()

  return sessionPromise
}

// ─── Frame Extraction (Two-Pass: Scan → Dense) ────────────────────────────────

interface FrameExtractionResult {
  imageData: ImageData[]
  frameImages: string[]
  frameTimestamps: number[]
  duration: number
  fps: number
  width: number
  height: number
  actionWindowStart: number
  actionWindowEnd: number
}

/**
 * Extract frames from a video element at given timestamps.
 * Shared helper used by both scan and dense passes.
 */
async function extractFramesAtTimestamps(
  video: HTMLVideoElement,
  timestamps: number[],
  videoWidth: number,
  videoHeight: number,
  onProgress: ProgressCallback,
  progressRange: [number, number],
  label: string
): Promise<{ imageData: ImageData[]; frameImages: string[]; frameTimestamps: number[] }> {
  const canvas = document.createElement('canvas')
  canvas.width = MODEL_INPUT_SIZE
  canvas.height = MODEL_INPUT_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  const displayMaxW = 480
  const displayScale = Math.min(displayMaxW / videoWidth, 1)
  const displayW = Math.round(videoWidth * displayScale)
  const displayH = Math.round(videoHeight * displayScale)
  const displayCanvas = document.createElement('canvas')
  displayCanvas.width = displayW
  displayCanvas.height = displayH
  const displayCtx = displayCanvas.getContext('2d', { willReadFrequently: true })!

  const frames: ImageData[] = []
  const frameImages: string[] = []
  const frameTimestamps: number[] = []
  const total = timestamps.length

  for (let i = 0; i < total; i++) {
    try {
      await seekTo(video, timestamps[i])
      displayCtx.drawImage(video, 0, 0, displayW, displayH)
      frameImages.push(displayCanvas.toDataURL('image/jpeg', 0.7))
      frameTimestamps.push(timestamps[i])
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
      const scale = Math.min(MODEL_INPUT_SIZE / videoWidth, MODEL_INPUT_SIZE / videoHeight)
      const dw = videoWidth * scale
      const dh = videoHeight * scale
      const dx = (MODEL_INPUT_SIZE - dw) / 2
      const dy = (MODEL_INPUT_SIZE - dh) / 2
      ctx.drawImage(video, dx, dy, dw, dh)
      frames.push(ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE))
    } catch {
      // Skip failed frame extractions
    }
    const [pStart, pEnd] = progressRange
    const pct = pStart + Math.round((i / total) * (pEnd - pStart))
    onProgress(pct, `${label} (${i + 1}/${total})`)
  }

  return { imageData: frames, frameImages, frameTimestamps }
}

/**
 * Load a video file into an HTMLVideoElement and return it.
 */
function loadVideo(videoFile: File): Promise<{ video: HTMLVideoElement; url: string; duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    const url = URL.createObjectURL(videoFile)
    video.src = url

    video.addEventListener('loadedmetadata', () => {
      const duration = video.duration
      const width = video.videoWidth
      const height = video.videoHeight
      if (!duration || !isFinite(duration) || duration < 0.5) {
        URL.revokeObjectURL(url)
        reject(new Error('Video is too short or invalid.'))
        return
      }
      resolve({ video, url, duration, width, height })
    })

    video.addEventListener('error', () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load video. Please try a different format.'))
    })

    video.load()
  })
}

/**
 * Two-pass frame extraction:
 * Pass 1 (Scan): Sparse frames across the ENTIRE video to find the action window
 * Pass 2 (Dense): ALL frames within the action window at ~10fps
 *
 * For tutorial/exercise videos, this automatically trims to just the exercise instance.
 */
async function extractFramesFromVideo(
  videoFile: File,
  onProgress: ProgressCallback
): Promise<FrameExtractionResult> {
  const SCAN_FRAMES = 40
  const DENSE_FPS = 10  // sample rate for dense pass
  const MAX_DENSE_FRAMES = 120  // cap to keep inference fast
  const WINDOW_PADDING = 0.3  // seconds of padding around detected action
  const MIN_ACTION_RATIO = 0.05  // minimum action window as fraction of video

  const { video, url, duration, width, height } = await loadVideo(videoFile)
  const fps = 30

  onProgress(5, `Video loaded: ${duration.toFixed(1)}s, ${width}x${height}`)

  // ── Pass 1: Quick scan across the ENTIRE video ──
  const scanTimestamps: number[] = []
  const scanMargin = duration * 0.02  // tiny margin to avoid seek issues at boundaries
  for (let i = 0; i < SCAN_FRAMES; i++) {
    const t = SCAN_FRAMES <= 1
      ? duration / 2
      : scanMargin + (duration - 2 * scanMargin) * (i / (SCAN_FRAMES - 1))
    scanTimestamps.push(t)
  }

  onProgress(8, `Scanning video for action window...`)
  const scanResult = await extractFramesAtTimestamps(
    video, scanTimestamps, width, height, onProgress,
    [8, 14], 'Scanning for action...'
  )

  // ── Run quick inference on scan frames ──
  onProgress(14, 'Detecting exercise instance...')
  const session = await getOrtSession() as any
  const inputName = session.inputNames[0]

  const scanPresence: boolean[] = []  // person detected in each scan frame
  const scanMotion: number[] = []  // hip displacement between consecutive frames
  let prevHipX: number | null = null

  for (let fi = 0; fi < scanResult.imageData.length; fi++) {
    const imgData = scanResult.imageData[fi]
    const detected = quickPersonDetect(imgData, session, inputName, width, height)
    scanPresence.push(detected.detected)

    if (detected.hipX !== null) {
      if (prevHipX !== null) {
        scanMotion.push(Math.abs(detected.hipX - prevHipX))
      } else {
        scanMotion.push(0)
      }
      prevHipX = detected.hipX
    } else {
      scanMotion.push(0)
      prevHipX = null
    }
  }

  // ── Find action window ──
  // Find the largest contiguous region where person is detected, weighted by motion
  let bestStart = 0
  let bestEnd = scanPresence.length - 1
  let bestScore = 0
  let regionStart = -1

  for (let i = 0; i < scanPresence.length; i++) {
    if (scanPresence[i]) {
      if (regionStart === -1) regionStart = i
    } else {
      if (regionStart !== -1) {
        const regionEnd = i - 1
        const regionLen = regionEnd - regionStart + 1
        // Score: length weighted by motion activity
        const motionInRegion = scanMotion.slice(regionStart, regionEnd + 1).reduce((a, b) => a + b, 0)
        const score = regionLen * 2 + motionInRegion * 0.5
        if (score > bestScore) {
          bestScore = score
          bestStart = regionStart
          bestEnd = regionEnd
        }
        regionStart = -1
      }
    }
  }
  // Handle region extending to end of scan
  if (regionStart !== -1) {
    const regionEnd = scanPresence.length - 1
    const regionLen = regionEnd - regionStart + 1
    const motionInRegion = scanMotion.slice(regionStart, regionEnd + 1).reduce((a, b) => a + b, 0)
    const score = regionLen * 2 + motionInRegion * 0.5
    if (score > bestScore) {
      bestStart = regionStart
      bestEnd = regionEnd
    }
  }

  // Convert scan indices to timestamps
  let actionStart = scanResult.frameTimestamps[bestStart] ?? 0
  let actionEnd = scanResult.frameTimestamps[bestEnd] ?? duration

  // Add padding
  actionStart = Math.max(0, actionStart - WINDOW_PADDING)
  actionEnd = Math.min(duration, actionEnd + WINDOW_PADDING)

  // Ensure minimum action window (for very short detections)
  if (actionEnd - actionStart < duration * MIN_ACTION_RATIO) {
    const center = (actionStart + actionEnd) / 2
    const halfWindow = Math.max((actionEnd - actionStart) / 2, duration * MIN_ACTION_RATIO / 2)
    actionStart = Math.max(0, center - halfWindow)
    actionEnd = Math.min(duration, center + halfWindow)
  }

  // For very short videos, use the whole video
  if (duration <= 5) {
    actionStart = 0
    actionEnd = duration
  }

  console.log(`[SpikeLab] Action window: ${actionStart.toFixed(2)}s - ${actionEnd.toFixed(2)}s (${(actionEnd - actionStart).toFixed(2)}s of ${duration.toFixed(2)}s total)`)
  onProgress(16, `Found action: ${(actionEnd - actionStart).toFixed(1)}s`)

  // ── Pass 2: Dense frame extraction from action window ──
  const actionDuration = actionEnd - actionStart
  const denseCount = Math.min(MAX_DENSE_FRAMES, Math.max(10, Math.floor(actionDuration * DENSE_FPS)))

  const denseTimestamps: number[] = []
  for (let i = 0; i < denseCount; i++) {
    const t = denseCount <= 1
      ? (actionStart + actionEnd) / 2
      : actionStart + (actionEnd - actionStart) * (i / (denseCount - 1))
    denseTimestamps.push(t)
  }

  onProgress(17, `Extracting ${denseCount} frames from action window...`)
  const denseResult = await extractFramesAtTimestamps(
    video, denseTimestamps, width, height, onProgress,
    [17, 20], 'Extracting action frames...'
  )

  URL.revokeObjectURL(url)
  onProgress(20, `Extracted ${denseResult.imageData.length} frames from action window`)

  return {
    imageData: denseResult.imageData,
    frameImages: denseResult.frameImages,
    frameTimestamps: denseResult.frameTimestamps,
    duration: actionEnd - actionStart,
    fps,
    width,
    height,
    actionWindowStart: actionStart,
    actionWindowEnd: actionEnd,
  }
}

/**
 * Quick person detection for scan pass. Returns detected + hip X position for motion tracking.
 */
function quickPersonDetect(
  imgData: ImageData,
  session: any,
  inputName: string,
  videoWidth: number,
  _videoHeight: number
): { detected: boolean; hipX: number | null } {
  const float32Data = new Float32Array(1 * 3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE)
  for (let p = 0; p < MODEL_INPUT_SIZE * MODEL_INPUT_SIZE; p++) {
    float32Data[p] = imgData.data[p * 4] / 255.0
    float32Data[MODEL_INPUT_SIZE * MODEL_INPUT_SIZE + p] = imgData.data[p * 4 + 1] / 255.0
    float32Data[2 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE + p] = imgData.data[p * 4 + 2] / 255.0
  }

  try {
    const inputTensor = new ((globalThis as any).ort.Tensor)('float32', float32Data, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE])
    const results = session.run({ [inputName]: inputTensor })
    const outputKey = session.outputNames[0]
    const output = results[outputKey]
    const data = output.data as Float32Array
    const dims = output.dims as number[]
    const numDetections = dims[2]

    let bestIdx = -1
    let bestScore = 0

    for (let d = 0; d < numDetections; d++) {
      const objConf = data[d + numDetections * 4]
      if (objConf < 0.2) continue
      const clsConf = data[d + numDetections * 5]
      const conf = objConf * clsConf
      if (conf < 0.2 || conf <= bestScore) continue
      let kpVisible = 0
      for (let k = 0; k < NUM_KEYPOINTS; k++) {
        const kpConf = data[d + numDetections * (6 + k * 3 + 2)]
        if (kpConf > 0.3) kpVisible++
      }
      if (kpVisible < 3) continue
      bestScore = conf
      bestIdx = d
    }

    if (bestIdx >= 0) {
      const d = bestIdx
      // Get hip X for motion tracking (use L_HIP + R_HIP midpoint)
      const lHipX = data[d + numDetections * (6 + L_HIP * 3)]
      const lHipC = data[d + numDetections * (6 + L_HIP * 3 + 2)]
      const rHipX = data[d + numDetections * (6 + R_HIP * 3)]
      const rHipC = data[d + numDetections * (6 + R_HIP * 3 + 2)]

      const scale = Math.min(MODEL_INPUT_SIZE / videoWidth, MODEL_INPUT_SIZE / videoHeight)
      const padX = (MODEL_INPUT_SIZE - videoWidth * scale) / 2
      const mapX = (v: number) => (v - padX) / scale

      if (lHipC > 0.3 && rHipC > 0.3) {
        return { detected: true, hipX: (mapX(lHipX) + mapX(rHipX)) / 2 }
      } else if (lHipC > 0.3) {
        return { detected: true, hipX: mapX(lHipX) }
      } else if (rHipC > 0.3) {
        return { detected: true, hipX: mapX(rHipX) }
      }
      return { detected: true, hipX: null }
    }

    return { detected: false, hipX: null }
  } catch (err) {
    console.warn('[SpikeLab] Quick detect failed:', err)
    return { detected: false, hipX: null }
  }
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
  const session = await getOrtSession() as any
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

    const inputTensor = new ((globalThis as any).ort.Tensor)('float32', float32Data, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE])
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

// ─── Keypoint Confidence Helpers ─────────────────────────────────────────────

/** Check if all specified keypoints in a frame meet minimum confidence */
function kpConf(kp: Keypoint[], indices: number[], minConf = 0.3): boolean {
  return indices.every(i => kp[i].conf >= minConf)
}

/** Average confidence of specific keypoints across a frame range */
function avgKpConf(frames: FrameData[], start: number, end: number, kpIndices: number[]): number {
 let total = 0, count = 0
  for (let i = start; i <= Math.min(end, frames.length - 1); i++) {
    for (const ki of kpIndices) {
      total += frames[i].keypoints[ki].conf
      count++
    }
  }
  return count > 0 ? total / count : 0
}

// ─── Biomechanical Scoring (16 Metrics) ───────────────────────────────────────
// All distances normalized by personHeight. If keypoint confidence is too low,
// the function returns [0, 0] to signal unreliable data.

function calcApproachSpeed(frames: FrameData[], phases: PhaseInfo, fps: number): [number, number] {
  const xs = (phases.hipXs.slice(phases.approachStart, phases.approachEnd + 1) as number[])
  if (xs.length < 2) return [0, 0]

  // Require sufficient hip keypoint confidence during approach
  const approachConf = avgKpConf(frames, phases.approachStart, phases.approachEnd, [L_HIP, R_HIP])
  if (approachConf < 0.25) return [0, 0]

  const totalDist = Math.abs(xs[xs.length - 1] - xs[0])
  const dt = xs.length / fps
  const rawSpeed = dt > 0 ? totalDist / dt : 0

  // Normalize by person height (real approach ~1.5-3.5 body-heights/sec)
  const normSpeed = phases.personHeight > 0 ? rawSpeed / phases.personHeight : 0

  let score: number
  if (normSpeed > 3.0) score = 92
  else if (normSpeed > 2.0) score = 72 + (normSpeed - 2.0) / 1.0 * 20
  else if (normSpeed > 1.0) score = 48 + (normSpeed - 1.0) / 1.0 * 24
  else if (normSpeed > 0.4) score = 25 + (normSpeed - 0.4) / 0.6 * 23
  else score = 15 + normSpeed / 0.4 * 10

  return [clamp(score), Math.round(normSpeed * 100) / 100]
}

function calcApproachAngle(frames: FrameData[], phases: PhaseInfo): [number, number] {
  const asStart = phases.approachStart
  const plant = phases.plantFrame
  if (plant <= asStart) return [0, 0]

  // Confidence check
  const conf = avgKpConf(frames, asStart, plant, [L_HIP, R_HIP])
  if (conf < 0.25) return [0, 0]

  const startX = (phases.hipXs[asStart] ?? 0) as number
  const startY = phases.hipYs[asStart]
  const plantX = (phases.hipXs[plant] ?? 0) as number
  const plantY = phases.hipYs[plant]

  const dx = Math.abs(plantX - startX)
  const dy = Math.abs(plantY - startY)
  if (dx < 5) return [0, 0] // Not enough horizontal movement to measure angle

  // Y is inverted in screen coords but we use abs, so the angle magnitude
  // from horizontal is correct regardless of camera orientation.
  const angle = Math.atan2(dy, dx) * (180 / Math.PI)

  // Optimal approach angle: 25-50° from horizontal (diagonal approach to net)
  let score = scoreBand(angle, 25, 50, 0)
  if (angle > 65) score = clamp(score - 20) // Too steep
  if (angle < 12) score = clamp(score - 15) // Too straight

  return [clamp(score), Math.round(angle * 10) / 10]
}

function calcLastStepLength(frames: FrameData[], phases: PhaseInfo): [number, number] {
  const plant = phases.plantFrame
  const legLen = phases.legLength
  const n = frames.length
  if (legLen < 50) return [0, 0]

  // Search backward from plant for ankle positions
  const anklePositions: [number, { x: number; y: number }][] = []
  for (let i = plant; i >= Math.max(0, plant - Math.floor(n * 0.3)); i--) {
    const kp = frames[i].keypoints
    if (kpConf(kp, [L_ANKLE, R_ANKLE], 0.3)) {
      anklePositions.push([i, midpoint(kp[L_ANKLE], kp[R_ANKLE])])
      if (anklePositions.length >= 15) break
    }
  }

  if (anklePositions.length < 2) return [0, 0]

  // Confidence: check ankle keypoints in the last few frames before plant
  const lastFew = anklePositions.slice(-5)
 let confSum = 0, confCount = 0
  for (const [fi] of lastFew) {
    confSum += frames[fi].keypoints[L_ANKLE].conf + frames[fi].keypoints[R_ANKLE].conf
    confCount += 2
  }
  if (confCount > 0 && confSum / confCount < 0.2) return [0, 0]

  // Detect foot plants (local maxima in Y = foot on ground)
  const yVals = anklePositions.map(a => a[1].y)
  const steps: [number, { x: number; y: number }][] = [anklePositions[0]]

  for (let i = 1; i < anklePositions.length; i++) {
    const prev = steps[steps.length - 1][1]
    const cur = anklePositions[i][1]
    if (dist(prev, cur) > legLen * 0.12) {
      steps.push(anklePositions[i])
    }
  }

  if (steps.length < 2) return [0, 0]

  // Find the last step (largest stride near plant)
  let lastStepLen = 0
  for (let i = Math.max(1, steps.length - 3); i < steps.length; i++) {
    const d = dist(steps[i][1], steps[i - 1][1])
    if (d > lastStepLen) lastStepLen = d
  }

  if (lastStepLen === 0) return [0, 0]

  const ratio = lastStepLen / legLen
  // Optimal last step: 0.8-1.3x leg length (long, braking step)
  const score = scoreBand(ratio, 0.8, 1.3, 0)

  return [clamp(score), Math.round(ratio * 1000) / 1000]
}

function calcFootworkRhythm(frames: FrameData[], phases: PhaseInfo, fps: number): [number, number] {
  const plant = phases.plantFrame
  const n = frames.length
  if (fps <= 0) return [0, 0]

  // Confidence check
  const conf = avgKpConf(frames, Math.max(0, plant - Math.floor(fps * 2.5)), plant, [L_ANKLE, R_ANKLE])
  if (conf < 0.2) return [0, 0]

  // Collect per-side ankle Y positions for plant detection
  const searchStart = Math.max(0, plant - Math.floor(fps * 2.5))
  const ankleData: [number, number, number][] = [] // [frameIdx, leftAnkleY, rightAnkleY]
  for (let i = searchStart; i <= plant && i < n; i++) {
    const kp = frames[i].keypoints
    const ly = kp[L_ANKLE].conf > 0.3 ? kp[L_ANKLE].y : NaN
    const ry = kp[R_ANKLE].conf > 0.3 ? kp[R_ANKLE].y : NaN
    if (!isNaN(ly) || !isNaN(ry)) ankleData.push([i, ly, ry])
  }

  if (ankleData.length < 4) return [0, 0]

  // Detect foot plants from each side independently
  const plants: number[] = []
  for (let side = 0; side < 2; side++) {
    const yArr: number[] = []
    const fArr: number[] = []
    for (const [fi, ly, ry] of ankleData) {
      const v = side === 0 ? ly : ry
      if (!isNaN(v)) { yArr.push(v); fArr.push(fi) }
    }
    if (yArr.length < 3) continue
    const smoothed = movingAverage(yArr, 3)
    const meanY = smoothed.reduce((a, b) => a + b, 0) / smoothed.length
    for (let i = 1; i < smoothed.length - 1; i++) {
      if (smoothed[i] >= smoothed[i - 1] - 1 && smoothed[i] >= smoothed[i + 1] - 1 && smoothed[i] > meanY - 8) {
        if (!plants.includes(fArr[i])) plants.push(fArr[i])
      }
    }
  }
  plants.sort((a, b) => a - b)

  if (plants.length < 2) return [0, 0]

  const intervals: number[] = []
  for (let i = 1; i < plants.length; i++) {
    const dt = (plants[i] - plants[i - 1]) / fps
    if (dt > 0.08 && dt < 1.5) intervals.push(dt)
  }

  if (intervals.length < 1) return [0, 0]

  // Acceleration pattern: slow-to-fast = intervals should decrease
  let accScore = 50
  if (intervals.length >= 2) {
    let decreasing = 0
    for (let i = 1; i < intervals.length; i++) {
      if (intervals[i] < intervals[i - 1]) decreasing++
    }
    const decRatio = decreasing / (intervals.length - 1)
    accScore = 30 + decRatio * 60
  }

  // Consistency: coefficient of variation
  if (intervals.length >= 2) {
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const std = Math.sqrt(intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length)
    const cv = mean > 0 ? std / mean : 0
    const consScore = Math.max(30, Math.round(90 - cv * 200))
    accScore = accScore * 0.6 + consScore * 0.4
  }

  const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
  return [clamp(accScore), Math.round(meanInterval * 1000) / 1000]
}

function calcArmsSwingBack(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean): [number, number] {
  const offShoulder = isLeftHanded ? R_SHOULDER : L_SHOULDER
  const offElbow = isLeftHanded ? R_ELBOW : L_ELBOW
  const offWrist = isLeftHanded ? R_WRIST : L_WRIST

  // Confidence check
  const conf = avgKpConf(frames, phases.approachStart, phases.plantFrame, [offShoulder, offWrist, L_HIP, R_HIP])
  if (conf < 0.2) return [0, 0]

  let maxAngle = 0
  let maxWristBehind = 0
  let count = 0

  for (let i = phases.approachStart; i <= Math.min(phases.plantFrame, frames.length - 1); i++) {
    const kp = frames[i].keypoints
    if (!kpConf(kp, [offShoulder, offWrist, L_HIP, R_HIP], 0.3)) continue

    const hipC = midpoint(kp[L_HIP], kp[R_HIP])

    // 1. Arm extension angle at shoulder
    const armAngle = kpConf(kp, [offElbow], 0.3)
      ? angleBetween(kp[offShoulder], kp[offElbow], kp[offWrist])
      : 120 // fallback if elbow not visible
    maxAngle = Math.max(maxAngle, armAngle)

    // 2. Wrist behind hip center (arms swing back PAST hips)
    const hipX = hipC.x
    const wristBehind = (isLeftHanded
      ? (kp[offWrist].x > hipX)   // left-handed: wrist to the right of hip
      : (kp[offWrist].x < hipX))  // right-handed: wrist to the left of hip
      ? Math.abs(kp[offWrist].x - hipX)
      : 0
    const normBehind = phases.personHeight > 0 ? wristBehind / phases.personHeight : 0
    maxWristBehind = Math.max(maxWristBehind, normBehind)
    count++
  }

  if (count === 0) return [0, 0]

  // Score: arm extension (55%) + wrist behind body (45%)
  let angleScore: number
  if (maxAngle > 150) angleScore = 95
  else if (maxAngle > 120) angleScore = 80
  else if (maxAngle > 90) angleScore = 60
  else if (maxAngle > 60) angleScore = 40
  else angleScore = 20

  let behindScore: number
  if (maxWristBehind > 0.15) behindScore = 95
  else if (maxWristBehind > 0.08) behindScore = 75
  else if (maxWristBehind > 0.03) behindScore = 55
  else behindScore = 30

  const score = angleScore * 0.55 + behindScore * 0.45
  return [clamp(score), Math.round(maxAngle * 10) / 10]
}

function calcVerticalJumpConversion(frames: FrameData[], phases: PhaseInfo, fps: number): [number, number] {
  const plant = phases.plantFrame
  const peak = phases.jumpPeak
  if (peak <= plant) return [0, 0]

  const conf = avgKpConf(frames, plant, peak, [L_HIP, R_HIP])
  if (conf < 0.2) return [0, 0]

  const personHeight = phases.personHeight
  if (personHeight < 50) return [0, 0]

  // Vertical displacement (positive = upward since Y is inverted)
  const vertDisp = phases.hipYs[plant] - phases.hipYs[peak]
  const jumpRatio = vertDisp / personHeight

  // Real volleyball spike jump: 0.3-0.6 body heights; elite 0.5+
  let score: number
  if (jumpRatio > 0.55) score = 95
  else if (jumpRatio > 0.40) score = 82
  else if (jumpRatio > 0.25) score = 65
  else if (jumpRatio > 0.12) score = 45
  else score = 25

  // Bonus: horizontal speed should decrease at peak (converted to vertical)
  const window = Math.max(1, Math.floor(fps * 0.15))
  const preSpeeds: number[] = []
  const postSpeeds: number[] = []
  for (let i = Math.max(0, plant - window); i < plant && i < frames.length - 1; i++) {
    const x1 = phases.hipXs[i]; const x2 = phases.hipXs[i + 1]
    if (x1 !== null && x2 !== null) preSpeeds.push(Math.abs(x2 - x1) * fps)
  }
  for (let i = peak; i < Math.min(frames.length - 1, peak + window); i++) {
    const x1 = phases.hipXs[i]; const x2 = phases.hipXs[i + 1]
    if (x1 !== null && x2 !== null) postSpeeds.push(Math.abs(x2 - x1) * fps)
  }
  const avgPre = preSpeeds.length > 0 ? preSpeeds.reduce((a, b) => a + b, 0) / preSpeeds.length : 0
  const avgPost = postSpeeds.length > 0 ? postSpeeds.reduce((a, b) => a + b, 0) / postSpeeds.length : 0
  if (avgPre > 10 && avgPre > avgPost * 1.5) score = Math.min(100, score + 5)

  return [clamp(score), Math.round(jumpRatio * 1000) / 1000]
}

function calcHipShoulderRotation(frames: FrameData[], phases: PhaseInfo): [number, number] {
  const n = frames.length
  const personHeight = phases.personHeight

  // Search across the airborne phase for the best frame with visible keypoints
  const airStart = Math.max(0, phases.plantFrame)
  const airEnd = Math.min(n - 1, phases.contactFrame)

  let bestFrame = -1
  let bestDetConf = 0
  for (let i = airStart; i <= airEnd; i++) {
    const kp = frames[i].keypoints
    const conf = (kp[L_SHOULDER].conf + kp[R_SHOULDER].conf + kp[L_HIP].conf + kp[R_HIP].conf) / 4
    if (conf >= 0.3 && conf > bestDetConf) {
      bestDetConf = conf
      bestFrame = i
    }
  }

  if (bestFrame < 0 || bestDetConf < 0.25) return [0, 0]

  const fkp = frames[bestFrame].keypoints
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

function calcBodyPositionAir(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean): [number, number] {
  const n = frames.length
  const personHeight = phases.personHeight
  const airStart = phases.plantFrame
  const airEnd = Math.min(n - 1, phases.contactFrame)

  if (personHeight < 50 || airEnd <= airStart) return [0, 0]

  // Collect valid frames during airborne phase (plant → contact)
  const airFrames: number[] = []
  for (let i = airStart; i <= airEnd; i++) {
    const kp = frames[i].keypoints
    if (kpConf(kp, [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP], 0.25)) {
      airFrames.push(i)
    }
  }
  if (airFrames.length < 2) return [0, 0]

  // Find best frame near jump peak with good keypoints
  const peakFrame = Math.min(phases.jumpPeak, airEnd)
  let bestFrame = airFrames[0]
  let bestDist = Infinity
  for (const f of airFrames) {
    const d = Math.abs(f - peakFrame)
    if (d < bestDist) { bestDist = d; bestFrame = f }
  }

  const kp = frames[bestFrame].keypoints
  const shoulderC = midpoint(kp[L_SHOULDER], kp[R_SHOULDER])
  const hipC = midpoint(kp[L_HIP], kp[R_HIP])

  // Score 6 specific body position elements
  const elementScores: number[] = []

  // 1. KNEE TUCK: Are knees bent at ~90° at peak? (angle hip-knee-ankle)
  {
    const kneeAngles: number[] = []
    for (const [hipI, kneeI, ankleI] of [[L_HIP, L_KNEE, L_ANKLE], [R_HIP, R_KNEE, R_ANKLE]] as [number, number, number][]) {
      if (kpConf(kp, [hipI, kneeI, ankleI], 0.3)) {
        kneeAngles.push(angleBetween(kp[hipI], kp[kneeI], kp[ankleI]))
      }
    }
    if (kneeAngles.length > 0) {
      const avgKnee = kneeAngles.reduce((a, b) => a + b, 0) / kneeAngles.length
      if (avgKnee >= 70 && avgKnee <= 130) elementScores.push(90)
      else if (avgKnee >= 50 && avgKnee <= 150) elementScores.push(65)
      else elementScores.push(35)
    }
  }

  // 2. HIP ALIGNMENT: Are hips level (not tilted)?
  {
    if (kpConf(kp, [L_HIP, R_HIP], 0.3)) {
      const hipDiff = Math.abs(kp[L_HIP].y - kp[R_HIP].y) / personHeight
      if (hipDiff < 0.03) elementScores.push(95)
      else if (hipDiff < 0.06) elementScores.push(75)
      else if (hipDiff < 0.10) elementScores.push(55)
      else elementScores.push(30)
    }
  }

  // 3. SHOULDER POSITION: Are shoulders back and open (not hunched forward)?
  {
    if (kpConf(kp, [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP], 0.3)) {
      const shoulderAboveHip = (hipC.y - shoulderC.y) / personHeight
      if (shoulderAboveHip > 0.18) elementScores.push(90)
      else if (shoulderAboveHip > 0.12) elementScores.push(70)
      else if (shoulderAboveHip > 0.06) elementScores.push(50)
      else elementScores.push(30)
    }
  }

  // 4. NON-HITTING ARM: Is it extended for balance?
  {
    const nhShoulder = isLeftHanded ? R_SHOULDER : L_SHOULDER
    const nhElbow = isLeftHanded ? R_ELBOW : L_ELBOW
    const nhWrist = isLeftHanded ? R_WRIST : L_WRIST

    if (kpConf(kp, [nhShoulder, nhWrist], 0.3)) {
      const armRaised = kp[nhWrist].y < kp[nhShoulder].y
      const armExtended = kpConf(kp, [nhElbow], 0.3)
        ? angleBetween(kp[nhShoulder], kp[nhElbow], kp[nhWrist]) > 140
        : dist(kp[nhShoulder], kp[nhWrist]) / personHeight > 0.25

      if (armRaised && armExtended) elementScores.push(90)
      else if (armRaised || armExtended) elementScores.push(60)
      else elementScores.push(30)
    }
  }

  // 5. HEAD POSITION: Is the head up and eyes tracking the ball?
  {
    if (kpConf(kp, [NOSE, L_SHOULDER, R_SHOULDER], 0.3)) {
      const headOffsetX = Math.abs(kp[NOSE].x - shoulderC.x) / personHeight
      const headAbove = (shoulderC.y - kp[NOSE].y) / personHeight

      if (headOffsetX < 0.05 && headAbove > 0) elementScores.push(90)
      else if (headOffsetX < 0.10 && headAbove > -0.05) elementScores.push(70)
      else if (headOffsetX < 0.15) elementScores.push(50)
      else elementScores.push(30)
    }
  }

  // 6. BODY ARCH: Slight arch in lower back for power generation?
  {
    if (kpConf(kp, [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP], 0.3)) {
      const spineAngle = angleOfLine(shoulderC, hipC)
      const deviation = 90 - spineAngle // positive = leaning back (shoulders behind hips)

      if (deviation >= 5 && deviation <= 25) elementScores.push(90)
      else if (deviation >= 0 && deviation <= 35) elementScores.push(70)
      else if (deviation > 0) elementScores.push(50)
      else elementScores.push(30) // Forward lean = no arch = bad for power
    }
  }

  if (elementScores.length === 0) return [0, 0]

  const finalScore = elementScores.reduce((a, b) => a + b, 0) / elementScores.length
  return [clamp(finalScore), Math.round(finalScore * 10) / 10]
}

function calcTorsoAngleAir(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean): [number, number] {
  const n = frames.length
  const personHeight = phases.personHeight
  if (personHeight < 50) return [0, 0]

  const airStart = Math.max(0, phases.plantFrame)
  const contactFrame = Math.min(n - 1, phases.contactFrame)

  // Collect torso angles across airborne phase
  const torsoAngles: { frame: number; angle: number }[] = []

  for (let i = airStart; i <= Math.min(n - 1, phases.followThroughEnd); i++) {
    const kp = frames[i].keypoints
    if (!kpConf(kp, [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP], 0.3)) continue

    const shoulderC = midpoint(kp[L_SHOULDER], kp[R_SHOULDER])
    const hipC = midpoint(kp[L_HIP], kp[R_HIP])

    // Spine angle: shoulder midpoint → hip midpoint
    // angleOfLine returns degrees from horizontal, 90 = vertical
    // deviation: positive = leaning back, negative = leaning forward
    const spineAngle = angleOfLine(shoulderC, hipC)
    const deviation = 90 - spineAngle
    torsoAngles.push({ frame: i, angle: deviation })
  }

  if (torsoAngles.length < 3) return [0, 0]

  // Split into early airborne (plant→peak) and late airborne (peak→contact)
  const peak = phases.jumpPeak
  const earlyAir = torsoAngles.filter(t => t.frame <= peak)
  const lateAir = torsoAngles.filter(t => t.frame > peak && t.frame <= contactFrame)

  const avgEarly = earlyAir.length > 0
    ? earlyAir.reduce((s, t) => s + t.angle, 0) / earlyAir.length
    : 0
  const avgLate = lateAir.length > 0
    ? lateAir.reduce((s, t) => s + t.angle, 0) / lateAir.length
    : avgEarly

  let score = 0

  // 1. Early airborne: 10-25° backward lean (loading the bow)
  if (avgEarly >= 10 && avgEarly <= 25) score += 40
  else if (avgEarly >= 5 && avgEarly <= 35) score += 28
  else if (avgEarly > 0) score += 15
  else score += 5

  // 2. Whip transition: angle should decrease from early to late (forward snap)
  const angleChange = avgEarly - avgLate
  if (angleChange >= 10 && angleChange <= 40) score += 35
  else if (angleChange >= 5 && angleChange <= 50) score += 25
  else if (angleChange > 0) score += 15
  else score += 5

  // 3. At contact frame: near vertical or slightly forward (0-10° forward lean)
  const contactAngles = torsoAngles.filter(t => Math.abs(t.frame - contactFrame) <= 1)
  if (contactAngles.length > 0) {
    const avgContact = contactAngles.reduce((s, t) => s + t.angle, 0) / contactAngles.length
    if (avgContact >= -10 && avgContact <= 10) score += 15
    else if (avgContact >= -20 && avgContact <= 20) score += 10
    else score += 3
  } else {
    score += 5
  }

  // 4. Smooth transition (no sudden jerks)
  if (torsoAngles.length >= 3) {
    const sorted = [...torsoAngles].sort((a, b) => a.frame - b.frame)
    let maxChange = 0
    for (let i = 1; i < sorted.length; i++) {
      const change = Math.abs(sorted[i].angle - sorted[i - 1].angle)
      if (change > maxChange) maxChange = change
    }
    if (maxChange < 12) score += 10
    else if (maxChange < 20) score += 7
    else score += 3
  }

  return [clamp(score), Math.round(Math.abs(avgEarly) * 10) / 10]
}

function calcBowAndArrow(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean): [number, number] {
  const hitS = isLeftHanded ? L_SHOULDER : R_SHOULDER
  const hitE = isLeftHanded ? L_ELBOW : R_ELBOW
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const n = frames.length
  const contact = Math.min(phases.contactFrame, n - 1)
  const personHeight = phases.personHeight

  // Search from plant to contact for maximum load position
  const searchStart = Math.max(0, phases.plantFrame)

  let maxLoadScore = 0
  let bestArmAngle = 0
  let found = false

  for (let i = searchStart; i < contact; i++) {
    const kp = frames[i].keypoints
    if (!kpConf(kp, [hitS, hitE, hitW], 0.3)) continue

    const armAngle = angleBetween(kp[hitS], kp[hitE], kp[hitW])
    const wristDist = personHeight > 0 ? dist(kp[hitS], kp[hitW]) / personHeight : 0
    const elbowHigh = (kp[hitS].y - kp[hitE].y) / personHeight
    const wristAbove = (kp[hitS].y - kp[hitW].y) / personHeight

    let s = 0
    // Arm cocked back: elbow angle 110-160°
    if (armAngle >= 120 && armAngle <= 155) s += 40
    else if (armAngle >= 100 && armAngle <= 170) s += 28
    else if (armAngle >= 80) s += 15
    else s += 5

    // Wrist far from shoulder (arm fully loaded)
    if (wristDist > 0.55) s += 25
    else if (wristDist > 0.35) s += 18
    else if (wristDist > 0.20) s += 10

    // Elbow above shoulder (high elbow position)
    if (elbowHigh > 0.05) s += 20
    else if (elbowHigh > 0) s += 12
    else s += 3

    // Wrist above shoulder (raised for loading)
    if (wristAbove > 0.08) s += 15
    else if (wristAbove > 0.02) s += 8

    if (s > maxLoadScore) {
      maxLoadScore = s
      bestArmAngle = armAngle
      found = true
    }
  }

  if (!found) return [0, 0]
  return [clamp(maxLoadScore), Math.round(bestArmAngle * 10) / 10]
}

function calcArmSwingSpeed(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean, fps: number): [number, number] {
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const n = frames.length
  const personHeight = phases.personHeight
  if (personHeight < 50 || fps <= 0) return [0, 0]

  // Focus on the swing phase (plant → follow through end)
  const swingStart = Math.max(0, phases.plantFrame)
  const swingEnd = Math.min(n - 1, phases.followThroughEnd)

  // Confidence check
  const conf = avgKpConf(frames, swingStart, swingEnd, [hitW])
  if (conf < 0.2) return [0, 0]

  const speeds: number[] = [0]
  for (let i = swingStart + 1; i <= swingEnd; i++) {
    const w1 = frames[i - 1].keypoints[hitW]
    const w2 = frames[i].keypoints[hitW]
    if (w1.conf > 0.3 && w2.conf > 0.3) {
      speeds.push(dist(w1, w2) * fps)
    } else {
      speeds.push(0)
    }
  }

  const maxSpeed = Math.max(...speeds)
  const normSpeed = maxSpeed / personHeight

  let score: number
  if (normSpeed > 3.5) score = 95
  else if (normSpeed > 2.5) score = 82
  else if (normSpeed > 1.5) score = 65
  else if (normSpeed > 0.8) score = 48
  else if (normSpeed > 0.3) score = 30
  else score = 15

  return [clamp(score), Math.round(normSpeed * 100) / 100]
}

function calcContactPoint(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean): [number, number] {
  const hitS = isLeftHanded ? L_SHOULDER : R_SHOULDER
  const hitE = isLeftHanded ? L_ELBOW : R_ELBOW
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const n = frames.length
  const contact = Math.min(phases.contactFrame, n - 1)
  const personHeight = phases.personHeight

  const kp = frames[contact].keypoints
  if (!kpConf(kp, [hitS, hitE, hitW], 0.3)) return [0, 0]

  // 1. Full arm extension at contact (shoulder-elbow-wrist ~180°)
  const armAngle = angleBetween(kp[hitS], kp[hitE], kp[hitW])
  let extensionScore: number
  if (armAngle >= 170) extensionScore = 95
  else if (armAngle >= 155) extensionScore = 80
  else if (armAngle >= 135) extensionScore = 60
  else if (armAngle >= 110) extensionScore = 40
  else extensionScore = 20

  // 2. Contact at or very near peak height
  const peakHipY = phases.hipYs[phases.jumpPeak]
  const contactHipY = phases.hipYs[contact]
  const hDiff = personHeight > 0 ? Math.abs(peakHipY - contactHipY) / personHeight : 0.1

  let heightScore: number
  if (hDiff < 0.03) heightScore = 95
  else if (hDiff < 0.10) heightScore = 80
  else if (hDiff < 0.20) heightScore = 60
  else if (hDiff < 0.35) heightScore = 40
  else heightScore = 20

  // 3. Wrist above and in front of shoulder at contact
  const wristAbove = (kp[hitS].y - kp[hitW].y) / personHeight
  let positionScore = 50
  if (wristAbove > 0.15) positionScore = 85
  else if (wristAbove > 0.08) positionScore = 65
  else if (wristAbove > 0) positionScore = 45

  const score = extensionScore * 0.45 + heightScore * 0.35 + positionScore * 0.20
  return [clamp(score), Math.round(armAngle * 10) / 10]
}

function calcWristSnap(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean, fps: number): [number, number] {
  const hitS = isLeftHanded ? L_SHOULDER : R_SHOULDER
  const hitE = isLeftHanded ? L_ELBOW : R_ELBOW
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const n = frames.length
  const contact = phases.contactFrame
  if (fps <= 0) return [0, 0]

  // Focus on frames around contact: contact-2 to contact+5
  const windowStart = Math.max(0, contact - 2)
  const windowEnd = Math.min(n - 2, contact + 5)
  if (windowEnd <= windowStart) return [0, 0]

  const anglesAfter: (number | null)[] = []
  for (let i = windowStart; i <= windowEnd; i++) {
    const kp = frames[i].keypoints
    if (!kpConf(kp, [hitS, hitE, hitW], 0.3)) {
      anglesAfter.push(null)
    } else {
      // Forearm angle: elbow → wrist direction
      anglesAfter.push(angleOfLine(kp[hitE], kp[hitW]))
    }
  }

  const valid = anglesAfter
    .map((a, i) => a !== null ? [i + windowStart, a] as [number, number] : null)
    .filter(Boolean) as [number, number][]

  if (valid.length < 3) return [0, 0]

  // Calculate angular velocity of the forearm
  const angVels: number[] = []
  for (let j = 1; j < valid.length; j++) {
    const di = valid[j][0] - valid[j - 1][0]
    const da = valid[j][1] - valid[j - 1][1]
    if (di > 0) angVels.push(Math.abs(da / di) * fps)
  }

  if (angVels.length === 0) return [0, 0]

  const maxAngVel = Math.max(...angVels)

  // Weight angular velocity near contact more heavily
  const nearContactVels = angVels.slice(Math.max(0, angVels.length - 3))
  const nearContactMax = nearContactVels.length > 0 ? Math.max(...nearContactVels) : 0
  const effectiveVel = Math.max(maxAngVel * 0.4, nearContactMax * 0.6)

  let score: number
  if (effectiveVel > 500) score = 90
  else if (effectiveVel > 300) score = 75
  else if (effectiveVel > 150) score = 55
  else score = 35

  return [clamp(score), Math.round(maxAngVel * 100) / 100]
}

function calcContactHeight(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean): [number, number] {
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const n = frames.length
  const contact = Math.min(phases.contactFrame, n - 1)
  const peak = Math.min(phases.jumpPeak, n - 1)
  const personHeight = phases.personHeight

  if (personHeight < 50) return [0, 0]

  const kpC = frames[contact].keypoints
  if (kpC[hitW].conf < 0.3) {
    // Fallback: use hip Y difference
    const hDiff = (phases.hipYs[contact] - phases.hipYs[peak]) / personHeight
    let score: number
    if (Math.abs(hDiff) < 0.03) score = 95
    else if (Math.abs(hDiff) < 0.10) score = 80
    else if (Math.abs(hDiff) < 0.20) score = 60
    else if (Math.abs(hDiff) < 0.35) score = 40
    else score = 20
    return [clamp(score), Math.round(Math.abs(hDiff) * 1000) / 1000]
  }

  const contactWristY = kpC[hitW].y

  // Find minimum wrist Y (highest point) within ±3 frames of peak
  const searchStart = Math.max(0, peak - 3)
  const searchEnd = Math.min(n - 1, peak + 3)
  const wristYs: number[] = []
  for (let i = searchStart; i <= searchEnd; i++) {
    if (frames[i].keypoints[hitW].conf > 0.3) wristYs.push(frames[i].keypoints[hitW].y)
  }

  const minWristY = wristYs.length > 0 ? Math.min(...wristYs) : contactWristY
  const hDiff = (contactWristY - minWristY) / personHeight

  // Bonus: wrist should be above head (nose)
  const headY = kpC[NOSE].conf > 0.3 ? kpC[NOSE].y : Infinity
  const wristAboveHead = headY !== Infinity ? (headY - contactWristY) / personHeight : 0

  let score: number
  if (hDiff < 0.03) {
    score = 95
    if (wristAboveHead > 0.10) score = Math.min(100, score + 5)
  } else if (hDiff < 0.10) score = 80
  else if (hDiff < 0.20) score = 60
  else if (hDiff < 0.35) score = 40
  else score = 20

  return [clamp(score), Math.round(hDiff * 1000) / 1000]
}

function calcFollowThrough(frames: FrameData[], phases: PhaseInfo, isLeftHanded: boolean): [number, number] {
  const hitW = isLeftHanded ? L_WRIST : R_WRIST
  const n = frames.length
  const contact = phases.contactFrame
  const ftEnd = Math.min(phases.followThroughEnd, n - 1)
  const personHeight = phases.personHeight

  if (ftEnd <= contact || personHeight < 50) return [0, 0]

  // Collect wrist positions during follow-through
  const wristPos: { x: number; y: number }[] = []
  for (let i = contact; i <= ftEnd; i++) {
    if (frames[i].keypoints[hitW].conf > 0.3) {
      wristPos.push(frames[i].keypoints[hitW])
    }
  }
  if (wristPos.length < 2) return [0, 0]

  let score = 0

  // 1. Total travel distance (normalized by height)
  let totalTravel = 0
  for (let i = 1; i < wristPos.length; i++) {
    totalTravel += dist(wristPos[i], wristPos[i - 1])
  }
  const normTravel = totalTravel / personHeight
  if (normTravel > 1.5) score += 35
  else if (normTravel > 0.8) score += 28
  else if (normTravel > 0.4) score += 18
  else score += 8

  // 2. Follow-through direction: should cross midline and go downward
  const kpC = frames[Math.min(contact, n - 1)].keypoints
  let midlineX = wristPos[0].x
  if (kpC[L_HIP].conf > 0.3 && kpC[R_HIP].conf > 0.3) {
    midlineX = midpoint(kpC[L_HIP], kpC[R_HIP]).x
  }

  const crossesMidline = wristPos.some(wp =>
    (isLeftHanded ? wp.x < midlineX : wp.x > midlineX)
  )
  if (crossesMidline) score += 30
  else {
    const endDist = Math.abs(wristPos[wristPos.length - 1].x - midlineX)
    const startDist = Math.abs(wristPos[0].x - midlineX)
    score += endDist < startDist ? 18 : 5
  }

  // 3. Downward trajectory (arm comes down after contact)
  if (wristPos[wristPos.length - 1].y > wristPos[0].y) {
    score += 20
    // Bonus: reaches below waist level
    const waistY = kpC[L_HIP].conf > 0.3 ? kpC[L_HIP].y : Infinity
    if (waistY !== Infinity && wristPos[wristPos.length - 1].y > waistY - personHeight * 0.05) {
      score += 15
    }
  } else {
    score += 5
  }

  return [clamp(score), Math.round(normTravel * 1000) / 1000]
}

function calcLandingBalance(frames: FrameData[], phases: PhaseInfo): [number, number] {
  const n = frames.length
  const peak = phases.jumpPeak
  const personHeight = phases.personHeight

  if (peak >= n - 2 || personHeight < 50) return [0, 0]

  // Find landing frame: hip Y returns near approach level
  const approachHipY = phases.hipYs[phases.plantFrame]
  let landingFrame = -1

  for (let i = peak + 1; i < n; i++) {
    if (phases.hipYs[i] >= approachHipY - personHeight * 0.05) {
      landingFrame = i; break
    }
  }
  if (landingFrame < 0) landingFrame = Math.min(peak + Math.floor(n * 0.2), n - 1)
  landingFrame = Math.min(landingFrame, n - 1)

  const kp = frames[landingFrame].keypoints

  // Minimum confidence check for landing analysis
  if (!kpConf(kp, [L_KNEE, R_KNEE, L_ANKLE, R_ANKLE, L_HIP, R_HIP], 0.2)) return [0, 0]

  let score = 0

  // 1. Knee bend at landing (critical for injury prevention)
  const kneeScores: number[] = []
  for (const [hipI, kneeI, ankleI] of [[L_HIP, L_KNEE, L_ANKLE], [R_KNEE, R_ANKLE, R_HIP]] as [number, number, number][]) {
    if (kpConf(kp, [hipI, kneeI, ankleI], 0.3)) {
      const angle = angleBetween(kp[hipI], kp[kneeI], kp[ankleI])
      if (angle >= 90 && angle <= 140) kneeScores.push(90)
      else if (angle >= 70 && angle <= 160) kneeScores.push(65)
      else if (angle < 70) kneeScores.push(50) // Too deep
      else kneeScores.push(30) // Too straight (dangerous)
    }
  }
  if (kneeScores.length > 0) {
    score += Math.round(kneeScores.reduce((a, b) => a + b, 0) / kneeScores.length) * 0.45
  } else {
    score += 15
  }

  // 2. Hip levelness (balanced landing)
  if (kpConf(kp, [L_HIP, R_HIP], 0.3)) {
    const hipDiff = Math.abs(kp[L_HIP].y - kp[R_HIP].y) / personHeight
    if (hipDiff < 0.03) score += 25
    else if (hipDiff < 0.06) score += 18
    else if (hipDiff < 0.10) score += 10
    else score += 3
  } else {
    score += 8
  }

  // 3. Two-footed landing with level feet
  const bothFeet = kp[L_ANKLE].conf > 0.3 && kp[R_ANKLE].conf > 0.3
  const oneFoot = kp[L_ANKLE].conf > 0.3 || kp[R_ANKLE].conf > 0.3

  if (bothFeet) {
    const footDiff = Math.abs(kp[L_ANKLE].y - kp[R_ANKLE].y) / personHeight
    if (footDiff < 0.05) score += 20
    else if (footDiff < 0.15) score += 14
    else score += 8
  } else if (oneFoot) {
    score += 10
  } else {
    score += 3
  }

  // 4. Shoulders over hips (not leaning excessively)
  if (kpConf(kp, [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP], 0.3)) {
    const shoulderC = midpoint(kp[L_SHOULDER], kp[R_SHOULDER])
    const hipC = midpoint(kp[L_HIP], kp[R_HIP])
    const offsetNorm = Math.abs(shoulderC.x - hipC.x) / personHeight
    if (offsetNorm < 0.05) score += 10
    else if (offsetNorm < 0.15) score += 6
    else score += 2
  }

  return [clamp(Math.round(score)), 0]
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
    if (scores.body_position_air < 40) parts.push("Your body position in the air needs significant work. Focus on tucking your knees to ~90\u00b0 at peak height, keeping your non-hitting arm extended for balance, and maintaining a slight arch in your lower back to load power for the swing.")
    else if (scores.body_position_air < 55) parts.push("Work on maintaining better body position in the air \u2014 keep your knees bent at peak height and your non-hitting arm extended for balance. A slight backward arch helps generate power.")
    else if (scores.body_position_air > 85) parts.push("Excellent airborne body position with proper knee tuck, level hips, and good arm balance.")
    if (scores.torso_angle_air < 40) parts.push("Your torso angle during the jump needs improvement. You should have a slight backward lean (10-25\u00b0) early in the airborne phase, then snap your torso forward at contact for the whip effect.")
    else if (scores.torso_angle_air < 55) parts.push("Focus on the arch-to-whip transition: lean slightly back during the airborne phase, then aggressively snap your torso forward as you swing at the ball.")
    else if (scores.torso_angle_air > 85) parts.push("Great arch-to-whip torso transition that maximizes power transfer through the swing.")
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

  // ── Step 1: Two-pass frame extraction (scan → dense) ──
  onProgress(3, 'Loading video...')
  const { imageData, frameImages, frameTimestamps, duration, fps, width, height, actionWindowStart, actionWindowEnd } = await extractFramesFromVideo(videoFile, onProgress)

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
    ['body_position_air', () => calcBodyPositionAir(framesData, phases, isLeftHanded)],
    ['torso_angle_air', () => calcTorsoAngleAir(framesData, phases, isLeftHanded)],
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

  // ── Per-metric confidence based on keypoint quality in relevant frames ──
  const detectedFrameIndices = framesData.map(fd => fd.frameIdx)
  const n = framesData.length

  // Helper: frames in a range that exist in detectedFrameIndices
  const framesInRange = (start: number, end: number) => {
    return detectedFrameIndices.filter(i => i >= start && i <= end)
  }

  // Base confidence from total frame count (adjusted for dense sampling)
  let baseConf = 50
  if (n >= 60) baseConf = 92
  else if (n >= 40) baseConf = 85
  else if (n >= 25) baseConf = 78
  else if (n >= 15) baseConf = 65
  else if (n >= 8) baseConf = 50

  // Per-metric confidence: check keypoint confidence in the frames each metric uses
  const metricKpMap: Record<string, { start: number; end: number; kps: number[] }> = {
    approach_speed:       { start: phases.approachStart, end: phases.approachEnd, kps: [L_HIP, R_HIP] },
    approach_angle:       { start: phases.approachStart, end: phases.plantFrame, kps: [L_HIP, R_HIP] },
    last_step_length:     { start: Math.max(0, phases.plantFrame - Math.floor(n * 0.3)), end: phases.plantFrame, kps: [L_ANKLE, R_ANKLE] },
    footwork_rhythm:      { start: Math.max(0, phases.plantFrame - Math.floor(30 * 2.5)), end: phases.plantFrame, kps: [L_ANKLE, R_ANKLE] },
    arms_swing_back:      { start: phases.approachStart, end: phases.plantFrame, kps: [L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST, L_HIP, R_HIP] },
    vertical_jump_conversion: { start: phases.plantFrame, end: phases.jumpPeak, kps: [L_HIP, R_HIP] },
    hip_shoulder_rotation: { start: phases.plantFrame, end: phases.contactFrame, kps: [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP] },
    body_position_air:    { start: phases.plantFrame, end: phases.contactFrame, kps: [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_KNEE, R_KNEE, NOSE] },
    torso_angle_air:      { start: phases.plantFrame, end: phases.contactFrame, kps: [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP] },
    bow_and_arrow:        { start: phases.plantFrame, end: phases.contactFrame, kps: [L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW, L_WRIST, R_WRIST] },
    arm_swing_speed:      { start: phases.plantFrame, end: phases.followThroughEnd, kps: [L_WRIST, R_WRIST] },
    contact_point:        { start: phases.contactFrame, end: phases.contactFrame, kps: [L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW, L_WRIST, R_WRIST] },
    wrist_snap:           { start: Math.max(0, phases.contactFrame - 2), end: Math.min(n - 1, phases.contactFrame + 5), kps: [L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW, L_WRIST, R_WRIST] },
    contact_height:       { start: Math.max(0, phases.jumpPeak - 3), end: Math.min(n - 1, phases.contactFrame), kps: [L_WRIST, R_WRIST, NOSE] },
    follow_through:       { start: phases.contactFrame, end: phases.followThroughEnd, kps: [L_WRIST, R_WRIST, L_HIP, R_HIP] },
    landing_balance:      { start: phases.jumpPeak, end: phases.followThroughEnd, kps: [L_KNEE, R_KNEE, L_ANKLE, R_ANKLE, L_HIP, R_HIP, L_SHOULDER, R_SHOULDER] },
  }

  const confidence: Record<string, number> = {}
  for (const [key, range] of Object.entries(metricKpMap)) {
 const fIdxs = framesInRange(range.start, range.end)
    if (fIdxs.length === 0) {
      confidence[key] = 10
    } else {
      // If score is 0, confidence should be low
      if (scores[key] === 0) {
        confidence[key] = 15
      } else {
        const kpConf = avgKpConf(framesData, range.start, range.end, range.kps)
        // Scale confidence by keypoint quality and frame count
        const frameFactor = Math.min(1, fIdxs.length / 5)
        const kpFactor = Math.min(1, kpConf / 0.5) // 0.5 avg conf = full confidence
        confidence[key] = clamp(Math.round(baseConf * 0.3 + 70 * frameFactor * kpFactor))
      }
    }
  }

  const avgConfidence = Math.round(Object.values(confidence).reduce((s, v) => s + v, 0) / Object.keys(confidence).length)

  // ── Step 8: Map checkpoints and phases to frame indices ──
  // Each checkpoint maps to the SPECIFIC frames used for that metric
  const phaseFrames: Record<string, number[]> = {}
  const checkpointFrames: Record<string, number[]> = {}

  // Phase frame ranges
  const phaseFrameRanges: Record<string, [number, number]> = {
    approach: [phases.approachStart, phases.approachEnd],
    jump: [phases.plantFrame, phases.contactFrame],
    contact: [phases.contactFrame, phases.contactFrame],
    followThrough: [phases.contactFrame, phases.followThroughEnd],
  }
  for (const [phaseKey, [start, end]] of Object.entries(phaseFrameRanges)) {
    phaseFrames[phaseKey] = framesInRange(start, end)
  }

  // Map each checkpoint to its specific metric-relevant frames
  for (const [cpKey, range] of Object.entries(metricKpMap)) {
    const cpFrames = framesInRange(range.start, range.end)
    checkpointFrames[cpKey] = cpFrames
  }

  // Ensure contact_frame is included in contact metrics
  if (detectedFrameIndices.includes(phases.contactFrame)) {
    for (const cp of ['contact_point', 'wrist_snap', 'contact_height']) {
      if (!checkpointFrames[cp].includes(phases.contactFrame)) {
        checkpointFrames[cp].push(phases.contactFrame)
      }
      checkpointFrames[cp].sort((a, b) => a - b)
    }
  }

  // Ensure peak frames are in airborne metrics
  for (const cp of ['body_position_air', 'torso_angle_air']) {
    const peakFrames = detectedFrameIndices.filter(i => Math.abs(i - phases.jumpPeak) <= 2)
    for (const pf of peakFrames) {
      if (!checkpointFrames[cp].includes(pf)) checkpointFrames[cp].push(pf)
    }
    checkpointFrames[cp].sort((a, b) => a - b)
  }

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
      actionWindowStart: Math.round(actionWindowStart * 100) / 100,
      actionWindowEnd: Math.round(actionWindowEnd * 100) / 100,
    },
    frames: frameImages,
    frameTimestamps: frameTimestamps,
    checkpointFrames,
    phaseFrames,
  }

  onProgress(100, 'Analysis complete!')

  console.log(`[SpikeLab] Analysis complete. Overall: ${overallPower}, Level: ${level}, Frames: ${framesData.length}`)
  return analysis
}