import { NextRequest, NextResponse } from 'next/server'
import { writeFile, unlink, readdir, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { execFile } from 'child_process'
import type { SpikeAnalysis, CheckpointScores, CheckpointConfidence } from '@/lib/spike-types'
import { createJob, updateJob, completeJob, failJob } from '@/lib/analysis-jobs'

// Prevent unhandled rejections from crashing the dev server
if (typeof process !== 'undefined' && process.on) {
  process.on('unhandledRejection', (reason) => {
    console.error('[SpikeLab] Unhandled rejection (prevented crash):', reason)
  })
}

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const SCORE_KEYS: (keyof CheckpointScores)[] = [
  'approach_speed', 'approach_angle', 'last_step_length', 'footwork_rhythm',
  'arms_swing_back', 'vertical_jump_conversion', 'hip_shoulder_rotation',
  'body_position_air', 'torso_angle_air', 'bow_and_arrow', 'arm_swing_speed',
  'contact_point', 'wrist_snap', 'contact_height', 'follow_through', 'landing_balance',
]

function clampScore(val: number, defaultVal = 0): number {
  const n = typeof val === 'number' && !isNaN(val) ? val : defaultVal
  return Math.round(Math.max(0, Math.min(100, n)))
}

/**
 * Run the YOLOv8 pose analysis script on a video file.
 * Returns parsed SpikeAnalysis object.
 */
function runYoloAnalysis(videoPath: string): Promise<SpikeAnalysis> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'spike_pose_analysis.py')

    // Set environment variables for the subprocess
    const env = {
      ...process.env,
      HOME: '/tmp',
      TORCH_HOME: '/tmp/torch',
      HF_HOME: '/tmp/hf',
      YOLO_CONFIG_DIR: '/tmp/Ultralytics',
    }

    const child = execFile('python3', [scriptPath, videoPath], {
      env,
      timeout: 180_000, // 3 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for JSON output
      cwd: process.cwd(),
    }, (err, stdout, stderr) => {
      if (err) {
        // Check if there's a JSON error message in stdout
        try {
          const errorData = JSON.parse(stdout.trim())
          if (errorData.error) {
            reject(new Error(errorData.error))
            return
          }
        } catch {
          // Not JSON, use the raw error
        }
        const msg = stderr?.trim() || err.message
        reject(new Error(`YOLO analysis failed: ${msg.substring(0, 500)}`))
        return
      }

      try {
        // Parse JSON from stdout (may have warning lines before/after)
        let output = stdout.trim()
        const jsonStart = output.indexOf('{')
        const jsonEnd = output.lastIndexOf('}') + 1
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          output = output.substring(jsonStart, jsonEnd)
        }

        const data = JSON.parse(output)
        const analysis = buildAnalysis(data)
        resolve(analysis)
      } catch (parseErr) {
        console.error('[SpikeLab] Failed to parse YOLO output:', stdout.substring(0, 500))
        reject(new Error('Failed to parse analysis results. The video may not contain a detectable person.'))
      }
    })

    // Log stderr for debugging but don't fail on it
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      // Only log non-warning messages
      if (!text.includes('WARNING') && !text.includes('ultralytics')) {
        console.log('[SpikeLab YOLO]', text.trim())
      }
    })
  })
}

/**
 * Build a SpikeAnalysis object from the YOLO script's raw output.
 */
