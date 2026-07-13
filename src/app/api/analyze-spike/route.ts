import { NextRequest, NextResponse } from 'next/server'
import { writeFile, unlink, readdir, mkdtemp, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { spawn } from 'child_process'
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

const RESULTS_DIR = '/tmp/spikelab-results'

function clampScore(val: number, defaultVal = 0): number {
  const n = typeof val === 'number' && !isNaN(val) ? val : defaultVal
  return Math.round(Math.max(0, Math.min(100, n)))
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

  // Build scores with all 16 checkpoints
  const scores: Record<string, number> = {}
  for (const key of SCORE_KEYS) {
    scores[key] = clampScore(rawScores[key] ?? 50)
  }

  // Add torso_angle_air if not in raw scores
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
    const temporalCheckpoints = new Set(['approach_speed', 'footwork_rhythm', 'arm_swing_speed', 'vertical_jump_conversion'])
    confidence[key] = temporalCheckpoints.has(key) ? clampScore(baseConf - 10) : baseConf
  }

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

  const phaseScores = [
    { key: 'approach', score: phaseAnalysis.approach.score },
    { key: 'jump', score: phaseAnalysis.jump.score },
    { key: 'contact', score: phaseAnalysis.contact.score },
    { key: 'followThrough', score: phaseAnalysis.followThrough.score },
  ]
  const priorityOrder = phaseScores.sort((a, b) => a.score - b.score).map(p => p.key)

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
 * The analysis runs as a fully detached process that writes results to disk.
 * This prevents OOM from Python/PyTorch memory usage affecting the Node.js server.
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

    const job = createJob()
    const jobId = job.id

    // Read form data
    const videoBytes = new Uint8Array(await videoFile.arrayBuffer())
    const videoName = videoFile.name
    const videoSize = videoFile.size

    // Save video and launch detached analysis
    ;(async () => {
      try {
        tempDir = await mkdtemp(path.join(tmpdir(), 'spikelab-'))
        const ext = videoName.split('.').pop() || 'mp4'
        const videoPath = path.join(tempDir, `spike_video.${ext}`)

        await writeFile(videoPath, Buffer.from(videoBytes))

        // Ensure results directory exists
        await mkdir(RESULTS_DIR, { recursive: true })

        const resultFile = path.join(RESULTS_DIR, `${jobId}.json`)
        const errorFile = path.join(RESULTS_DIR, `${jobId}.error`)
        const lockFile = path.join(RESULTS_DIR, `${jobId}.lock`)

        // Write lock file
        await writeFile(lockFile, String(Date.now()), 'utf-8')

        console.log(`[SpikeLab] [${jobId}] Launching detached analysis: ${videoName} (${(videoSize / 1024 / 1024).toFixed(1)}MB)`)
        updateJob(jobId, { step: 'analyzing', message: 'Loading YOLOv8 pose model...', percent: 10 })

        // Create a shell wrapper that:
        // 1. Runs the Python analysis
        // 2. Writes stdout (the JSON result) to the result file
        // 3. Writes any error to the error file
        const shellScript = `#!/bin/bash
export HOME="/tmp"
export TORCH_HOME="/tmp/torch"
export HF_HOME="/tmp/hf"
export YOLO_CONFIG_DIR="/tmp/Ultralytics"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ANALYSIS_SCRIPT="$5"
VIDEO_PATH="$1"
RESULT_FILE="$2"
ERROR_FILE="$3"
LOCK_FILE="$4"

if [ ! -f "$ANALYSIS_SCRIPT" ]; then
  echo "Analysis script not found" > "$ERROR_FILE"
  rm -f "$LOCK_FILE"
  exit 1
fi

# Run analysis, capture output
OUTPUT=$(python3 "$ANALYSIS_SCRIPT" "$VIDEO_PATH" 2>/dev/null)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "Analysis failed (exit $EXIT_CODE)" > "$ERROR_FILE"
  rm -f "$LOCK_FILE"
  exit 1
fi

# Extract JSON from output (may have warnings)
echo "$OUTPUT" | python3 -c "
import sys, json
text = sys.stdin.read()
start = text.find('{')
end = text.rfind('}') + 1
if start >= 0 and end > start:
    data = json.loads(text[start:end])
    with open('$RESULT_FILE', 'w') as f:
        json.dump(data, f)
else:
    with open('$ERROR_FILE', 'w') as f:
        f.write('No JSON output from analysis')
" 2>/dev/null

rm -f "$LOCK_FILE"
`

        const wrapperPath = path.join(tempDir, 'run_detached.sh')
        await writeFile(wrapperPath, shellScript.replace(/\$RESULT_FILE/g, resultFile).replace(/\$ERROR_FILE/g, errorFile).replace(/\$LOCK_FILE/g, lockFile), { mode: 0o755 })

        // Spawn fully detached — no pipes, no parent-wait
        const child = spawn('bash', [wrapperPath, videoPath, resultFile, errorFile, lockFile, path.join(process.cwd(), 'spike_pose_analysis.py')], {
          env: { ...process.env, HOME: '/tmp' },
          detached: true,
          stdio: 'ignore',
          cwd: process.cwd(),
        })

        // Allow parent to exit independently
        child.unref()

        console.log(`[SpikeLab] [${jobId}] Detached process launched (PID ${child.pid})`)
      } catch (err: unknown) {
        console.error(`[SpikeLab] [${jobId}] Setup error:`, err)
        const message = err instanceof Error ? err.message : 'Failed to start analysis'
        failJob(jobId, message)
      }
    })()

    return NextResponse.json({ jobId })
  } catch (err: unknown) {
    console.error('[SpikeLab] Error reading request:', err)
    const message = err instanceof Error ? err.message : 'Failed to start analysis'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}