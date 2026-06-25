import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import type { SpikeAnalysis, CheckpointScores } from '@/lib/spike-types'

const ANALYSIS_PROMPT = `You are an expert volleyball biomechanics analyst. Analyze this video of a volleyball player performing a spike (approach, jump, hit, and landing).

For each of the following 15 biomechanical checkpoints, rate the player's execution on a scale of 0-100:
- 0-25: Critical (major flaw, significant power loss or injury risk)
- 26-50: Needs Work (noticeable issue affecting performance)
- 51-75: Decent (acceptable but room for improvement)
- 76-100: Excellent (elite or near-elite execution)

APPROACH PHASE (5 checkpoints):
1. approach_speed: How fast and explosive is the approach? Is the player building momentum effectively?
2. approach_angle: Is the approach angle optimal (roughly 45-60 degrees toward the net)?
3. last_step_length: Is the second-to-last (braking) step appropriately long to convert horizontal to vertical momentum?
4. footwork_rhythm: Is the slow-to-fast rhythm correct? (3-step or 4-step approach pattern)
5. arms_swing_back: Do both arms swing back during the plant to load elastic energy?

JUMP & ROTATION PHASE (3 checkpoints):
6. vertical_jump_conversion: How efficiently is horizontal momentum converted to vertical height?
7. hip_shoulder_rotation: Is there proper hip-shoulder separation (torque) before hitting?
8. body_position_air: Is the body in a good athletic position at peak height? (arched back, shoulder loaded back)

ARM SWING & CONTACT PHASE (5 checkpoints):
9. bow_and_arrow: Is the hitting arm in a proper bow-and-arrow loading position (elbow high and back, hand relaxed behind the head)?
10. arm_swing_speed: How fast and explosive is the arm whip through the hitting zone?
11. contact_point: Is contact made at full extension, slightly in front of the hitting shoulder?
12. wrist_snap: Is there a strong wrist snap over the ball to generate topspin?
13. contact_height: How high is the contact point relative to the net?

FOLLOW-THROUGH PHASE (2 checkpoints):
14. follow_through: Does the arm continue across the body to the opposite hip after contact?
15. landing_balance: Is the landing soft, on two feet, with knees bent?

Return your analysis as a JSON object with this EXACT structure (no markdown, no code fences, just raw JSON):
{
  "scores": {
    "approach_speed": <0-100 number>,
    "approach_angle": <0-100 number>,
    "last_step_length": <0-100 number>,
    "footwork_rhythm": <0-100 number>,
    "arms_swing_back": <0-100 number>,
    "vertical_jump_conversion": <0-100 number>,
    "hip_shoulder_rotation": <0-100 number>,
    "body_position_air": <0-100 number>,
    "bow_and_arrow": <0-100 number>,
    "arm_swing_speed": <0-100 number>,
    "contact_point": <0-100 number>,
    "wrist_snap": <0-100 number>,
    "contact_height": <0-100 number>,
    "follow_through": <0-100 number>,
    "landing_balance": <0-100 number>
  },
  "phaseAnalysis": {
    "approach": {
      "score": <average of approach_speed, approach_angle, last_step_length, footwork_rhythm, arms_swing_back>,
      "feedback": "<2-3 sentence specific feedback about what you see in the approach phase>"
    },
    "jump": {
      "score": <average of vertical_jump_conversion, hip_shoulder_rotation, body_position_air>,
      "feedback": "<2-3 sentence specific feedback about the jump and rotation phase>"
    },
    "contact": {
      "score": <average of bow_and_arrow, arm_swing_speed, contact_point, wrist_snap, contact_height>,
      "feedback": "<2-3 sentence specific feedback about arm swing and contact>"
    },
    "followThrough": {
      "score": <average of follow_through, landing_balance>,
      "feedback": "<2-3 sentence specific feedback about follow-through and landing>"
    }
  },
  "topStrengths": [
    "<checkpoint name>: <1 sentence explaining why it's good based on what you see>"
  ],
  "topWeaknesses": [
    "<checkpoint name>: <1-2 sentences explaining what's wrong and what to fix>"
  ],
  "coachNotes": "<3-5 sentences of specific coaching advice based on what you actually observe in the video>",
  "estimatedLevel": "<one of: beginner|intermediate|advanced|elite>",
  "estimatedApproachSpeed": "<one of: slow|moderate|fast|explosive>",
  "overallPower": <0-100 number>
}

Be specific and reference what you actually see in the video. If the video quality or angle makes certain checkpoints hard to judge, use your best judgment based on what is visible. Return ONLY the JSON.`

let zaiInstance: InstanceType<typeof ZAI> | null = null

async function getZAI() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create()
  }
  return zaiInstance
}

function clampScore(val: number): number {
  const n = typeof val === 'number' && !isNaN(val) ? val : 50
  return Math.round(Math.max(0, Math.min(100, n)))
}

