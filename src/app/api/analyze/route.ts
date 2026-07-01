import { NextRequest, NextResponse } from 'next/server'

// This endpoint supports the OLD cached frontend that calls /api/analyze
// with slider metrics, optional image, and video description.
// Returns comprehensive analysis data + coaching insight + training plan.
// NO external API calls — everything is algorithmic.

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

// ─── Pure algorithmic coaching insight generator ──

function generateInsight(
  playerName: string,
  overallScore: number,
  phaseAnalysis: { phase: string; label: string; score: number; status: string; feedback: string }[],
  weakMetrics: { key: string; score: number }[],
  strongMetrics: { key: string; score: number }[],
  profile: { position: string; experience: string }
): string {
  const weakest = phaseAnalysis[0]
  const strongest = phaseAnalysis[phaseAnalysis.length - 1]
  const weakestMetric = weakMetrics[0]?.key?.replace(/([A-Z])/g, ' $1').trim() || 'approach mechanics'
  const strongestMetric = strongMetrics[0]?.key?.replace(/([A-Z])/g, ' $1').trim() || 'contact height'

  const levelAdj = overallScore >= 76 ? 'strong' : overallScore >= 51 ? 'developing' : 'foundational'

  const positionTips: Record<string, string> = {
    'Outside Hitter': 'As an OH, your approach angle and arm swing speed directly affect your kill percentage.',
    'Opposite': 'As an opposite, focus on your ability to hit from different tempos and set locations.',
    'Middle Blocker': 'As a middle, your approach speed and jump timing are critical for quick sets.',
    'Setter': 'While setters focus on setting, your dump and spike mechanics still benefit from these drills.',
  }
  const posTip = positionTips[profile.position] || 'Your position-specific mechanics will benefit from targeted drills.'

  const parts: string[] = []

  parts.push(
    `${playerName}, your spike mechanics are at a ${levelAdj} level (${overallScore}/100).`
  )

  if (weakest?.score && weakest.score < 50) {
    parts.push(
      `Your biggest opportunity is ${weakest.label} (${weakest.score}/100) — specifically ${weakestMetric}. ` +
      `Even a 10-point improvement here will add noticeable power to your hitting.`
    )
  } else if (weakest?.score && weakest.score < 76) {
    parts.push(
      `${weakest.label} at ${weakest.score}/100 is your primary growth area, particularly ${weakestMetric}.`
    )
  }

  parts.push(
    `${strongestMetric} (${strongMetrics[0]?.score}/100) is your strength — build your approach around it. ${posTip}`
  )

  const phaseTips: Record<string, string> = {
    approach: 'Start each session with 3-step approach reps at 75% speed, focusing on the long-long-quick rhythm before adding full intensity.',
    jump: 'Add 3 sets of depth drops before your jump training to improve the stretch-shortening cycle and increase vertical conversion.',
    'arm-swing': 'Do 20 towel snap drills daily against a wall — this builds the fast-twitch wrist snap that generates topspin without extra effort.',
    'follow-through': 'Practice "stick landings" after every approach jump — hold your balance for 2 seconds to build landing stability and reduce injury risk.',
  }
  const tipKey = weakest?.phase || 'approach'
  parts.push(phaseTips[tipKey] || phaseTips.approach)

  return parts.join(' ')
}

// ─── Algorithmic training plan generator ──