function buildAnalysis(data: Record<string, unknown>): SpikeAnalysis {
  const rawScores = (data.scores || {}) as Record<string, number>
  const metrics = (data.metrics || {}) as Record<string, number>
  const rawPhaseAnalysis = (data.phaseAnalysis || {}) as Record<string, Record<string, unknown>>
  const framesAnalyzed = typeof metrics.frames_analyzed === 'number' ? metrics.frames_analyzed : 0
  const videoDuration = typeof metrics.video_duration_sec === 'number' ? metrics.video_duration_sec : 0
  const videoFps = typeof metrics.video_fps === 'number' ? metrics.video_fps : 30

  // Build scores with all 16 checkpoints
  const scores: Record<string, number> = {}
  for (const key of SCORE_KEYS) {
    scores[key] = clampScore(rawScores[key] ?? 50)
  }

  // Add torso_angle_air if not in raw scores (original script has 15 checkpoints)
  if (!('torso_angle_air' in rawScores)) {
    scores.torso_angle_air = clampScore(scores.body_position_air * 0.9 + 5)
  }

  // Build confidence based on frames analyzed
  const confidence: Record<string, number> = {}
  let baseConf = 50
  if (framesAnalyzed >= 20) baseConf = 85
  else if (framesAnalyzed >= 15) baseConf = 75
  else if (framesAnalyzed >= 10) baseConf = 60
  else if (framesAnalyzed >= 5) baseConf = 45

  for (const key of SCORE_KEYS) {
    // Temporal checkpoints get slightly lower confidence
    const temporalCheckpoints = new Set(['approach_speed', 'footwork_rhythm', 'arm_swing_speed', 'vertical_jump_conversion'])
    confidence[key] = temporalCheckpoints.has(key) ? clampScore(baseConf - 10) : baseConf
  }

  // If torso_angle_air was estimated, give it lower confidence
  if (!('torso_angle_air' in rawScores)) {
    confidence.torso_angle_air = clampScore(baseConf - 25)
  }

  // Build checkpoint feedback from metrics
  const checkpointFeedback: Record<string, string> = {
    approach_speed: `Approach speed measured at ${metrics.approach_speed_px_per_sec ?? 'N/A'} px/s.`,
    approach_angle: `Approach angle: ${metrics.approach_angle_deg ?? 'N/A'}° from horizontal.`,
    last_step_length: `Last step ratio: ${metrics.last_step_ratio ?? 'N/A'}x leg length.`,
    footwork_rhythm: `Rhythm quality: ${metrics.rhythm_quality ?? 'N/A'}.`,
    arms_swing_back: `Max armswing back: ${metrics.max_armswing_back_angle ?? 'N/A'}°.`,
    vertical_jump_conversion: `Jump height ratio: ${metrics.jump_ratio ?? 'N/A'}x body height.`,
    hip_shoulder_rotation: `Peak hip-shoulder separation: ${metrics.peak_hip_shoulder_angle_deg ?? 'N/A'}°.`,
    body_position_air: 'Body alignment at peak jump measured via pose keypoints.',
    torso_angle_air: 'Torso angle estimated from body position at peak.',
    bow_and_arrow: 'Arm loading position analyzed near jump peak.',
    arm_swing_speed: `Max wrist speed: ${metrics.max_wrist_speed_px_per_sec ?? 'N/A'} px/s.`,
    contact_point: 'Contact position relative to hitting shoulder.',
    wrist_snap: 'Wrist angular velocity at contact measured.',
    contact_height: 'Contact height relative to hip position evaluated.',
    follow_through: 'Arm follow-through range of motion measured.',
    landing_balance: 'Landing stance and knee flexion analyzed.',
  }

  // Phase analysis
  const phaseKeys = ['approach', 'jump', 'contact', 'followThrough'] as const
  const phaseAnalysis = {
    approach: {
      score: clampScore((rawPhaseAnalysis.approach?.score as number) ?? 50),
      feedback: (rawPhaseAnalysis.approach?.feedback as string) ?? 'Approach phase analyzed.',
      specificFix: (rawPhaseAnalysis.approach?.specificFix as string) ?? 'Focus on building speed and rhythm in the approach.',
    },
    jump: {
      score: clampScore((rawPhaseAnalysis.jump?.score as number) ?? 50),
      feedback: (rawPhaseAnalysis.jump?.feedback as string) ?? 'Jump phase analyzed.',
      specificFix: (rawPhaseAnalysis.jump?.specificFix as string) ?? 'Focus on converting horizontal momentum to vertical height.',
    },
    contact: {
      score: clampScore((rawPhaseAnalysis.contact?.score as number) ?? 50),
      feedback: (rawPhaseAnalysis.contact?.feedback as string) ?? 'Contact phase analyzed.',
      specificFix: (rawPhaseAnalysis.contact?.specificFix as string) ?? 'Focus on arm swing mechanics and contact point.',
    },
    followThrough: {
      score: clampScore((rawPhaseAnalysis.followThrough?.score as number) ?? 50),
      feedback: (rawPhaseAnalysis.followThrough?.feedback as string) ?? 'Follow-through analyzed.',
      specificFix: (rawPhaseAnalysis.followThrough?.specificFix as string) ?? 'Focus on completing the follow-through and landing softly.',
    },
  }

  // Priority order (weakest phase first)
  const phaseScores = [
    { key: 'approach', score: phaseAnalysis.approach.score },
    { key: 'jump', score: phaseAnalysis.jump.score },
    { key: 'contact', score: phaseAnalysis.contact.score },
    { key: 'followThrough', score: phaseAnalysis.followThrough.score },
  ]
  const priorityOrder = phaseScores.sort((a, b) => a.score - b.score).map(p => p.key)

  // Average confidence
  const avgConfidence = Math.round(
    Object.values(confidence).reduce((s, v) => s + v, 0) / Object.keys(confidence).length
  )

  return {
    scores: scores as unknown as CheckpointScores,
    confidence: confidence as unknown as CheckpointConfidence,
    checkpointFeedback,
    phaseAnalysis,
    topStrengths: Array.isArray(data.topStrengths) ? data.topStrengths.slice(0, 5) as string[] : ['Solid effort visible in video.'],
    topWeaknesses: Array.isArray(data.topWeaknesses) ? data.topWeaknesses.slice(0, 5) as string[] : ['Multiple areas for improvement identified.'],
    coachNotes: (data.coachNotes as string) ?? 'Review your analysis results and focus on the weakest phase first.',
    estimatedLevel: ['beginner', 'intermediate', 'advanced', 'elite'].includes(data.estimatedLevel as string)
      ? (data.estimatedLevel as string) : 'intermediate',
    estimatedApproachSpeed: ['slow', 'moderate', 'fast', 'explosive'].includes(data.estimatedApproachSpeed as string)
      ? (data.estimatedApproachSpeed as string) : 'moderate',
    overallPower: clampScore(data.overallPower as number),
    priorityOrder,
    metadata: {
      frameCount: framesAnalyzed,
      duration: videoDuration,
      averageConfidence: avgConfidence,
      framesWithPlayer: framesAnalyzed,
      quality: avgConfidence >= 60 ? 'high' as const : avgConfidence >= 30 ? 'medium' as const : 'low' as const,
      analysisMethod: 'YOLOv8 Pose Estimation',
    },
  }
}

