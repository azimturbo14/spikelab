import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { writeFile, unlink, readdir, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import type { SpikeAnalysis, CheckpointScores } from '@/lib/spike-types'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const ANALYSIS_PROMPT = `You are an expert volleyball biomechanics analyst. The following are KEY FRAMES extracted from a video of a volleyball player performing a spike (approach, jump, hit, and landing). The frames are in chronological order.

Analyze these frames and for each of the 15 biomechanical checkpoints below, rate the player's execution on a scale of 0-100:
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
      "score": <average of the 5 approach scores>,
      "feedback": "<2-3 sentence specific feedback about what you see in the approach phase>"
    },
    "jump": {
      "score": <average of the 3 jump scores>,
      "feedback": "<2-3 sentence specific feedback about the jump and rotation phase>"
    },
    "contact": {
      "score": <average of the 5 contact scores>,
      "feedback": "<2-3 sentence specific feedback about arm swing and contact>"
    },
    "followThrough": {
      "score": <average of the 2 follow-through scores>,
      "feedback": "<2-3 sentence specific feedback about follow-through and landing>"
    }
  },
  "topStrengths": [
    "<checkpoint name>: <1 sentence explaining why it is good based on what you see>"
  ],
  "topWeaknesses": [
    "<checkpoint name>: <1-2 sentences explaining what is wrong and what to fix>"
  ],
  "coachNotes": "<3-5 sentences of specific coaching advice based on what you actually observe>",
  "estimatedLevel": "<one of: beginner|intermediate|advanced|elite>",
  "estimatedApproachSpeed": "<one of: slow|moderate|fast|explosive>",
  "overallPower": <0-100 number>
}

Be specific and reference what you actually see. If frames make certain checkpoints hard to judge, use your best judgment. Return ONLY the JSON.`

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
      'body_position_air', 'bow_and_arrow', 'arm_swing_speed', 'contact_point',
      'wrist_snap', 'contact_height', 'follow_through', 'landing_balance',
    ]

    const scores: Record<string, number> = {}
    for (const key of scoreKeys) {
      scores[key] = clampScore(data.scores?.[key])
    }

    const approachKeys = ['approach_speed', 'approach_angle', 'last_step_length', 'footwork_rhythm', 'arms_swing_back']
    const jumpKeys = ['vertical_jump_conversion', 'hip_shoulder_rotation', 'body_position_air']
    const contactKeys = ['bow_and_arrow', 'arm_swing_speed', 'contact_point', 'wrist_snap', 'contact_height']
    const followKeys = ['follow_through', 'landing_balance']
    const avg = (keys: string[]) => Math.round(keys.reduce((s, k) => s + scores[k], 0) / keys.length)

    return {
      scores: scores as unknown as CheckpointScores,
      phaseAnalysis: {
        approach: { score: data.phaseAnalysis?.approach?.score ?? avg(approachKeys), feedback: data.phaseAnalysis?.approach?.feedback ?? 'Approach phase analyzed.' },
        jump: { score: data.phaseAnalysis?.jump?.score ?? avg(jumpKeys), feedback: data.phaseAnalysis?.jump?.feedback ?? 'Jump phase analyzed.' },
        contact: { score: data.phaseAnalysis?.contact?.score ?? avg(contactKeys), feedback: data.phaseAnalysis?.contact?.feedback ?? 'Contact phase analyzed.' },
        followThrough: { score: data.phaseAnalysis?.followThrough?.score ?? avg(followKeys), feedback: data.phaseAnalysis?.followThrough?.feedback ?? 'Follow-through analyzed.' },
      },
      topStrengths: Array.isArray(data.topStrengths) ? data.topStrengths.slice(0, 5) : ['Solid effort visible in video.'],
      topWeaknesses: Array.isArray(data.topWeaknesses) ? data.topWeaknesses.slice(0, 5) : ['Multiple areas for improvement identified.'],
      coachNotes: data.coachNotes ?? 'Review your analysis results and focus on the weakest phase first.',
      estimatedLevel: ['beginner', 'intermediate', 'advanced', 'elite'].includes(data.estimatedLevel) ? data.estimatedLevel : 'intermediate',
      estimatedApproachSpeed: ['slow', 'moderate', 'fast', 'explosive'].includes(data.estimatedApproachSpeed) ? data.estimatedApproachSpeed : 'moderate',
      overallPower: clampScore(data.overallPower),
    }
  } catch {
    return null
  }
}

/** Run z-ai vision CLI with multiple image files */
function runVisionCli(imagePaths: string[], prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['vision', '-p', prompt, '--thinking']
    for (const imgPath of imagePaths) {
      args.push('-i', imgPath)
    }
    execFile('z-ai', args, { timeout: 110_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error('[SpikeLab] CLI error:', stderr || error.message)
        reject(new Error(stderr || error.message))
        return
      }
      resolve(stdout)
    })
  })
}

/** Extract the actual LLM content string from CLI output (strips emoji banners) */
function extractContentFromCliOutput(stdout: string): string {
  // The CLI outputs emoji banners before the JSON. Find the JSON start.
  const jsonStart = stdout.indexOf('{"choices"')
  if (jsonStart >= 0) {
    try {
      const cliResponse = JSON.parse(stdout.substring(jsonStart))
      return cliResponse.choices?.[0]?.message?.content || ''
    } catch {
      // Fall through
    }
  }

  // Fallback: try to parse entire output as JSON
  try {
    const cliResponse = JSON.parse(stdout.trim())
    return cliResponse.choices?.[0]?.message?.content || ''
  } catch {
    // Fall through
  }

  // Regex fallback: find "content" field
  const match = stdout.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"\s*[,\}]/s)
  if (match) {
    return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }

  return ''
}

