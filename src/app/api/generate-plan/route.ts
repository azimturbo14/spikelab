import { NextRequest, NextResponse } from 'next/server'
import type { SpikeAnalysis, TrainingPlan } from '@/lib/spike-types'

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

    const plan = generateTrainingPlan(analysis, profile)
    return NextResponse.json({ plan })
  } catch (err: unknown) {
    console.error('Training plan error:', err)
    const message = err instanceof Error ? err.message : 'An unexpected error occurred'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── Algorithmic training plan generator (no AI API needed) ──

const DRILL_LIBRARY: Record<string, { name: string; sets: number; reps: string; cue: string; duration: string; videoUrl: string; equipment: string; noEquipmentAlt: string }[]> = {
  'Approach': [
    { name: '3-Step Approach Repetitions', sets: 3, reps: '8 reps', cue: 'Focus on the rhythm: long, long, short-quick', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=B7vbjJ2wQQQ', equipment: 'None', noEquipmentAlt: '' },
    { name: 'Speed Ladder Footwork', sets: 3, reps: '30 seconds', cue: 'Stay on the balls of your feet, keep hips low', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=ve8sXE5Y8cY', equipment: 'Speed ladder', noEquipmentAlt: 'Use tape or chalk to draw ladder squares on any hard floor, or use floor tiles as markers. You can also place shoes or water bottles in two rows as makeshift ladder rungs.' },
    { name: 'Approach Angle Cone Drill', sets: 3, reps: '6 reps per side', cue: 'Approach at a 45-degree angle to the net', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=B7vbjJ2wQQQ', equipment: 'Cones + net/wall', noEquipmentAlt: 'Use water bottles, shoes, or rolled-up socks as cone markers. Approach toward any wall or imaginary net line.' },
    { name: 'Last Two Steps Power', sets: 4, reps: '6 reps', cue: 'Plant foot flat, drive the other knee up explosively', duration: '12 min', videoUrl: 'https://www.youtube.com/watch?v=B7vbjJ2wQQQ', equipment: 'None', noEquipmentAlt: '' },
    { name: 'Approach Without Ball', sets: 3, reps: '10 reps', cue: 'Full speed approach, focus on arm swing timing', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=fatTHeVW5jU', equipment: 'None', noEquipmentAlt: '' },
    { name: 'Mirror Approach Drill', sets: 3, reps: '1 minute', cue: "Match your partner's approach rhythm exactly", duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=JSG4oRyKOBI', equipment: 'Partner', noEquipmentAlt: 'Film yourself doing the approach, then replay it and try to match your own timing exactly. Alternatively, use a mirror or reflective window to watch yourself.' },
  ],
  'Jump & Rotation': [
    { name: 'Countermovement Jumps', sets: 3, reps: '10 reps', cue: 'Quick dip and explode upward, keep chest upright', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=x11nsx93zLM', equipment: 'None', noEquipmentAlt: '' },
    { name: 'Box Jumps', sets: 3, reps: '8 reps', cue: 'Soft landing, full extension at the top', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=x11nsx93zLM', equipment: 'Plyometric box', noEquipmentAlt: 'Use a sturdy park bench, bottom two stairs of a staircase (jump UP to the 3rd step), a thick yoga mat stacked 2-3 high, or a stable raised surface you can safely land on.' },
    { name: 'Hip-Shoulder Separation Drill', sets: 3, reps: '8 reps', cue: 'Hips stay closed while shoulders begin to rotate', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=RIvrce6Z0kM', equipment: 'None', noEquipmentAlt: '' },
    { name: 'Depth Drops', sets: 3, reps: '6 reps', cue: 'Step off box, minimize ground contact, jump immediately', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=rv3Sq3u-UhU', equipment: 'Box or step', noEquipmentAlt: 'Use the bottom stair of a staircase — step off backward onto the ground, then immediately jump up. Or stand on a low wall/bench (make sure it is stable) and drop off.' },
    { name: 'Approach Jump to Target', sets: 4, reps: '6 reps', cue: 'Reach for a specific target at peak height', duration: '12 min', videoUrl: 'https://www.youtube.com/watch?v=x11nsx93zLM', equipment: 'Target (ball/marker)', noEquipmentAlt: 'Stick a piece of tape on a wall at your maximum reach height + 6 inches. Or use a hanging tree branch, basketball rim, or doorframe as your target.' },
    { name: 'Single Leg Bounds', sets: 3, reps: '6 reps per leg', cue: 'Maximize horizontal distance per bound', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=2FSxBQTqZ3I', equipment: 'None', noEquipmentAlt: '' },
  ],
  'Arm Swing & Contact': [
    { name: 'Bow-and-Arm Wall Drill', sets: 3, reps: '10 reps', cue: 'Load both arms back, then whip the hitting arm through', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=u-WhjYYocBs', equipment: 'Wall', noEquipmentAlt: 'Any sturdy wall works — indoor, outdoor, garage. If no wall, do the motion in front of a mirror to check your form.' },
    { name: 'Towel Snap Drill', sets: 3, reps: '12 reps', cue: 'Snap the towel at the highest point with full wrist flick', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=OBiDM2HsXvo', equipment: 'Towel', noEquipmentAlt: 'Use a rolled-up t-shirt, long sock, or any piece of fabric. Even a small pillowcase works — the goal is feeling the "snap" at the top.' },
    { name: 'Contact Point Target Practice', sets: 4, reps: '8 reps', cue: 'Hit the ball at full arm extension, in front of shoulder', duration: '12 min', videoUrl: 'https://www.youtube.com/watch?v=R__1B2Gbsx8', equipment: 'Volleyball + wall/partner', noEquipmentAlt: 'Shadow swing without a ball — focus on reaching full extension at the same height every rep. Place tape on a wall at your contact height as a visual target.' },
    { name: 'Arm Swing Against Wall', sets: 3, reps: '10 reps', cue: 'Full range of motion, fast whip at the top', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=fatTHeVW5jU', equipment: 'Wall', noEquipmentAlt: 'Any wall works. Without a wall, do full arm swings in the air, focusing on the "whip" at the top and follow-through across your body.' },
    { name: 'Wrist Snap Tennis Ball', sets: 3, reps: '10 reps per hand', cue: 'Snap wrist downward to create topspin on the ball', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=Q04EFKDYAHs', equipment: 'Tennis ball', noEquipmentAlt: 'Use a rolled-up pair of socks, a small rubber ball, or even an orange. Anything you can snap over works — the focus is on the wrist motion, not the ball.' },
    { name: 'Standing Spike Progression', sets: 3, reps: '8 reps', cue: 'Focus on high contact point and wrist snap', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=bWVWKnB04ho', equipment: 'Volleyball', noEquipmentAlt: 'Do shadow spikes — full approach and arm swing without a ball. Focus purely on hitting mechanics: bow position, high contact, wrist snap, and follow-through.' },
  ],
  'Follow-Through & Landing': [
    { name: 'Controlled Landings', sets: 3, reps: '10 reps', cue: 'Land softly on balls of feet, bend knees to absorb', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=5g6ijVFSoeI', equipment: 'None', noEquipmentAlt: '' },
    { name: 'Stick Landing Hold', sets: 3, reps: '8 reps', cue: 'Freeze in athletic position for 2 seconds after landing', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=5g6ijVFSoeI', equipment: 'None', noEquipmentAlt: '' },
    { name: 'Follow-Through Finish', sets: 3, reps: '10 reps', cue: 'Arm continues across body, hand finishes at opposite hip', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=u-WhjYYocBs', equipment: 'None', noEquipmentAlt: '' },
    { name: 'Box Jump to Stick Landing', sets: 3, reps: '6 reps', cue: 'Jump off box, stick the landing with perfect balance', duration: '10 min', videoUrl: 'https://www.youtube.com/watch?v=5g6ijVFSoeI', equipment: 'Plyo box or step', noEquipmentAlt: 'Jump off the bottom stair of a staircase and stick the landing. Or stand on a low bench/stable surface, step off (do not jump off), and land softly.' },
    { name: 'Single Leg Balance', sets: 3, reps: '30 seconds per leg', cue: 'Maintain stability after landing on one foot', duration: '8 min', videoUrl: 'https://www.youtube.com/watch?v=7WgzHOQGgYw', equipment: 'None', noEquipmentAlt: '' },
    { name: 'Spike and Transition', sets: 3, reps: '6 reps', cue: 'Complete spike follow-through, then immediately transition to defense', duration: '12 min', videoUrl: 'https://www.youtube.com/watch?v=VQsaJXmCV0g', equipment: 'Net + ball', noEquipmentAlt: 'Do a full shadow spike approach (no ball), land, then immediately sprint 3 steps backward and drop into a defensive passing position. Repeat. Use an imaginary net line.' },
  ],
}

function getDrills(phaseLabel: string, count: number, weekNum: number, dayOffset: number) {
  const library = DRILL_LIBRARY[phaseLabel] || DRILL_LIBRARY['Approach']
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
    equipment: d.equipment,
    noEquipmentAlt: d.noEquipmentAlt,
  }))
}

function generateTrainingPlan(analysis: SpikeAnalysis, profile: { name: string; position: string; experience: string }): TrainingPlan {
  const { scores, phaseAnalysis, topWeaknesses, topStrengths, coachNotes } = analysis
  const playerName = profile?.name || 'the player'

  // Sort phases by score to find weakest first
  const phaseEntries = [
    { key: 'approach' as const, label: 'Approach', score: phaseAnalysis.approach.score },
    { key: 'jump' as const, label: 'Jump & Rotation', score: phaseAnalysis.jump.score },
    { key: 'contact' as const, label: 'Arm Swing & Contact', score: phaseAnalysis.contact.score },
    { key: 'followThrough' as const, label: 'Follow-Through & Landing', score: phaseAnalysis.followThrough.score },
  ].sort((a, b) => a.score - b.score)

  const weakest = phaseEntries[0]
  const secondWeakest = phaseEntries[1]
  const strongest = phaseEntries[phaseEntries.length - 1]
  const focusPhase = weakest?.label || 'Approach'

  // Find the specific weakest checkpoint for targeted feedback
  const sortedScores = Object.entries(scores).sort(([, a], [, b]) => a - b)
  const weakestCheckpoint = sortedScores[0]?.[0]?.replace(/_/g, ' ') || 'approach mechanics'
  const strongestCheckpoint = sortedScores[sortedScores.length - 1]?.[0]?.replace(/_/g, ' ') || 'contact height'

  const schedule = ['Monday', 'Wednesday', 'Friday', 'Saturday']

  // Get specific weakness-based coaching notes
  const weaknessNotes = topWeaknesses.length > 0
    ? topWeaknesses[0]
    : `${weakestCheckpoint} is your biggest area for improvement.`

  const strengthNotes = topStrengths.length > 0
    ? topStrengths[0]
    : `${strongestCheckpoint} is a strength to build from.`

  return {
    weeks: [
      {
        week: 1,
        title: `Foundation & ${focusPhase} Awareness`,
        focus: `Establish proper ${focusPhase.toLowerCase()} mechanics for ${playerName}. This week focuses on your weakest area (${focusPhase}, score ${weakest?.score || 0}/100) with lower intensity and high attention to technique. ${weaknessNotes}`,
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
        focus: `Increase intensity on ${focusPhase.toLowerCase()} work while addressing ${secondWeakest?.label?.toLowerCase() || 'secondary weaknesses'}. ${strengthNotes} Add resistance where appropriate.`,
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
        focus: 'Combine all phases into full spike sequences. Emphasize speed of movement, timing, and connecting the kinetic chain from approach through follow-through.',
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
        focus: 'Game-like drills with maximal effort. Reinforce all corrections and build confidence under match conditions. Your ${focusPhase.toLowerCase()} should feel more natural now.',
        days: [
          { day: schedule[0], phase: 'Approach', drills: getDrills('Approach', 4, 4, 0) },
          { day: schedule[1], phase: 'Arm Swing & Contact', drills: getDrills('Arm Swing & Contact', 4, 4, 2) },
          { day: schedule[2], phase: 'Jump & Rotation', drills: getDrills('Jump & Rotation', 3, 4, 0) },
          { day: schedule[3], phase: focusPhase, drills: getDrills(focusPhase, 4, 4, 1) },
        ],
      },
    ],
    summary: `This 4-week plan prioritizes ${playerName}'s ${focusPhase} (${weakest?.score || 0}/100) as the primary area for improvement. ${weaknessNotes} ${strengthNotes} Weeks 1-2 build foundational mechanics with progressive intensity, while Weeks 3-4 integrate all phases into game-like scenarios. ${coachNotes}`,
    keyFocus: [
      focusPhase,
      secondWeakest?.label || 'Arm Swing & Contact',
      'Injury prevention',
    ],
  }
}