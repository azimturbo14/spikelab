import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { writeFile, unlink, readdir, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import type { SpikeAnalysis, CheckpointScores } from '@/lib/spike-types'
import { extractFrames } from '@/lib/extract-frames'

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

Be EXTREMELY specific. Reference what you actually see in the frames. Return ONLY the JSON.`

function clampScore(val: number): number {
  const n = typeof val === 'number' && !isNaN(val) ? val : 50
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
    for (const key of scoreKeys) {
      scores[key] = clampScore(data.scores?.[key])
    }

    const approachKeys = ['approach_speed', 'approach_angle', 'last_step_length', 'footwork_rhythm', 'arms_swing_back']
    const jumpKeys = ['vertical_jump_conversion', 'hip_shoulder_rotation', 'body_position_air', 'torso_angle_air']
    const contactKeys = ['bow_and_arrow', 'arm_swing_speed', 'contact_point', 'wrist_snap', 'contact_height']
    const followKeys = ['follow_through', 'landing_balance']
    const avg = (keys: string[]) => Math.round(keys.reduce((s, k) => s + scores[k], 0) / keys.length)

    const checkpointFeedback: Record<string, string> = {}
    if (data.checkpointFeedback && typeof data.checkpointFeedback === 'object') {
      for (const key of scoreKeys) {
        const fb = data.checkpointFeedback[key]
        if (typeof fb === 'string' && fb.trim()) {
          checkpointFeedback[key] = fb.trim()
        }
      }
    }

    const validPhases = ['approach', 'jump', 'contact', 'followThrough'] as const
    let priorityOrder: SpikeAnalysis['priorityOrder'] = ['approach', 'contact', 'jump', 'followThrough']
    if (Array.isArray(data.priorityOrder)) {
      const filtered = data.priorityOrder.filter((p: string) => validPhases.includes(p as any))
      if (filtered.length === 4) {
        priorityOrder = filtered as SpikeAnalysis['priorityOrder']
      } else {
        const phaseScores: Record<string, number> = {
          approach: data.phaseAnalysis?.approach?.score ?? avg(approachKeys),
          jump: data.phaseAnalysis?.jump?.score ?? avg(jumpKeys),
          contact: data.phaseAnalysis?.contact?.score ?? avg(contactKeys),
          followThrough: data.phaseAnalysis?.followThrough?.score ?? avg(followKeys),
        }
        priorityOrder = (Object.entries(phaseScores) as [string, number][])
          .sort((a, b) => a[1] - b[1])
          .map(([k]) => k as SpikeAnalysis['priorityOrder'][number])
      }
    }

    return {
      scores: scores as unknown as CheckpointScores,
      checkpointFeedback: checkpointFeedback as SpikeAnalysis['checkpointFeedback'],
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
    }
  } catch {
    return null
  }
}

/** Run z-ai vision CLI with multiple image files */
function runVisionCli(imagePaths: string[], prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['vision', '-p', prompt]
    for (const imgPath of imagePaths) {
      args.push('-i', imgPath)
    }
    execFile('z-ai', args, { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error('[SpikeLab] CLI error:', stderr || error.message)
        reject(new Error(stderr || error.message))
        return
      }
      resolve(stdout)
    })
  })
}

/** Extract the actual LLM content string from CLI output */
function extractContentFromCliOutput(stdout: string): string {
  const jsonStart = stdout.indexOf('{"choices"')
  if (jsonStart >= 0) {
    try {
      const cliResponse = JSON.parse(stdout.substring(jsonStart))
      return cliResponse.choices?.[0]?.message?.content || ''
    } catch { /* fall through */ }
  }

  try {
    const cliResponse = JSON.parse(stdout.trim())
    return cliResponse.choices?.[0]?.message?.content || ''
  } catch { /* fall through */ }

  const match = stdout.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"\s*[,\}]/s)
  if (match) {
    return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }

  return ''
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

    tempDir = await mkdtemp(path.join(tmpdir(), 'spikelab-'))
    const ext = videoFile.name.split('.').pop() || 'mp4'
    const videoPath = path.join(tempDir, `spike_video.${ext}`)

    const bytes = await videoFile.arrayBuffer()
    await writeFile(videoPath, Buffer.from(bytes))

    const playerName = (formData.get('name') as string) || 'the player'
    const position = (formData.get('position') as string) || 'Outside Hitter'
    const experience = (formData.get('experience') as string) || 'Intermediate'

    console.log(`[SpikeLab] Analyzing video: ${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)}MB)`)

    // Extract 8 frames using motion detection
    const frameCount = 8
    const framePaths = await extractFrames(videoPath, tempDir, frameCount)
    console.log(`[SpikeLab] Extracted ${framePaths.length} frames from video`)

    const fullPrompt = `${ANALYSIS_PROMPT}\n\nAdditional context: This is ${playerName}, playing ${position} position, with ${experience} experience level. ${framePaths.length} frames were extracted from the video. Pay special attention to the torso/spine position during the airborne phase.`

    const stdout = await runVisionCli(framePaths, fullPrompt)
    console.log(`[SpikeLab] CLI output received (${stdout.length} chars)`)

    const rawContent = extractContentFromCliOutput(stdout)

    if (!rawContent) {
      console.error('[SpikeLab] Could not extract content from CLI. Output preview:', stdout.substring(0, 500))
      return NextResponse.json(
        { error: 'AI analysis returned no content. Please try a clearer or shorter video.' },
        { status: 500 }
      )
    }

    const analysis = parseAndValidate(rawContent)
    if (!analysis) {
      console.error('[SpikeLab] Parse failed. Content preview:', rawContent.substring(0, 500))
      return NextResponse.json(
        { error: 'Could not parse AI results. Please try again.' },
        { status: 500 }
      )
    }

    console.log(`[SpikeLab] Analysis complete. Overall: ${analysis.overallPower}, Level: ${analysis.estimatedLevel}, Priority: ${analysis.priorityOrder.join(' > ')}`)
    return NextResponse.json({ analysis })
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