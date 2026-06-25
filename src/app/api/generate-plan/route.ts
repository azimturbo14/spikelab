import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import type { SpikeAnalysis, TrainingPlan } from '@/lib/spike-types'

const PLAN_PROMPT = `You are an expert volleyball strength & conditioning coach. Based on the biomechanical analysis below, create a personalized 4-week training plan.

PLAN RULES:
- Week 1: Foundation & awareness — drills focused on the WEAKEST phase. Lower intensity, high focus on technique.
- Week 2: Build — increase intensity, add resistance. Continue weakest phase work, add secondary weaknesses.
- Week 3: Integrate — combine phases, work on timing. Speed and power emphasis.
- Week 4: Peak — game-like drills, maximal effort. Reinforce all corrections.

SCHEDULE: 4 training days per week (Monday, Wednesday, Friday, Saturday). Rest days (Tuesday, Thursday, Sunday).

Each day should have 3-4 drills. Each drill needs:
- name: specific drill name
- sets: number of sets
- reps: reps or duration (e.g., "8 reps" or "30 seconds")
- cue: one specific coaching cue for that drill
- duration: optional total drill duration

Return your plan as a JSON object with this EXACT structure (no markdown, no code fences, just raw JSON):
{
  "weeks": [
    {
      "week": 1,
      "title": "<Week 1 title>",
      "focus": "<One sentence about what this week focuses on>",
      "days": [
        {
          "day": "Monday",
          "phase": "<which spike phase this day targets>",
          "drills": [
            {
              "name": "<drill name>",
              "sets": 3,
              "reps": "8 reps",
              "cue": "<specific coaching cue>",
              "duration": "10 min"
            }
          ]
        }
      ]
    }
  ],
  "summary": "<3-4 sentence summary of the plan and what to expect>",
  "keyFocus": ["<area 1>", "<area 2>", "<area 3>"]
}

Make the drills SPECIFIC to the weaknesses identified. Use real volleyball training drill names where possible. Return ONLY the JSON.`

let zaiInstance: InstanceType<typeof ZAI> | null = null

async function getZAI() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create()
  }
  return zaiInstance
}

interface PlanRequest {
  analysis: SpikeAnalysis
  profile: { name: string; position: string; experience: string }
}

export async function POST(request: NextRequest) {
  try {
    const body: PlanRequest = await request.json()
    const { analysis, profile } = body

    if (!analysis?.scores || !analysis?.phaseAnalysis) {
      return NextResponse.json({ error: 'Invalid analysis data provided' }, { status: 400 })
    }

    // Build context for the LLM
    const scoresText = JSON.stringify(analysis.scores, null, 2)
    const phaseText = JSON.stringify(analysis.phaseAnalysis, null, 2)
    const playerName = profile?.name || 'the player'
    const position = profile?.position || 'Outside Hitter'
    const experience = profile?.experience || 'Intermediate'

    const fullPrompt = `${PLAN_PROMPT}

PLAYER CONTEXT:
- Name: ${playerName}
- Position: ${position}
- Experience: ${experience}
- Estimated Level: ${analysis.estimatedLevel}
- Estimated Approach Speed: ${analysis.estimatedApproachSpeed}

BIOMECHANICAL SCORES (0-100):
${scoresText}

PHASE ANALYSIS:
${phaseText}

TOP STRENGTHS:
${analysis.topStrengths.join('\n')}

TOP WEAKNESSES:
${analysis.topWeaknesses.join('\n')}

COACH NOTES:
${analysis.coachNotes}

Create a targeted 4-week plan. Prioritize the weakest phase(s) in Weeks 1-2, then integrate everything in Weeks 3-4.`

    const zai = await getZAI()
    const response = await zai.chat.completions.create({
      model: 'default',
      messages: [
        { role: 'user', content: fullPrompt },
      ],
      temperature: 0.7,
    })

    const rawContent = response.choices?.[0]?.message?.content
    if (!rawContent) {
      return NextResponse.json({ error: 'Failed to generate training plan. Please try again.' }, { status: 500 })
    }

    // Parse and validate
    let cleaned = rawContent.trim()
    const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim()
    }

    let plan: TrainingPlan
    try {
      plan = JSON.parse(cleaned)
    } catch {
      console.error('Failed to parse plan response:', rawContent.substring(0, 500))
      return NextResponse.json(
        { error: 'Failed to parse training plan. Please try again.' },
        { status: 500 }
      )
    }

    // Basic validation
    if (!Array.isArray(plan.weeks) || plan.weeks.length === 0) {
      return NextResponse.json({ error: 'Invalid training plan format.' }, { status: 500 })
    }

    return NextResponse.json({ plan })
  } catch (err: unknown) {
    console.error('Training plan error:', err)
    const message = err instanceof Error ? err.message : 'An unexpected error occurred'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}