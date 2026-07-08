import { NextRequest, NextResponse } from 'next/server'
import { writeFile, unlink, readdir, mkdtemp, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
// Direct OpenAI-compatible API — no Z.ai dependency
// Configure via env vars: OPENAI_API_KEY (required), OPENAI_BASE_URL (optional), OPENAI_MODEL (optional)
import type { SpikeAnalysis, CheckpointScores, CheckpointConfidence } from '@/lib/spike-types'
import { extractFrames } from '@/lib/extract-frames'
import { createJob, updateJob, completeJob, failJob } from '@/lib/analysis-jobs'

// Prevent unhandled rejections from crashing the dev server
if (typeof process !== 'undefined' && process.on) {
  process.on('unhandledRejection', (reason) => {
    console.error('[SpikeLab] Unhandled rejection (prevented crash):', reason)
  })
}

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const ANALYSIS_PROMPT = `You are an expert volleyball biomechanics analyst. You are watching KEY FRAMES extracted from a video of a volleyball player performing a spike (approach, jump, hit, and landing). The frames are in chronological order.

Analyze these frames and for each of the 16 biomechanical checkpoints below, rate the player's execution on a scale of 0-100:
- 0-25: Critical (major flaw, significant power loss or injury risk)
- 26-50: Needs Work (noticeable issue affecting performance)
- 51-75: Decent (acceptable but room for improvement)
- 76-100: Excellent (elite or near-elite execution)

APPROACH PHASE (5 checkpoints):
1. approach_speed: How fast and explosive is the approach? Is the player building momentum effectively?
2. approach_angle: Is the approach angle optimal (roughly 45-60 degrees toward the net)?
3. last_step_length: Is the second-to-last (braking) step appropriately long to convert horizontal to vertical momentum?
4. footwork_rhythm: Is the slow-to-fast rhythm correct? The last 2 steps should be the fastest.
5. arms_swing_back: Do both arms swing back during the plant to load elastic energy?

JUMP & ROTATION PHASE (4 checkpoints):
6. vertical_jump_conversion: How efficiently is horizontal momentum converted to vertical height?
7. hip_shoulder_rotation: Is there proper hip-shoulder separation (torque) before hitting?
8. body_position_air: Is the body in a good athletic position at peak height?
9. torso_angle_air: Analyze the torso/spine during the AIRBORNE phase — arch, whip transition, spinal alignment, trunk rotation timing.

ARM SWING & CONTACT PHASE (5 checkpoints):
10. bow_and_arrow: Is the hitting arm in a proper bow-and-arrow loading position?
11. arm_swing_speed: How fast and explosive is the arm whip?
12. contact_point: Is contact made at full extension, slightly in front of the hitting shoulder?
13. wrist_snap: Is there a strong wrist snap over the ball for topspin?
14. contact_height: How high is the contact point relative to the net?

FOLLOW-THROUGH PHASE (2 checkpoints):
15. follow_through: Does the arm continue across the body to the opposite hip?
16. landing_balance: Is the landing soft, on two feet, with knees bent?

PER-CHECKPOINT FEEDBACK:
For EACH checkpoint, write 1-2 specific sentences about what you ACTUALLY SEE. Reference specific body positions and timing.

PHASE FEEDBACK & SPECIFIC FIX:
For each phase, provide:
- feedback: 2-3 sentences describing the overall phase execution with specific observations
- specificFix: 1-2 actionable sentences describing the SINGLE most impactful fix for this phase.

PRIORITY ORDER:
Rank the 4 phases from weakest to strongest. The weakest phase should be #1.

Return your analysis as a JSON object with this EXACT structure (no markdown, no code fences, just raw JSON):
{
  "scores": {
    "approach_speed": <0-100>, "approach_angle": <0-100>, "last_step_length": <0-100>, "footwork_rhythm": <0-100>, "arms_swing_back": <0-100>,
    "vertical_jump_conversion": <0-100>, "hip_shoulder_rotation": <0-100>, "body_position_air": <0-100>, "torso_angle_air": <0-100>,
    "bow_and_arrow": <0-100>, "arm_swing_speed": <0-100>, "contact_point": <0-100>, "wrist_snap": <0-100>, "contact_height": <0-100>,
    "follow_through": <0-100>, "landing_balance": <0-100>
  },
  "confidence": {
    "approach_speed": <0-100>, "approach_angle": <0-100>, "last_step_length": <0-100>, "footwork_rhythm": <0-100>, "arms_swing_back": <0-100>,
    "vertical_jump_conversion": <0-100>, "hip_shoulder_rotation": <0-100>, "body_position_air": <0-100>, "torso_angle_air": <0-100>,
    "bow_and_arrow": <0-100>, "arm_swing_speed": <0-100>, "contact_point": <0-100>, "wrist_snap": <0-100>, "contact_height": <0-100>,
    "follow_through": <0-100>, "landing_balance": <0-100>
  },
  "checkpointFeedback": {
    "approach_speed": "<1-2 specific sentences>", "approach_angle": "<1-2 specific sentences>", "last_step_length": "<1-2 specific sentences>", "footwork_rhythm": "<1-2 specific sentences>", "arms_swing_back": "<1-2 specific sentences>",
    "vertical_jump_conversion": "<1-2 specific sentences>", "hip_shoulder_rotation": "<1-2 specific sentences>", "body_position_air": "<1-2 specific sentences>", "torso_angle_air": "<1-2 specific sentences about torso>",
    "bow_and_arrow": "<1-2 specific sentences>", "arm_swing_speed": "<1-2 specific sentences>", "contact_point": "<1-2 specific sentences>", "wrist_snap": "<1-2 specific sentences>", "contact_height": "<1-2 specific sentences>",
    "follow_through": "<1-2 specific sentences>", "landing_balance": "<1-2 specific sentences>"
  },
  "phaseAnalysis": {
    "approach": { "score": <average of 5 approach scores>, "feedback": "<2-3 sentences>", "specificFix": "<1-2 sentence fix>" },
    "jump": { "score": <average of 4 jump scores>, "feedback": "<2-3 sentences>", "specificFix": "<1-2 sentence fix>" },
    "contact": { "score": <average of 5 contact scores>, "feedback": "<2-3 sentences>", "specificFix": "<1-2 sentence fix>" },
    "followThrough": { "score": <average of 2 follow-through scores>, "feedback": "<2-3 sentences>", "specificFix": "<1-2 sentence fix>" }
  },
  "topStrengths": ["<checkpoint>: <1 sentence why it is good>"],
  "topWeaknesses": ["<checkpoint>: <1-2 sentences what is wrong and what to fix>"],
  "coachNotes": "<3-5 sentences of specific coaching advice.>",
  "estimatedLevel": "<beginner|intermediate|advanced|elite>",
  "estimatedApproachSpeed": "<slow|moderate|fast|explosive>",
  "overallPower": <0-100>,
  "priorityOrder": ["<weakest phase>", "<second weakest>", "<third>", "<strongest>"]
}

CONFIDENCE SCORES (CRITICAL):
For EACH checkpoint, also provide a confidence score (0-100) indicating how certain you are about your assessment:
- 76-100: High confidence — the checkpoint is clearly visible in the frames
- 26-75: Low confidence — partially visible, some guessing required
- 0-25: Not visible — the checkpoint cannot be assessed from these frames
- If a checkpoint cannot be determined from the frames, set score=0 and confidence=0.

The following 4 checkpoints measure DYNAMIC MOTION that is inherently difficult to assess from static frames:
- approach_speed, footwork_rhythm, arm_swing_speed, vertical_jump_conversion
For these, set confidence lower unless the frame sequence clearly captures the motion.

Also include: "framesWithPlayer": <number of frames (out of ${FRAME_COUNT}) where the player is clearly visible>

Be EXTREMELY specific. Reference what you actually see in the frames. If you cannot see something, say so honestly with score=0 and confidence=0. Return ONLY the JSON.`

const FRAME_COUNT = 8

function clampScore(val: number, defaultVal = 0): number {
  const n = typeof val === 'number' && !isNaN(val) ? val : defaultVal
  return Math.round(Math.max(0, Math.min(100, n)))
}

function parseAndValidate(raw: string): SpikeAnalysis | null {
  let cleaned = raw.trim()
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) cleaned = fenceMatch[1].trim()

  try {
    const data = JSON.parse(cleaned)

    const scoreKeys: (keyof CheckpointScores)[] = [
      'approach_speed', 'approach_angle', 'last_step_length', 'footwork_rhythm',
      'arms_swing_back', 'vertical_jump_conversion', 'hip_shoulder_rotation',
      'body_position_air', 'torso_angle_air', 'bow_and_arrow', 'arm_swing_speed',
      'contact_point', 'wrist_snap', 'contact_height', 'follow_through', 'landing_balance',
    ]

    const scores: Record<string, number> = {}
    const confidence: Record<string, number> = {}
    for (const key of scoreKeys) {
      scores[key] = clampScore(data.scores?.[key])
      confidence[key] = clampScore(data.confidence?.[key])
    }

    const approachKeys = ['approach_speed', 'approach_angle', 'last_step_length', 'footwork_rhythm', 'arms_swing_back']
    const jumpKeys = ['vertical_jump_conversion', 'hip_shoulder_rotation', 'body_position_air', 'torso_angle_air']
    const contactKeys = ['bow_and_arrow', 'arm_swing_speed', 'contact_point', 'wrist_snap', 'contact_height']
    const followKeys = ['follow_through', 'landing_balance']
    const avg = (keys: string[]) => Math.round(keys.reduce((s, k) => s + scores[k], 0) / keys.length)

    const validPhases = ['approach', 'jump', 'contact', 'followThrough'] as const
    let priorityOrder: string[] = ['approach', 'contact', 'jump', 'followThrough']
    if (Array.isArray(data.priorityOrder)) {
      const filtered = data.priorityOrder.filter((p: string) => validPhases.includes(p as any))
      if (filtered.length === 4) {
        priorityOrder = filtered
      } else {
        const phaseScores: Record<string, number> = {
          approach: data.phaseAnalysis?.approach?.score ?? avg(approachKeys),
          jump: data.phaseAnalysis?.jump?.score ?? avg(jumpKeys),
          contact: data.phaseAnalysis?.contact?.score ?? avg(contactKeys),
          followThrough: data.phaseAnalysis?.followThrough?.score ?? avg(followKeys),
        }
        priorityOrder = (Object.entries(phaseScores) as [string, number][])
          .sort((a, b) => a[1] - b[1])
          .map(([k]) => k)
      }
    }

    return {
      scores: scores as unknown as CheckpointScores,
      confidence: confidence as unknown as CheckpointConfidence,
      phaseAnalysis: {
        approach: {
          score: data.phaseAnalysis?.approach?.score ?? avg(approachKeys),
          feedback: data.phaseAnalysis?.approach?.feedback ?? 'Approach phase analyzed.',
          specificFix: data.phaseAnalysis?.approach?.specificFix ?? 'Focus on building speed and rhythm in the approach.',
        },
        jump: {
          score: data.phaseAnalysis?.jump?.score ?? avg(jumpKeys),
          feedback: data.phaseAnalysis?.jump?.feedback ?? 'Jump phase analyzed.',
          specificFix: data.phaseAnalysis?.jump?.specificFix ?? 'Focus on converting horizontal momentum to vertical height.',
        },
        contact: {
          score: data.phaseAnalysis?.contact?.score ?? avg(contactKeys),
          feedback: data.phaseAnalysis?.contact?.feedback ?? 'Contact phase analyzed.',
          specificFix: data.phaseAnalysis?.contact?.specificFix ?? 'Focus on arm swing mechanics and contact point.',
        },
        followThrough: {
          score: data.phaseAnalysis?.followThrough?.score ?? avg(followKeys),
          feedback: data.phaseAnalysis?.followThrough?.feedback ?? 'Follow-through analyzed.',
          specificFix: data.phaseAnalysis?.followThrough?.specificFix ?? 'Focus on completing the follow-through and landing softly.',
        },
      },
      topStrengths: Array.isArray(data.topStrengths) ? data.topStrengths.slice(0, 5) : ['Solid effort visible in video.'],
      topWeaknesses: Array.isArray(data.topWeaknesses) ? data.topWeaknesses.slice(0, 5) : ['Multiple areas for improvement identified.'],
      coachNotes: data.coachNotes ?? 'Review your analysis results and focus on the weakest phase first.',
      estimatedLevel: ['beginner', 'intermediate', 'advanced', 'elite'].includes(data.estimatedLevel) ? data.estimatedLevel : 'intermediate',
      estimatedApproachSpeed: ['slow', 'moderate', 'fast', 'explosive'].includes(data.estimatedApproachSpeed) ? data.estimatedApproachSpeed : 'moderate',
      overallPower: clampScore(data.overallPower),
      priorityOrder,
      metadata: {
        frameCount,
        averageConfidence: Math.round(Object.values(confidence).reduce((s, v) => s + v, 0) / scoreKeys.length),
        framesWithPlayer: typeof data.framesWithPlayer === 'number' ? data.framesWithPlayer : undefined,
      },
    } as SpikeAnalysis
  } catch {
    return null
  }
}