function generateTrainingPlan(
  phaseAnalysis: { phase: string; label: string; score: number; status: string; feedback: string }[],
  weaknesses: string[],
  strengths: string[],
  profile: { name: string; position: string; experience: string }
) {
  const weakestPhase = phaseAnalysis[0]
  const secondWeakest = phaseAnalysis[1]
  const focusPhase = weakestPhase?.label || 'Approach'

  const drillLibrary: Record<string, { name: string; sets: number; reps: string; cue: string; duration: string; videoUrl: string }[]> = {
    'Approach': [
      { name: '3-Step Approach Repetitions', sets: 3, reps: '8 reps', cue: 'Focus on the rhythm: long, long, short-quick', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=B7vbjJ2wQQQ' },
      { name: 'Speed Ladder Footwork', sets: 3, reps: '30 seconds', cue: 'Stay on the balls of your feet, keep hips low', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=ve8sXE5Y8cY' },
      { name: 'Approach Angle Cone Drill', sets: 3, reps: '6 reps per side', cue: 'Approach at a 45-degree angle to the net', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=B7vbjJ2wQQQ' },
      { name: 'Last Two Steps Power', sets: 4, reps: '6 reps', cue: 'Plant foot flat, drive the other knee up explosively', duration: '12 min', videoUrl: 'https://www.youtube.com/watch?v=B7vbjJ2wQQQ' },
      { name: 'Approach Without Ball', sets: 3, reps: '10 reps', cue: 'Full speed approach, focus on arm swing timing', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=fatTHeVW5jU' },
      { name: 'Mirror Approach Drill', sets: 3, reps: '1 minute', cue: "Match your partner's approach rhythm exactly", duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=JSG4oRyKOBI' },
    ],
    'Jump & Rotation': [
      { name: 'Countermovement Jumps', sets: 3, reps: '10 reps', cue: 'Quick dip and explode upward, keep chest upright', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=x11nsx93zLM' },
      { name: 'Box Jumps', sets: 3, reps: '8 reps', cue: 'Soft landing, full extension at the top', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=x11nsx93zLM' },
      { name: 'Hip-Shoulder Separation Drill', sets: 3, reps: '8 reps', cue: 'Hips stay closed while shoulders begin to rotate', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=RIvrce6Z0kM' },
      { name: 'Depth Drops', sets: 3, reps: '6 reps', cue: 'Step off box, minimize ground contact, jump immediately', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=rv3Sq3u-UhU' },
      { name: 'Approach Jump to Target', sets: 4, reps: '6 reps', cue: 'Reach for a specific target at peak height', duration: '12 min', videoUrl: 'https://www.youtube.com/watch?v=x11nsx93zLM' },
      { name: 'Single Leg Bounds', sets: 3, reps: '6 reps per leg', cue: 'Maximize horizontal distance per bound', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=2FSxBQTqZ3I' },
    ],
    'Arm Swing & Contact': [
      { name: 'Bow-and-Arm Wall Drill', sets: 3, reps: '10 reps', cue: 'Load both arms back, then whip the hitting arm through', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=u-WhjYYocBs' },
      { name: 'Towel Snap Drill', sets: 3, reps: '12 reps', cue: 'Snap the towel at the highest point with full wrist flick', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=OBiDM2HsXvo' },
      { name: 'Contact Point Target Practice', sets: 4, reps: '8 reps', cue: 'Hit the ball at full arm extension, in front of shoulder', duration: '12 min', videoUrl: 'https://www.youtube.com/watch?v=R__1B2Gbsx8' },
      { name: 'Arm Swing Against Wall', sets: 3, reps: '10 reps', cue: 'Full range of motion, fast whip at the top', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=fatTHeVW5jU' },
      { name: 'Wrist Snap Tennis Ball', sets: 3, reps: '10 reps per hand', cue: 'Snap wrist downward to create topspin on the ball', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=Q04EFKDYAHs' },
      { name: 'Standing Spike Progression', sets: 3, reps: '8 reps', cue: 'Focus on high contact point and wrist snap', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=bWVWKnB04ho' },
    ],
    'Follow-Through & Landing': [
      { name: 'Controlled Landings', sets: 3, reps: '10 reps', cue: 'Land softly on balls of feet, bend knees to absorb', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=5g6ijVFSoeI' },
      { name: 'Stick Landing Hold', sets: 3, reps: '8 reps', cue: 'Freeze in athletic position for 2 seconds after landing', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=5g6ijVFSoeI' },
      { name: 'Follow-Through Finish', sets: 3, reps: '10 reps', cue: 'Arm continues across body, hand finishes at opposite hip', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=u-WhjYYocBs' },
      { name: 'Box Jump to Stick Landing', sets: 3, reps: '6 reps', cue: 'Jump off box, stick the landing with perfect balance', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=5g6ijVFSoeI' },
      { name: 'Single Leg Balance', sets: 3, reps: '30 seconds per leg', cue: 'Maintain stability after landing on one foot', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=7WgzHOQGgYw' },
      { name: 'Spike and Transition', sets: 3, reps: '6 reps', cue: 'Complete spike follow-through, then immediately transition to defense', duration: '12 min', videoUrl: 'https://www.youtube.com/watch?v=VQsaJXmCV0g' },
    ],
  }

  function getDrills(phaseLabel: string, count: number, weekNum: number, dayOffset: number) {
    const library = drillLibrary[phaseLabel] || drillLibrary['Approach']
    const startIdx = (weekNum - 1) * 2 + dayOffset
    const selected: typeof library = []
    for (let i = 0; selected.length < count; i++) {
      selected.push(library[(startIdx + i) % library.length])
    }
    return selected.map(d => ({
      name: d.name,
      sets: d.sets + (weekNum > 2 ? 1 : 0),
      reps: d.reps,
      cue: d.cue,
      duration: d.duration,
      videoUrl: d.videoUrl,
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

// ─── Main handler ──

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequest = await request.json()
    const { videoDescription, metrics, profile } = body

    if (!metrics || Object.keys(metrics).length === 0) {
      return NextResponse.json({ error: 'No metrics provided' }, { status: 400 })
    }

    const playerName = profile?.name || 'the player'
    const position = profile?.position || 'Outside Hitter'
    const experience = profile?.experience || 'Intermediate'

    // Build phase groups from metrics
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

    // Weakest and strongest metrics
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

    const insight = generateInsight(playerName, overallScore, phaseAnalysis, weakMetrics, strongMetrics, { position, experience })
    const plan = generateTrainingPlan(phaseAnalysis, topWeaknesses, topStrengths, {
      name: playerName,
      position,
      experience,
    })

    return NextResponse.json({
      insight: insight.trim(),
      overallScore,
      estimatedLevel: getEstimatedLevel(overallScore),
      estimatedApproachSpeed: getEstimatedApproachSpeed(phaseAnalysis.find(p => p.phase === 'approach')?.score || 50),
      scores: metrics,
      phaseAnalysis,
      topStrengths,
      topWeaknesses,
      coachNotes,
      plan,
      trainingPlan: plan,
    })
  } catch (err: unknown) {
    console.error('[SpikeLab] Analyze error:', err)
    const message = err instanceof Error ? err.message : 'An unexpected error occurred'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}