function parseAndValidate(raw: string): SpikeAnalysis | null {
  // Strip markdown code fences if present
  let cleaned = raw.trim()
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim()
  }

  try {
    const data = JSON.parse(cleaned)

    // Validate scores
    const scoreKeys: (keyof CheckpointScores)[] = [
      'approach_speed', 'approach_angle', 'last_step_length', 'footwork_rhythm',
      'arms_swing_back', 'vertical_jump_conversion', 'hip_shoulder_rotation',
      'body_position_air', 'bow_and_arrow', 'arm_swing_speed', 'contact_point',
      'wrist_snap', 'contact_height', 'follow_through', 'landing_balance',
    ]

    const scores: Record<string, number> = {}
    for (const key of scoreKeys) {
      scores[key] = clampScore(data.scores?.[key])
    }

    // Calculate phase averages
    const approachKeys = ['approach_speed', 'approach_angle', 'last_step_length', 'footwork_rhythm', 'arms_swing_back']
    const jumpKeys = ['vertical_jump_conversion', 'hip_shoulder_rotation', 'body_position_air']
    const contactKeys = ['bow_and_arrow', 'arm_swing_speed', 'contact_point', 'wrist_snap', 'contact_height']
    const followKeys = ['follow_through', 'landing_balance']

    const avg = (keys: string[]) => Math.round(keys.reduce((sum, k) => sum + scores[k], 0) / keys.length)

    return {
      scores: scores as unknown as CheckpointScores,
      phaseAnalysis: {
        approach: {
          score: data.phaseAnalysis?.approach?.score ?? avg(approachKeys),
          feedback: data.phaseAnalysis?.approach?.feedback ?? 'Approach phase analyzed.',
        },
        jump: {
          score: data.phaseAnalysis?.jump?.score ?? avg(jumpKeys),
          feedback: data.phaseAnalysis?.jump?.feedback ?? 'Jump phase analyzed.',
        },
        contact: {
          score: data.phaseAnalysis?.contact?.score ?? avg(contactKeys),
          feedback: data.phaseAnalysis?.contact?.feedback ?? 'Contact phase analyzed.',
        },
        followThrough: {
          score: data.phaseAnalysis?.followThrough?.score ?? avg(followKeys),
          feedback: data.phaseAnalysis?.followThrough?.feedback ?? 'Follow-through analyzed.',
        },
      },
      topStrengths: Array.isArray(data.topStrengths) ? data.topStrengths.slice(0, 5) : ['Solid effort visible in video.'],
      topWeaknesses: Array.isArray(data.topWeaknesses) ? data.topWeaknesses.slice(0, 5) : ['Multiple areas for improvement identified.'],
      coachNotes: data.coachNotes ?? 'Review your analysis results and focus on the weakest phase first.',
      estimatedLevel: ['beginner', 'intermediate', 'advanced', 'elite'].includes(data.estimatedLevel)
        ? data.estimatedLevel : 'intermediate',
      estimatedApproachSpeed: ['slow', 'moderate', 'fast', 'explosive'].includes(data.estimatedApproachSpeed)
        ? data.estimatedApproachSpeed : 'moderate',
      overallPower: clampScore(data.overallPower),
    }
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const videoFile = formData.get('video') as File | null

    if (!videoFile) {
      return NextResponse.json({ error: 'No video file provided' }, { status: 400 })
    }

    // Validate file type
    const validTypes = ['video/mp4', 'video/quicktime', 'video/avi', 'video/x-msvideo', 'video/webm', 'video/x-matroska']
    if (!validTypes.includes(videoFile.type) && !videoFile.name.match(/\.(mp4|mov|avi|webm|mkv)$/i)) {
      return NextResponse.json({ error: 'Invalid video format. Please upload MP4, MOV, AVI, or WebM.' }, { status: 400 })
    }

    // Validate file size (50MB max)
    if (videoFile.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'Video file too large. Maximum size is 50MB.' }, { status: 400 })
    }

    // Convert to base64
    const bytes = await videoFile.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    const mimeType = videoFile.type || 'video/mp4'
    const videoDataUri = `data:${mimeType};base64,${base64}`

    // Get optional profile info for context
    const playerName = formData.get('name') as string || 'the player'
    const position = formData.get('position') as string || 'Outside Hitter'
    const experience = formData.get('experience') as string || 'Intermediate'

    const contextPrompt = `${ANALYSIS_PROMPT}\n\nAdditional context: This is ${playerName}, playing ${position} position, with ${experience} experience level.`

    // Call VLM with video
    const zai = await getZAI()
    const response = await zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: contextPrompt },
            { type: 'video_url', video_url: { url: videoDataUri } },
          ],
        },
      ],
      thinking: { type: 'enabled' },
    })

    const rawContent = response.choices?.[0]?.message?.content
    if (!rawContent) {
      return NextResponse.json({ error: 'AI analysis returned no content. Please try again with a clearer video.' }, { status: 500 })
    }

    // Parse and validate the response
    const analysis = parseAndValidate(rawContent)
    if (!analysis) {
      console.error('Failed to parse AI response:', rawContent.substring(0, 500))
      return NextResponse.json(
        { error: 'Failed to parse AI analysis results. The AI response was not in the expected format. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ analysis })
  } catch (err: unknown) {
    console.error('Spike analysis error:', err)
    const message = err instanceof Error ? err.message : 'An unexpected error occurred during analysis'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}