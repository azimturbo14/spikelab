import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { writeFile, unlink, readdir, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import type { SpikeAnalysis, CheckpointScores } from '@/lib/spike-types'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

function clampScore(val: number): number {
  const n = typeof val === 'number' && !isNaN(val) ? val : 50
  return Math.round(Math.max(0, Math.min(100, n)))
}

function runYOLOAnalysis(videoPath: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'spike_pose_analysis.py')
    execFile('python3', [scriptPath, videoPath], {
      timeout: 90_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: '/tmp',
        YOLO_CONFIG_DIR: '/tmp/Ultralytics',
        TORCH_HOME: '/tmp/torch',
        HF_HOME: '/tmp/huggingface',
      },
    }, (error, stdout, stderr) => {
      if (error) {
        console.error('[SpikeLab] YOLO error:', stderr || error.message)
        reject(new Error(stderr || error.message))
        return
      }
      try {
        const data = JSON.parse(stdout.trim())
        if (data.error) {
          reject(new Error(data.error))
          return
        }
        resolve(data)
      } catch {
        console.error('[SpikeLab] Failed to parse YOLO output:', stdout.substring(0, 300))
        reject(new Error('Could not parse analysis results'))
      }
    })
  })
}

function mapToSpikeAnalysis(data: Record<string, unknown>): SpikeAnalysis {
  const scores = (data.scores || {}) as Record<string, number>
  const scoreKeys: (keyof CheckpointScores)[] = [
    'approach_speed', 'approach_angle', 'last_step_length', 'footwork_rhythm',
    'arms_swing_back', 'vertical_jump_conversion', 'hip_shoulder_rotation',
    'body_position_air', 'bow_and_arrow', 'arm_swing_speed', 'contact_point',
    'wrist_snap', 'contact_height', 'follow_through', 'landing_balance',
  ]

  const mappedScores: Record<string, number> = {}
  for (const key of scoreKeys) {
    mappedScores[key] = clampScore(scores[key])
  }

  const approachKeys = ['approach_speed', 'approach_angle', 'last_step_length', 'footwork_rhythm', 'arms_swing_back']
  const jumpKeys = ['vertical_jump_conversion', 'hip_shoulder_rotation', 'body_position_air']
  const contactKeys = ['bow_and_arrow', 'arm_swing_speed', 'contact_point', 'wrist_snap', 'contact_height']
  const followKeys = ['follow_through', 'landing_balance']
  const avg = (keys: string[]) => Math.round(keys.reduce((s, k) => s + mappedScores[k], 0) / keys.length)

  const phaseData = (data.phaseAnalysis || {}) as Record<string, Record<string, unknown>>

  return {
    scores: mappedScores as unknown as CheckpointScores,
    phaseAnalysis: {
      approach: {
        score: clampScore((phaseData.approach?.score as number) ?? avg(approachKeys)),
        feedback: (phaseData.approach?.feedback as string) || 'Approach phase analyzed from pose estimation data.',
      },
      jump: {
        score: clampScore((phaseData.jump?.score as number) ?? avg(jumpKeys)),
        feedback: (phaseData.jump?.feedback as string) || 'Jump and rotation phase analyzed from pose data.',
      },
      contact: {
        score: clampScore((phaseData.contact?.score as number) ?? avg(contactKeys)),
        feedback: (phaseData.contact?.feedback as string) || 'Arm swing and contact phase analyzed from pose data.',
      },
      followThrough: {
        score: clampScore((phaseData.followThrough?.score as number) ?? avg(followKeys)),
        feedback: (phaseData.followThrough?.feedback as string) || 'Follow-through and landing analyzed from pose data.',
      },
    },
    topStrengths: Array.isArray(data.topStrengths) ? data.topStrengths.slice(0, 5) as string[] : ['Analysis completed successfully using AI pose tracking.'],
    topWeaknesses: Array.isArray(data.topWeaknesses) ? data.topWeaknesses.slice(0, 5) as string[] : ['Multiple areas for improvement identified.'],
    coachNotes: (data.coachNotes as string) || 'Review your analysis results and focus on the weakest phase first.',
    estimatedLevel: ['beginner', 'intermediate', 'advanced', 'elite'].includes(data.estimatedLevel as string)
      ? (data.estimatedLevel as 'beginner' | 'intermediate' | 'advanced' | 'elite')
      : 'intermediate',
    estimatedApproachSpeed: ['slow', 'moderate', 'fast', 'explosive'].includes(data.estimatedApproachSpeed as string)
      ? (data.estimatedApproachSpeed as 'slow' | 'moderate' | 'fast' | 'explosive')
      : 'moderate',
    overallPower: clampScore(data.overallPower as number),
  }
}

export async function POST(request: NextRequest) {
  let tempDir = ''

  try {
    const formData = await request.formData()
    const videoFile = formData.get('video') as File | null

    if (!videoFile) {
      return NextResponse.json({ error: 'No video file provided' }, { status: 400 })
    }

    if (!videoFile.type.startsWith('video/') && !videoFile.name.match(/\.(mp4|mov|avi|webm|mkv|flv)$/i)) {
      return NextResponse.json({ error: 'Invalid file type. Please upload a video (MP4, MOV, AVI, WebM).' }, { status: 400 })
    }

    if (videoFile.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'Video file too large. Maximum 50MB.' }, { status: 400 })
    }

    // Save video to temp file
    tempDir = await mkdtemp(path.join(tmpdir(), 'spikelab-'))
    const ext = videoFile.name.split('.').pop() || 'mp4'
    const videoPath = path.join(tempDir, `spike_video.${ext}`)

    const bytes = await videoFile.arrayBuffer()
    await writeFile(videoPath, Buffer.from(bytes))

    const playerName = (formData.get('name') as string) || 'the player'
    const position = (formData.get('position') as string) || 'Outside Hitter'
    const experience = (formData.get('experience') as string) || 'Intermediate'

    console.log(`[SpikeLab] Analyzing video with YOLOv8: ${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)}MB)`)

    // Run YOLOv8 pose analysis (processes ALL frames, not just a few)
    const t0 = Date.now()
    const yoloResult = await runYOLOAnalysis(videoPath)
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

    const analysis = mapToSpikeAnalysis(yoloResult)
    const metrics = yoloResult.metrics as Record<string, number> | undefined

    console.log(`[SpikeLab] YOLO analysis complete in ${elapsed}s. Overall: ${analysis.overallPower}, Level: ${analysis.estimatedLevel}`)
    if (metrics) {
      console.log(`[SpikeLab] Metrics: ${metrics.frames_analyzed} frames, ${metrics.video_fps}fps, ${metrics.video_duration_sec}s duration`)
    }

    return NextResponse.json({
      analysis,
      analysisMethod: 'yolov8-pose',
      metrics: metrics || {},
      playerInfo: { name: playerName, position, experience },
    })
  } catch (err: unknown) {
    console.error('[SpikeLab] Error:', err)
    const message = err instanceof Error ? err.message : 'An unexpected error occurred'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    if (tempDir) {
      try {
        const files = await readdir(tempDir).catch(() => [])
        for (const f of files) await unlink(path.join(tempDir, f)).catch(() => {})
        await unlink(tempDir).catch(() => {})
      } catch { /* ignore cleanup errors */ }
    }
  }
}