/**
 * POST: Start an analysis job. Returns immediately with { jobId }.
 * The actual processing happens in the background.
 */
export async function POST(request: NextRequest) {
  let tempDir = ''

  try {
    const formData = await request.formData()
    const videoFile = formData.get('video') as File | null

    if (!videoFile) {
      return NextResponse.json({ error: 'No video file provided' }, { status: 400 })
    }

    if (!videoFile.type.startsWith('video/') && !videoFile.name.match(/\.(mp4|mov|avi|webm|mkv|flv|m4v|3gp|3g2|mts|m2ts|ogv|wmv)$/i)) {
      return NextResponse.json({ error: 'Invalid file type. Please upload a video (MP4, MOV, AVI, WebM).' }, { status: 400 })
    }

    if (videoFile.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'Video file too large. Maximum 50MB.' }, { status: 400 })
    }

    // Create job immediately
    const job = createJob()
    const jobId = job.id

    // Read form data while request is alive
    const playerName = (formData.get('name') as string) || 'the player'
    const position = (formData.get('position') as string) || 'Outside Hitter'
    const experience = (formData.get('experience') as string) || 'Intermediate'

    // Read video bytes
    const videoBytes = new Uint8Array(await videoFile.arrayBuffer())
    const videoName = videoFile.name
    const videoSize = videoFile.size

    // Return immediately with jobId
    const bgPromise = (async () => {
      try {
        tempDir = await mkdtemp(path.join(tmpdir(), 'spikelab-'))
        const ext = videoName.split('.').pop() || 'mp4'
        const videoPath = path.join(tempDir, `spike_video.${ext}`)

        await writeFile(videoPath, Buffer.from(videoBytes))

        console.log(`[SpikeLab] [${jobId}] Analyzing video with YOLOv8: ${videoName} (${(videoSize / 1024 / 1024).toFixed(1)}MB)`)

        // Step 1: YOLOv8 Pose Analysis
        updateJob(jobId, { step: 'analyzing', message: 'Running YOLOv8 pose estimation on video frames...', percent: 15 })

        const analysis = await runYoloAnalysis(videoPath)

        console.log(`[SpikeLab] [${jobId}] YOLO analysis complete. Overall: ${analysis.overallPower}, Level: ${analysis.estimatedLevel}, Frames: ${analysis.metadata?.frameCount}`)

        updateJob(jobId, { step: 'done', message: 'Analysis complete!', percent: 100 })
        completeJob(jobId, analysis)
      } catch (err: unknown) {
        console.error(`[SpikeLab] [${jobId}] Error:`, err)
        const message = err instanceof Error ? err.message : 'An unexpected error occurred'
        failJob(jobId, message)
      } finally {
        if (tempDir) {
          try {
            const files = await readdir(tempDir).catch(() => [])
            for (const f of files) await unlink(path.join(tempDir, f)).catch(() => {})
            await unlink(tempDir).catch(() => {})
          } catch { /* ignore */ }
        }
      }
    })()

    // Keep a global reference to prevent Next.js/Turbopack from GC'ing the background promise
    ;(globalThis as unknown as Record<string, unknown>).__spikelab_bg = bgPromise

    return NextResponse.json({ jobId })
  } catch (err: unknown) {
    console.error('[SpikeLab] Error reading request:', err)
    const message = err instanceof Error ? err.message : 'Failed to start analysis'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}