/** Extract N frames from a video file at evenly spaced timestamps using ffmpeg */
function extractFrames(videoPath: string, outputDir: string, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    // First, get video duration with ffprobe
    execFile('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ], { timeout: 10_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(new Error('Could not read video. Please upload a valid video file.'))
        return
      }

      const duration = parseFloat(stdout.trim())
      if (!duration || duration <= 0 || !isFinite(duration)) {
        reject(new Error('Video has no valid duration.'))
        return
      }

      // Calculate timestamps (evenly spaced, skip first/last 10%)
      const startPct = 0.05
      const endPct = 0.95
      const interval = (endPct - startPct) / (count + 1)

      const framePaths: string[] = []
      for (let i = 0; i < count; i++) {
        const timestamp = (startPct + interval * (i + 1)) * duration
        const framePath = path.join(outputDir, `frame_${String(i).padStart(2, '0')}.jpg`)
        framePaths.push(framePath)
      }

      // Build ffmpeg command: extract each frame at specific timestamps
      // Use a filter to extract multiple frames in one pass
      const filterParts = framePaths.map((_, i) => {
        const ts = (startPct + interval * (i + 1)) * duration
        return `[0:v]select='eq(n\\,${Math.round(ts * 15)})'`
      })

      // Simpler approach: run ffmpeg multiple times, one per frame
      let completed = 0
      const extractedPaths: string[] = []

      framePaths.forEach((framePath, i) => {
        const ts = (startPct + interval * (i + 1)) * duration
        execFile('ffmpeg', [
          '-ss', ts.toString(),
          '-i', videoPath,
          '-frames:v', '1',
          '-q:v', '2',
          '-y',
          framePath,
        ], { timeout: 15_000 }, (err) => {
          if (err) {
            console.warn(`[SpikeLab] Failed to extract frame ${i} at ${ts.toFixed(2)}s`)
          } else {
            extractedPaths.push(framePath)
          }
          completed++
          if (completed === framePaths.length) {
            if (extractedPaths.length === 0) {
              reject(new Error('Failed to extract any frames from video.'))
            } else {
              resolve(extractedPaths)
            }
          }
        })
      })
    })
  })
}

export async function POST(request: NextRequest) {
  let tempDir = ''

  try {
    // Accept video as FormData (multipart upload — avoids JSON body size limits)
    const formData = await request.formData()
    const videoFile = formData.get('video') as File | null

    if (!videoFile) {
      return NextResponse.json({ error: 'No video file provided' }, { status: 400 })
    }

    // Validate file type
    if (!videoFile.type.startsWith('video/') && !videoFile.name.match(/\.(mp4|mov|avi|webm|mkv|flv)$/i)) {
      return NextResponse.json({ error: 'Invalid file type. Please upload a video (MP4, MOV, AVI, WebM).' }, { status: 400 })
    }

    // Validate file size (max 50MB)
    if (videoFile.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'Video file too large. Maximum 50MB.' }, { status: 400 })
    }

    // Save video to temp file
    tempDir = await mkdtemp(path.join(tmpdir(), 'spikelab-'))
    const ext = videoFile.name.split('.').pop() || 'mp4'
    const videoPath = path.join(tempDir, `spike_video.${ext}`)

    const bytes = await videoFile.arrayBuffer()
    await writeFile(videoPath, Buffer.from(bytes))

    // Get player info from form data
    const playerName = (formData.get('name') as string) || 'the player'
    const position = (formData.get('position') as string) || 'Outside Hitter'
    const experience = (formData.get('experience') as string) || 'Intermediate'

    console.log(`[SpikeLab] Analyzing video: ${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)}MB)`)

    // Extract key frames from video (server-side)
    const frameCount = 6
    const framePaths = await extractFrames(videoPath, tempDir, frameCount)
    console.log(`[SpikeLab] Extracted ${framePaths.length} frames from video`)

    const fullPrompt = `${ANALYSIS_PROMPT}\n\nAdditional context: This is ${playerName}, playing ${position} position, with ${experience} experience level. ${framePaths.length} frames were extracted from the video.`

    // Run VLM analysis via CLI with extracted image frames
    const stdout = await runVisionCli(framePaths, fullPrompt)
    console.log(`[SpikeLab] CLI output received (${stdout.length} chars)`)

    // Parse CLI output — strip CLI banner messages
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
        { error: 'Could not parse AI results. The AI response was not in the expected format. Please try again.' },
        { status: 500 }
      )
    }

    console.log(`[SpikeLab] Analysis complete. Overall: ${analysis.overallPower}, Level: ${analysis.estimatedLevel}`)
    return NextResponse.json({ analysis })
  } catch (err: unknown) {
    console.error('[SpikeLab] Error:', err)
    const message = err instanceof Error ? err.message : 'An unexpected error occurred'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    // Cleanup temp files
    if (tempDir) {
      try {
        const files = await readdir(tempDir).catch(() => [])
        for (const f of files) await unlink(path.join(tempDir, f)).catch(() => {})
        await unlink(tempDir).catch(() => {})
      } catch { /* ignore cleanup errors */ }
    }
  }
}