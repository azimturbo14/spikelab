import { execFile } from 'child_process'
import { statSync } from 'fs'
import path from 'path'

/**
 * Smart frame extraction for volleyball spike videos.
 *
 * Strategy:
 * 1. For short videos (<8s): skip motion detection, use even spacing
 * 2. For longer videos: use scene detection to find action window
 * 3. All frame extractions are SEQUENTIAL (parallel ffmpeg kills the sandbox)
 * 4. Generous timeouts and fallbacks to maximize reliability
 */

const MIN_FRAME_SIZE = 100 // 100B minimum — even tiny frames may be valid
const FRAME_EXTRACTION_TIMEOUT = 15_000 // per-frame timeout
const MOTION_DETECT_TIMEOUT = 20_000 // scene detection timeout

/** Get video duration via ffprobe */
function getDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ], { timeout: 10_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) { reject(new Error('Could not read video.')); return }
      const d = parseFloat(stdout.trim())
      if (!d || d <= 0 || !isFinite(d)) { reject(new Error('Video has no valid duration.')); return }
      resolve(d)
    })
  })
}

/** Detect motion/scene changes using ffmpeg's scene filter, with explicit timeout */
function detectMotion(videoPath: string, duration: number): Promise<{ time: number; score: number }[]> {
  return new Promise((resolve) => {
    const args = [
      '-i', videoPath,
      '-vf', "select='gt(scene,0.015)',showinfo",
      '-f', 'rawvideo',
      '-y', '/dev/null',
    ]

    // Explicit timeout fallback
    const timer = setTimeout(() => {
      console.warn('[SpikeLab] Motion detection timed out, using empty result')
      resolve([])
    }, MOTION_DETECT_TIMEOUT)

    execFile('ffmpeg', args, {
      timeout: MOTION_DETECT_TIMEOUT - 1000,
      maxBuffer: 10 * 1024 * 1024,
    }, (_err, _stdout, stderr) => {
      clearTimeout(timer)

      const rawTimes: number[] = []
      const ptsTimeRegex = /pts_time:(\d+\.?\d*)/g
      let match: RegExpExecArray | null
      const seen = new Set<number>()
      while ((match = ptsTimeRegex.exec(stderr)) !== null) {
        const time = parseFloat(match[1])
        const rounded = Math.round(time * 30) / 30
        if (time > 0 && time < duration && !seen.has(rounded)) {
          seen.add(rounded)
          rawTimes.push(time)
        }
      }

      // Cluster points within 0.3s
      const points: { time: number; score: number }[] = []
      let clusterStart = 0
      for (let i = 1; i <= rawTimes.length; i++) {
        const atEnd = i === rawTimes.length
        const gap = atEnd ? Infinity : rawTimes[i] - rawTimes[i - 1]
        if (gap > 0.3 || atEnd) {
          const cluster = rawTimes.slice(clusterStart, i)
          const centroid = cluster.reduce((a, b) => a + b, 0) / cluster.length
          points.push({ time: centroid, score: cluster.length })
          clusterStart = i
        }
      }

      resolve(points)
    })
  })
}

/**
 * Find the densest cluster of motion points.
 */
function findActionWindow(
  points: { time: number; score: number }[],
  duration: number,
  maxWindowSize: number
): { start: number; end: number } {
  if (points.length === 0) {
    const margin = duration * 0.15
    return { start: margin, end: duration - margin }
  }

  const sorted = [...points].sort((a, b) => a.time - b.time)
  const windowSize = Math.min(2.5, maxWindowSize)

  let bestStart = 0
  let bestEnd = sorted[0].time + 2
  let bestDensity = 0

  for (let i = 0; i < sorted.length; i++) {
    let count = 0
    let windowEnd = sorted[i].time
    for (let j = i; j < sorted.length; j++) {
      if (sorted[j].time - sorted[i].time <= windowSize) {
        count++
        windowEnd = sorted[j].time
      } else break
    }
    const windowSpan = Math.max(windowEnd - sorted[i].time, 0.1)
    const density = sorted.slice(i, i + count).reduce((sum, p) => sum + p.score, 0) / windowSpan
    if (density > bestDensity) {
      bestDensity = density
      bestStart = i
      bestEnd = windowEnd
    }
  }

  let start = sorted[bestStart].time
  let end = bestEnd
  // Ensure minimum 2s window
  if (end - start < 2.0) {
    const center = (start + end) / 2
    start = Math.max(0, center - 1)
    end = Math.min(duration, center + 1)
  }

  const padding = (end - start) * 0.15
  return {
    start: Math.max(0, start - padding),
    end: Math.min(duration, end + padding),
  }
}

