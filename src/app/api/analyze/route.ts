import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

// This endpoint supports the OLD cached frontend that calls /api/analyze
// with slider metrics, optional image, and video description.
// Returns comprehensive analysis data + AI coach insight + training plan
// to be compatible with any response format the cached frontend expects.

interface AnalyzeRequest {
  imageBase64?: string
  videoDescription?: string
  metrics: Record<string, number>
  profile?: {
    name?: string
    position?: string
    experience?: string
    age?: number
    gender?: string
    bodyHeight?: number
    standingReach?: number
    approachJump?: number
    weight?: number
  }
}

function getScoreStatus(score: number): string {
  if (score >= 76) return 'good'
  if (score >= 51) return 'needs-work'
  return 'critical'
}

function getPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    approach: 'Approach',
    jump: 'Jump & Rotation',
    'arm-swing': 'Arm Swing & Contact',
    'follow-through': 'Follow-Through & Landing',
  }
  return labels[phase] || phase
}

function getEstimatedLevel(avg: number): string {
  if (avg >= 80) return 'advanced'
  if (avg >= 60) return 'intermediate'
  if (avg >= 40) return 'beginner'
  return 'novice'
}

function getEstimatedApproachSpeed(approachScore: number): string {
  if (approachScore >= 75) return 'fast'
  if (approachScore >= 50) return 'moderate'
  return 'slow'
}

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequest = await request.json()
    const { imageBase64, videoDescription, metrics, profile } = body

    if (!metrics || Object.keys(metrics).length === 0) {
      return NextResponse.json({ error: 'No metrics provided' }, { status: 400 })
    }

    const playerName = profile?.name || 'the player'
    const position = profile?.position || 'Outside Hitter'
    const experience = profile?.experience || 'Intermediate'

    // ─── Build phase groups from metrics ────────────────────
    const phaseGroups: Record<string, { key: string; score: number }[]> = {}
    for (const [key, score] of Object.entries(metrics)) {
      let phase = 'approach'
      if (['verticalJumpConversion', 'hipShoulderRotation', 'bodyPositionAir'].includes(key)) phase = 'jump'
      else if (['bowAndArrow', 'armSwingSpeed', 'contactPoint', 'wristSnap', 'contactHeight'].includes(key)) phase = 'arm-swing'
      else if (['followThrough', 'landingBalance'].includes(key)) phase = 'follow-through'

      if (!phaseGroups[phase]) phaseGroups[phase] = []
      phaseGroups[phase].push({ key, score })
    }

    const allScores = Object.values(metrics)
    const overallScore = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)

    // Phase analysis
    const phaseAnalysis = Object.entries(phaseGroups).map(([phase, items]) => {
      const score = Math.round(items.reduce((a, b) => a + b.score, 0) / items.length)
      const label = getPhaseLabel(phase)
      const status = getScoreStatus(score)

      let feedback = ''
      if (phase === 'approach') {
        if (score >= 76) feedback = 'Strong approach with good speed and footwork rhythm.'
        else if (score >= 51) feedback = 'Approach is developing but needs more consistency in the final steps.'
        else feedback = 'Approach mechanics need significant work — focus on footwork pattern and rhythm.'
      } else if (phase === 'jump') {
        if (score >= 76) feedback = 'Excellent vertical conversion and body positioning in the air.'
        else if (score >= 51) feedback = 'Jump mechanics are adequate but hip-shoulder separation could improve power.'
        else feedback = 'Vertical jump conversion is below average. Focus on converting horizontal to vertical force.'
      } else if (phase === 'arm-swing') {
        if (score >= 76) feedback = 'Strong arm swing mechanics with good contact point and wrist snap.'
        else if (score >= 51) feedback = 'Arm swing is decent but wrist snap and contact point need refinement.'
        else feedback = 'Arm swing mechanics need work. Focus on bow-and-arrow loading and contact point.'
      } else {
        if (score >= 76) feedback = 'Good follow-through and controlled landing mechanics.'
        else if (score >= 51) feedback = 'Follow-through could be more complete. Landing balance needs attention.'
        else feedback = 'Follow-through is cut short and landing balance is poor, risking injury.'
      }

      return { phase, label, score, status, feedback }
    })
    phaseAnalysis.sort((a, b) => a.score - b.score)

    // Weakest and strongest
    const weakMetrics = [...allScores]
      .map((s, i) => ({ key: Object.keys(metrics)[i], score: s }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)

    const strongMetrics = [...allScores]
      .map((s, i) => ({ key: Object.keys(metrics)[i], score: s }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    const topStrengths = strongMetrics.map(m =>
      `Solid ${m.key.replace(/([A-Z])/g, ' $1').trim()} (${m.score}/100)`
    )
    const topWeaknesses = weakMetrics.map(m =>
      `Weak ${m.key.replace(/([A-Z])/g, ' $1').trim()} (${m.score}/100)`
    )

    const weakest = phaseAnalysis[0]
    const coachNotes = `Overall score: ${overallScore}/100. Priority: improve ${weakest?.label || 'weakest phase'} (${weakest?.score}/100). ${topStrengths[0]} is a strength to build from.`

    // ─── Generate AI Insight ───────────────────────────────
    let prompt = `You are an elite volleyball coach analyzing a spike. Provide a concise, specific coaching insight (2-4 sentences max).

Player: ${playerName} | Position: ${position} | Overall score: ${overallScore}/100

Phase scores:
${phaseAnalysis.map(p => `- ${p.label}: ${p.score}/100 (${p.status})`).join('\n')}

Weakest areas: ${weakMetrics.map(m => `${m.key} (${m.score})`).join(', ')}
Strongest areas: ${strongMetrics.map(m => `${m.key} (${m.score})`).join(', ')}

Key coaching priority: Fix ${weakest?.label || 'weakest phase'} (${weakest?.score}/100).`

    if (imageBase64 && imageBase64.startsWith('data:')) {
      prompt += `\n\nThe player also uploaded a photo. Analyze the visual mechanics and provide specific feedback on body position, arm swing, and contact point visible in the image.`
    }
    if (videoDescription && videoDescription.trim()) {
      prompt += `\n\nPlayer's self-description: "${videoDescription.trim()}"`
    }
    prompt += `\n\nRespond with ONLY the coaching insight text. No JSON, no markdown, no headers. Just 2-4 sentences of direct, actionable coaching.`

    let insight = ''

    try {
      const zai = await ZAI.create()

      if (imageBase64 && imageBase64.startsWith('data:')) {
        const { execSync } = await import('child_process')
        const fs = await import('fs')
        const path = await import('path')
        const os = await import('os')

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spikelab-'))
        const ext = imageBase64.includes('image/png') ? 'png' : 'jpg'
        const imgPath = path.join(tempDir, `upload.${ext}`)
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '')
        fs.writeFileSync(imgPath, Buffer.from(base64Data, 'base64'))

        try {
          const result = execSync(
            `z-ai vision -i "${imgPath}" -p "${prompt.replace(/"/g, '\\"')}" 2>/dev/null`,
            { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }
          ).toString()

          const jsonStart = result.indexOf('{"choices"')
          if (jsonStart >= 0) {
            const jsonStr = result.substring(jsonStart)
            const parsed = JSON.parse(jsonStr)
            insight = parsed.choices?.[0]?.message?.content || ''
          } else {
            const lines = result.split('\n').filter(l => !l.match(/^[\p{Emoji}\s]+$/u) && l.trim())
            insight = lines.join(' ').trim()
          }
        } finally {
          fs.unlinkSync(imgPath)
          fs.rmdirSync(tempDir)
        }
      } else {
        const response = await zai.chat.completions.create({
          model: 'glm-4',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 300,
        })
        insight = response.choices?.[0]?.message?.content || ''
      }
    } catch (aiErr) {
      console.error('[SpikeLab] AI insight error:', aiErr)
    }

    if (!insight.trim()) {
      const level = overallScore >= 76 ? 'solid' : overallScore >= 51 ? 'developing' : 'beginner'
      insight = `${playerName}, your ${weakest?.label || 'weakest area'} at ${weakest?.score}/100 is your biggest opportunity. ` +
        `Focus on ${weakMetrics[0]?.key?.replace(/([A-Z])/g, ' $1').trim() || 'your weakest mechanic'} first — ` +
        `even a 10-point improvement there will add noticeable power. ` +
        `Your ${phaseAnalysis[phaseAnalysis.length - 1]?.label || 'strongest phase'} is your ${level} foundation to build from.`
    }

    // ─── Generate Training Plan ─────────────────────────────
    const plan = generateTrainingPlan(phaseAnalysis, topWeaknesses, topStrengths, {
      name: playerName,
      position,
      experience,
    })

    // ─── Return comprehensive response ──────────────────────
    // Return ALL possible fields to be compatible with any frontend format
    return NextResponse.json({
      // Core fields the old frontend definitely uses
      insight: insight.trim(),

      // Full analysis data (in case old frontend expects this)
      overallScore,
      estimatedLevel: getEstimatedLevel(overallScore),
      estimatedApproachSpeed: getEstimatedApproachSpeed(phaseAnalysis.find(p => p.phase === 'approach')?.score || 50),
      scores: metrics,
      phaseAnalysis,
      topStrengths,
      topWeaknesses,
      coachNotes,

      // Training plan (in case old frontend expects this from the API)
      plan,
      trainingPlan: plan,
    })
  } catch (err: unknown) {
    console.error('[SpikeLab] Analyze error:', err)
    const message = err instanceof Error ? err.message : 'An unexpected error occurred'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── Client-side training plan generation (no LLM needed) ──
// This provides instant plan generation without waiting for AI.
// The plan is generated algorithmically based on the phase scores.

function generateTrainingPlan(
  phaseAnalysis: { phase: string; label: string; score: number; status: string; feedback: string }[],
  weaknesses: string[],
  strengths: string[],
  profile: { name: string; position: string; experience: string }
) {
  const weakestPhase = phaseAnalysis[0]
  const secondWeakest = phaseAnalysis[1]
  const focusPhase = weakestPhase?.label || 'Approach'

  const drillLibrary: Record<string, { name: string; sets: number; reps: string; cue: string; duration: string }[]> = {
    'Approach': [
      { name: '3-Step Approach Repetitions', sets: 3, reps: '8 reps', cue: 'Focus on the rhythm: long, long, short-quick', duration: '10 min' },
      { name: 'Speed Ladder Footwork', sets: 3, reps: '30 seconds', cue: 'Stay on the balls of your feet, keep hips low', duration: '8 min' },
      { name: 'Approach Angle Cone Drill', sets: 3, reps: '6 reps per side', cue: 'Approach at a 45-degree angle to the net', duration: '10 min' },
      { name: 'Last Two Steps Power', sets: 4, reps: '6 reps', cue: 'Plant foot flat, drive the other knee up explosively', duration: '12 min' },
      { name: 'Approach Without Ball', sets: 3, reps: '10 reps', cue: 'Full speed approach, focus on arm swing timing', duration: '10 min' },
      { name: 'Mirror Approach Drill', sets: 3, reps: '1 minute', cue: 'Match your partner\'s approach rhythm exactly', duration: '8 min' },
    ],
    'Jump & Rotation': [
      { name: 'Countermovement Jumps', sets: 3, reps: '10 reps', cue: 'Quick dip and explode upward, keep chest upright', duration: '10 min' },
      { name: 'Box Jumps', sets: 3, reps: '8 reps', cue: 'Soft landing, full extension at the top', duration: '10 min' },
      { name: 'Hip-Shoulder Separation Drill', sets: 3, reps: '8 reps', cue: 'Hips stay closed while shoulders begin to rotate', duration: '8 min' },
      { name: 'Depth Drops', sets: 3, reps: '6 reps', cue: 'Step off box, minimize ground contact, jump immediately', duration: '10 min' },
      { name: 'Approach Jump to Target', sets: 4, reps: '6 reps', cue: 'Reach for a specific target at peak height', duration: '12 min' },
      { name: 'Single Leg Bounds', sets: 3, reps: '6 reps per leg', cue: 'Maximize horizontal distance per bound', duration: '8 min' },
    ],
    'Arm Swing & Contact': [
      { name: 'Bow-and-Arm Wall Drill', sets: 3, reps: '10 reps', cue: 'Load both arms back, then whip the hitting arm through', duration: '8 min' },
      { name: 'Towel Snap Drill', sets: 3, reps: '12 reps', cue: 'Snap the towel at the highest point with full wrist flick', duration: '8 min' },
      { name: 'Contact Point Target Practice', sets: 4, reps: '8 reps', cue: 'Hit the ball at full arm extension, in front of shoulder', duration: '12 min' },
      { name: 'Arm Swing Against Wall', sets: 3, reps: '10 reps', cue: 'Full range of motion, fast whip at the top', duration: '8 min' },
      { name: 'Wrist Snap Tennis Ball', sets: 3, reps: '10 reps per hand', cue: 'Snap wrist downward to create topspin on the ball', duration: '10 min' },
      { name: 'Standing Spike Progression', sets: 3, reps: '8 reps', cue: 'Focus on high contact point and wrist snap', duration: '10 min' },
    ],
    'Follow-Through & Landing': [
      { name: 'Controlled Landings', sets: 3, reps: '10 reps', cue: 'Land softly on balls of feet, bend knees to absorb', duration: '10 min' },
      { name: 'Stick Landing Hold', sets: 3, reps: '8 reps', cue: 'Freeze in athletic position for 2 seconds after landing', duration: '8 min' },
      { name: 'Follow-Through Finish', sets: 3, reps: '10 reps', cue: 'Arm continues across body, hand finishes at opposite hip', duration: '8 min' },
      { name: 'Box Jump to Stick Landing', sets: 3, reps: '6 reps', cue: 'Jump off box, stick the landing with perfect balance', duration: '10 min' },
      { name: 'Single Leg Balance', sets: 3, reps: '30 seconds per leg', cue: 'Maintain stability after landing on one foot', duration: '8 min' },
      { name: 'Spike and Transition', sets: 3, reps: '6 reps', cue: 'Complete spike follow-through, then immediately transition to defense', duration: '12 min' },
    ],
  }

  function getDrills(phaseLabel: string, count: number, weekNum: number, dayOffset: number) {
    const library = drillLibrary[phaseLabel] || drillLibrary['Approach']
    // Vary drills by week and day to avoid repetition
    const startIdx = (weekNum - 1) * 2 + dayOffset
    const selected: typeof library = []
    for (let i = 0; selected.length < count; i++) {
      selected.push(library[(startIdx + i) % library.length])
    }
    return selected.map(d => ({
      name: d.name,
      sets: d.sets + (weekNum > 2 ? 1 : 0), // Add a set in weeks 3-4
      reps: d.reps,
      cue: d.cue,
      duration: d.duration,
    }))
  }

  const schedule = ['Monday', 'Wednesday', 'Friday', 'Saturday']

  return {
    weeks: [
      {
        week: 1,
        title: `Foundation & ${focusPhase} Awareness`,
        focus: `Establish proper mechanics in your weakest area (${focusPhase}) with lower intensity and high focus on technique.`,
        days: [
          { day: schedule[0], phase: focusPhase, drills: getDrills(focusPhase, 3, 1, 0) },
          { day: schedule[1], phase: focusPhase, drills: getDrills(focusPhase, 3, 1, 3) },
          { day: schedule[2], phase: secondWeakest?.label || focusPhase, drills: getDrills(secondWeakest?.label || focusPhase, 3, 1, 0) },
          { day: schedule[3], phase: focusPhase, drills: getDrills(focusPhase, 3, 1, 1) },
        ],
      },
      {
        week: 2,
        title: 'Build Intensity & Secondary Corrections',
        focus: `Increase intensity on ${focusPhase} work while beginning to address ${secondWeakest?.label || 'secondary weaknesses'}. Add resistance where appropriate.`,
        days: [
          { day: schedule[0], phase: focusPhase, drills: getDrills(focusPhase, 3, 2, 0) },
          { day: schedule[1], phase: secondWeakest?.label || focusPhase, drills: getDrills(secondWeakest?.label || focusPhase, 3, 2, 0) },
          { day: schedule[2], phase: focusPhase, drills: getDrills(focusPhase, 4, 2, 2) },
          { day: schedule[3], phase: 'Approach', drills: getDrills('Approach', 3, 2, 0) },
        ],
      },
      {
        week: 3,
        title: 'Integration & Speed',
        focus: 'Combine all phases into full spike sequences. Emphasize speed, timing, and connecting the kinetic chain.',
        days: [
          { day: schedule[0], phase: 'Jump & Rotation', drills: getDrills('Jump & Rotation', 3, 3, 0) },
          { day: schedule[1], phase: 'Arm Swing & Contact', drills: getDrills('Arm Swing & Contact', 3, 3, 0) },
          { day: schedule[2], phase: focusPhase, drills: getDrills(focusPhase, 4, 3, 2) },
          { day: schedule[3], phase: 'Follow-Through & Landing', drills: getDrills('Follow-Through & Landing', 3, 3, 0) },
        ],
      },
      {
        week: 4,
        title: 'Peak Performance & Game Simulations',
        focus: 'Game-like drills with maximal effort. Reinforce all corrections and build confidence under match conditions.',
        days: [
          { day: schedule[0], phase: 'Approach', drills: getDrills('Approach', 4, 4, 0) },
          { day: schedule[1], phase: 'Arm Swing & Contact', drills: getDrills('Arm Swing & Contact', 4, 4, 2) },
          { day: schedule[2], phase: 'Jump & Rotation', drills: getDrills('Jump & Rotation', 3, 4, 0) },
          { day: schedule[3], phase: focusPhase, drills: getDrills(focusPhase, 4, 4, 1) },
        ],
      },
    ],
    summary: `This 4-week plan prioritizes your ${focusPhase} (${weakestPhase?.score || 0}/100) as the primary area for improvement. Weeks 1-2 build foundational mechanics with progressive intensity, while Weeks 3-4 integrate all phases into game-like scenarios. Consistency is key — even 3 sessions per week will show measurable improvement.`,
    keyFocus: [
      focusPhase,
      secondWeakest?.label || 'Arm Swing & Contact',
      'Injury prevention',
    ],
  }
}