async function runVisionAnalysis(imagePaths: string[], prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set. Please configure it in your Vercel project settings or .env file.')
  }

  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const model = process.env.OPENAI_MODEL || 'gpt-4o'

  const content: Array<{ type: string; image_url?: { url: string }; text?: string }> = [
    { type: 'text', text: prompt },
  ]
  for (const imgPath of imagePaths) {
    const buffer = await readFile(imgPath)
    const base64 = buffer.toString('base64')
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${base64}` },
    })
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      max_tokens: 4096,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown')
    throw new Error(`Vision API error (${response.status}): ${errorBody}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
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

    // Create job immediately — response is fast, no proxy timeout
    const job = createJob()
    const jobId = job.id

    // Read all form data now (while request is still alive)
    const playerName = (formData.get('name') as string) || 'the player'
    const position = (formData.get('position') as string) || 'Outside Hitter'
    const experience = (formData.get('experience') as string) || 'Intermediate'

    // Read video bytes into buffer while request is active
    const videoBytes = new Uint8Array(await videoFile.arrayBuffer())
    const videoName = videoFile.name
    const videoSize = videoFile.size

    // Return immediately with jobId — client will poll for results
    // Process in background — keep a reference to prevent GC in Next.js
    const bgPromise = (async () => {
      try {
        tempDir = await mkdtemp(path.join(tmpdir(), 'spikelab-'))
        const ext = videoName.split('.').pop() || 'mp4'
        const videoPath = path.join(tempDir, `spike_video.${ext}`)

        await writeFile(videoPath, Buffer.from(videoBytes))

        console.log(`[SpikeLab] [${jobId}] Analyzing video: ${videoName} (${(videoSize / 1024 / 1024).toFixed(1)}MB)`)

        // Step 1: Extract frames
        updateJob(jobId, { step: 'extracting', message: 'Extracting key frames from video...', percent: 10 })

        const frameCount = 8
        let framePaths: string[]
        try {
          framePaths = await extractFrames(videoPath, tempDir, frameCount)
        } catch (frameErr: unknown) {
          const msg = frameErr instanceof Error ? frameErr.message : 'Frame extraction failed'
          console.error(`[SpikeLab] [${jobId}] Frame extraction error:`, msg)
          failJob(jobId, msg)
          return
        }
        console.log(`[SpikeLab] [${jobId}] Extracted ${framePaths.length} frames from video`)

        if (framePaths.length === 0) {
          failJob(jobId, 'Could not extract any frames from the video. Please try a different video format.')
          return
        }

        updateJob(jobId, { step: 'extracted', message: `Extracted ${framePaths.length} frames. Preparing AI analysis...`, percent: 25 })

        // Step 2: AI Analysis
        const fullPrompt = ANALYSIS_PROMPT
          .replace('${FRAME_COUNT}', String(framePaths.length))
          + `\n\nAdditional context: This is ${playerName}, playing ${position} position, with ${experience} experience level. ${framePaths.length} frames were extracted from the video.`

        updateJob(jobId, { step: 'analyzing', message: 'AI is analyzing your spike technique...', percent: 35 })

        const rawContent = await runVisionAnalysis(framePaths, fullPrompt)
        console.log(`[SpikeLab] [${jobId}] VLM response received (${rawContent.length} chars)`)

        if (!rawContent) {
          failJob(jobId, 'AI analysis returned no content. Please try a clearer or shorter video.')
          return
        }

        updateJob(jobId, { step: 'parsing', message: 'Processing AI results...', percent: 92 })

        const analysis = parseAndValidate(rawContent)
        if (!analysis) {
          console.error(`[SpikeLab] [${jobId}] Parse failed. Content preview:`, rawContent.substring(0, 500))
          failJob(jobId, 'Could not parse AI results. Please try again.')
          return
        }

        console.log(`[SpikeLab] [${jobId}] Analysis complete. Overall: ${analysis.overallPower}, Level: ${analysis.estimatedLevel}`)
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