/** Extract a single frame at a specific timestamp */
function extractSingleFrame(
  videoPath: string,
  outputPath: string,
  timestamp: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[SpikeLab] Frame extraction timed out at ${timestamp.toFixed(2)}s`)
      resolve(false)
    }, FRAME_EXTRACTION_TIMEOUT)

    execFile('ffmpeg', [
      '-ss', timestamp.toString(),
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',
      '-y',
      outputPath,
    ], { timeout: FRAME_EXTRACTION_TIMEOUT - 500 }, (err) => {
      clearTimeout(timer)
      if (err) { resolve(false); return }
      try {
        const stat = statSync(outputPath)
        resolve(stat.size >= MIN_FRAME_SIZE)
      } catch {
        resolve(false)
      }
    })
  })
}

/** Extract frames SEQUENTIALLY to avoid sandbox killing parallel ffmpeg */
async function extractFramesSequential(
  videoPath: string,
  timestamps: number[],
  outputDir: string,
  logPrefix: string
): Promise<string[]> {
  const extractedPaths: string[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const framePath = path.join(outputDir, `frame_${String(extractedPaths.length).padStart(2, '0')}.jpg`)
    const success = await extractSingleFrame(videoPath, framePath, timestamps[i])
    if (success) {
      extractedPaths.push(framePath)
    } else {
      console.warn(`${logPrefix} Failed to extract frame at ${timestamps[i].toFixed(2)}s`)
    }
  }
  return extractedPaths
}

/** Generate evenly-spaced timestamps */
function generateEvenTimestamps(count: number, start: number, end: number): number[] {
  const timestamps: number[] = []
  if (count <= 1) {
    timestamps.push((start + end) / 2)
  } else {
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1)
      timestamps.push(start + (end - start) * t)
    }
  }
  return timestamps
}

/**
 * Main export: Extract frames from a spike video.
 * Returns array of file paths to extracted JPEG frames.
 */
export async function extractFrames(
  videoPath: string,
  outputDir: string,
  count: number,
  logPrefix = '[SpikeLab]'
): Promise<string[]> {
  const duration = await getDuration(videoPath)
  console.log(`${logPrefix} Video duration: ${duration.toFixed(2)}s`)

  let timestamps: number[]

  // For short videos or as fallback: use even spacing
  const useEvenSpacing = duration < 8

  if (useEvenSpacing) {
    console.log(`${logPrefix} Using even spacing (short video)`)
    const start = duration * 0.05
    const end = duration * 0.95
    timestamps = generateEvenTimestamps(count, start, end)
  } else {
    // Try motion detection for longer videos
    console.log(`${logPrefix} Running motion detection...`)
    const motionPoints = await detectMotion(videoPath, duration)
    console.log(`${logPrefix} Found ${motionPoints.length} motion points`)

    if (motionPoints.length >= 3) {
      const actionWindow = findActionWindow(motionPoints, duration, Math.min(duration * 0.6, 4.0))
      console.log(`${logPrefix} Action window: ${actionWindow.start.toFixed(2)}s - ${actionWindow.end.toFixed(2)}s`)
      timestamps = generateEvenTimestamps(count, actionWindow.start, actionWindow.end)
    } else {
      console.log(`${logPrefix} Not enough motion points, using even spacing`)
      const start = duration * 0.1
      const end = duration * 0.9
      timestamps = generateEvenTimestamps(count, start, end)
    }
  }

  console.log(`${logPrefix} Extracting ${count} frames at: ${timestamps.map(t => t.toFixed(2) + 's').join(', ')}`)

  const extractedPaths = await extractFramesSequential(videoPath, timestamps, outputDir, logPrefix)

  // Fallback: if all extractions in the action window failed, try even spacing across full video
  if (extractedPaths.length === 0 && !useEvenSpacing) {
    console.warn(`${logPrefix} All extractions failed, trying full video even spacing`)
    const start = duration * 0.05
    const end = duration * 0.95
    timestamps = generateEvenTimestamps(count, start, end)
    const retryPaths = await extractFramesSequential(videoPath, timestamps, outputDir, logPrefix)
    if (retryPaths.length > 0) return retryPaths
  }

  if (extractedPaths.length === 0) {
    throw new Error('Failed to extract any frames from the video. The file may be corrupted or unsupported.')
  }

  console.log(`${logPrefix} Successfully extracted ${extractedPaths.length}/${count} frames`)
  return extractedPaths
}