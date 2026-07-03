import { execFile } from 'child_process'
import { statSync } from 'fs'
import path from 'path'

/**
 * Smart frame extraction for volleyball spike videos.
 *
 * Strategy:
 * 1. Use ffmpeg scene detection to find motion peaks
 * 2. Cluster motion points to eliminate high-fps duplicates
 * 3. Find the densest cluster = the spike action
 * 4. Extract frames concentrated around that action window
 * 5. Fall back to even spacing if motion detection fails
 *
 * IMPORTANT: Frames are extracted SEQUENTIALLY (not in parallel)
 * because the sandbox kills parallel ffmpeg processes.
 */

interface MotionPoint {
  time: number
  score: number
}

const MIN_FRAME_SIZE = 1024 // 1KB minimum for a valid frame

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

/** Detect motion/scene changes using ffmpeg's scene filter */
function detectMotion(videoPath: string, duration: number): Promise<MotionPoint[]> {
  return new Promise((resolve) => {
    const args = [
      '-i', videoPath,
      '-vf', "select='gt(scene,0.012)',showinfo",
      '-f', 'rawvideo',
      '-y', '/dev/null',
    ]

    execFile('ffmpeg', args, {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    }, (_err, _stdout, stderr) => {
      const rawTimes: number[] = []
      const ptsTimeRegex = /pts_time:(\d+\.?\d*)/g
      let match: RegExpExecArray | null
      const seen = new Set<number>()
      while ((match = ptsTimeRegex.exec(stderr)) !== null) {
        const time = parseFloat(match[1])
        const rounded = Math.round(time * 60) / 60
        if (time > 0 && time < duration && !seen.has(rounded)) {
          seen.add(rounded)
          rawTimes.push(time)
        }
      }

      // Cluster points within 0.2s to eliminate high-fps duplicates.
      // Each cluster becomes one motion point with score = cluster size.
      const points: MotionPoint[] = []
      const clusterGap = 0.2
      let clusterStart = 0
      for (let i = 1; i <= rawTimes.length; i++) {
        const atEnd = i === rawTimes.length
        const gap = atEnd ? Infinity : rawTimes[i] - rawTimes[i - 1]
        if (gap > clusterGap || atEnd) {
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
 * Find the densest cluster of motion points using weighted density.
 * A cluster with many high-score points in a small window wins.
 * Minimum window of 2.0s ensures full spike coverage.
 */
function findActionWindow(points: MotionPoint[], duration: number, maxWindowSize: number): { start: number; end: number } {
  if (points.length === 0) {
    const margin = duration * 0.2
    return { start: margin, end: duration - margin }
  }

  const sorted = [...points].sort((a, b) => a.time - b.time)
  const minWindow = 2.0
  const windowSizes = [2.0, 2.5, 3.0].map(w => Math.min(w, maxWindowSize))

  let bestStart = 0
  let bestEnd = sorted[0].time + 2
  let bestDensity = 0

  for (const windowSize of windowSizes) {
    for (let i = 0; i < sorted.length; i++) {
      let count = 0
      let windowEnd = sorted[i].time
      for (let j = i; j < sorted.length; j++) {
        if (sorted[j].time - sorted[i].time <= windowSize) {
          count++
          windowEnd = sorted[j].time
        } else {
          break
        }
      }
      const windowSpan = Math.max(windowEnd - sorted[i].time, 0.1)
      const density = sorted.slice(i, i + count).reduce((sum, p) => sum + p.score, 0) / windowSpan

      if (density > bestDensity) {
        bestDensity = density
        bestStart = i
        bestEnd = windowEnd
      }
    }
  }

  // Ensure minimum window size
  let start = sorted[bestStart].time
  let end = bestEnd
  if (end - start < minWindow) {
    const center = (start + end) / 2
    const halfMin = minWindow / 2
    start = Math.max(0, center - halfMin)
    end = Math.min(duration, center + halfMin)
    if (end - start < minWindow) {
      if (start === 0) end = Math.min(duration, minWindow)
      else start = Math.max(0, end - minWindow)
    }
  }

  const clusterDuration = end - start
  const padding = clusterDuration * 0.15
  return {
    start: Math.max(0, start - padding),
    end: Math.min(duration, end + padding),
  }
}

/** Extract a single frame at a specific timestamp, with file validation */
function extractSingleFrame(
  videoPath: string,
  outputPath: string,
  timestamp: number
): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ffmpeg', [
      '-ss', timestamp.toString(),
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',
      '-y',
      outputPath,
    ], { timeout: 30_000 }, (err) => {
      if (err) { resolve(false); return }
      // Validate the file exists and has real content
      try {
        const stat = statSync(outputPath)
        resolve(stat.size >= MIN_FRAME_SIZE)
      } catch {
        resolve(false)
      }
    })
  })
}

/**
 * Extract multiple frames SEQUENTIALLY.
 * Parallel extraction causes the sandbox to kill ffmpeg processes.
 */
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

/**
 * Main export: Extract N frames intelligently from a spike video.
 */
export async function extractFrames(
  videoPath: string,
  outputDir: string,
  count: number,
  logPrefix = '[SpikeLab]'
): Promise<string[]> {
  const duration = await getDuration(videoPath)
  console.log(`${logPrefix} Video duration: ${duration.toFixed(2)}s`)

  if (duration < 3) {
    return extractEvenly(videoPath, outputDir, count, duration, logPrefix)
  }

  const motionPoints = await detectMotion(videoPath, duration)
  console.log(`${logPrefix} Motion detection found ${motionPoints.length} motion points`)

  const actionWindowDuration = Math.min(duration * 0.6, 4.0)
  const actionWindow = findActionWindow(motionPoints, duration, actionWindowDuration)
  console.log(`${logPrefix} Action window: ${actionWindow.start.toFixed(2)}s - ${actionWindow.end.toFixed(2)}s (${(actionWindow.end - actionWindow.start).toFixed(2)}s)`)

  const windowDuration = actionWindow.end - actionWindow.start
  const timestamps: number[] = []

  if (windowDuration < 1) {
    for (let i = 0; i < count; i++) {
      timestamps.push(actionWindow.start + (windowDuration * i) / Math.max(count - 1, 1))
    }
  } else {
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1)
      const biased = 0.15 + 0.7 * t
      timestamps.push(actionWindow.start + windowDuration * biased)
    }
  }

  console.log(`${logPrefix} Extracting ${count} frames at: ${timestamps.map(t => t.toFixed(2) + 's').join(', ')}`)

  const extractedPaths = await extractFramesSequential(videoPath, timestamps, outputDir, logPrefix)

  if (extractedPaths.length === 0) {
    console.warn(`${logPrefix} All motion-based extractions failed, falling back to even spacing`)
    return extractEvenly(videoPath, outputDir, count, duration, logPrefix)
  }

  console.log(`${logPrefix} Successfully extracted ${extractedPaths.length}/${count} frames from action window`)
  return extractedPaths
}

/** Fallback: extract frames evenly spaced, SEQUENTIALLY */
async function extractEvenly(
  videoPath: string,
  outputDir: string,
  count: number,
  duration: number,
  logPrefix: string
): Promise<string[]> {
  const startPct = 0.05
  const endPct = 0.95
  const interval = (endPct - startPct) / (count + 1)

  const timestamps: number[] = []
  for (let i = 0; i < count; i++) {
    timestamps.push((startPct + interval * (i + 1)) * duration)
  }

  console.log(`${logPrefix} Fallback: extracting ${count} frames evenly spaced`)

  const extractedPaths = await extractFramesSequential(videoPath, timestamps, outputDir, logPrefix)

  if (extractedPaths.length === 0) {
    throw new Error('Failed to extract any frames from video.')
  }

  return extractedPaths
}