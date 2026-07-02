import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { writeFile, unlink, readdir, mkdtemp } from 'fs/promises'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { extractFrames } from '@/lib/extract-frames'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

interface VlmFrame {
  index: number
  phase: string
  keypoints: Record<string, [number, number] | null>
  measurements: {
    groundY: number | null
    highestPointY: number | null
    torsoAngleDeg: number | null
    kneeAngleDeg: number | null
    armAngleDeg: number | null
  }
  imageBase64: string
}

const VIZ_PROMPT = `Analyze this volleyball spike frame. Return ONLY JSON with this structure:
{
  "phase": "<approach|jump|contact|followThrough>",
  "keypoints": {
    "left_shoulder": [x, y] or null,
    "right_shoulder": [x, y] or null,
    "left_hip": [x, y] or null,
    "right_hip": [x, y] or null,
    "left_knee": [x, y] or null,
    "right_knee": [x, y] or null,
    "left_ankle": [x, y] or null,
    "right_ankle": [x, y] or null,
    "left_wrist": [x, y] or null,
    "right_wrist": [x, y] or null,
    "left_elbow": [x, y] or null,
    "right_elbow": [x, y] or null
  },
  "measurements": {
    "groundY": <y coordinate of ground level or null>,
    "highestPointY": <y of highest body point or null>,
    "torsoAngleDeg": <angle or null>,
    "kneeAngleDeg": <angle or null>,
    "armAngleDeg": <angle or null>
  }
}
Use pixel coordinates. Y increases downward. Return ONLY the JSON, no markdown fences.`

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
  if (match) return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
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

    tempDir = await mkdtemp(path.join(tmpdir(), 'spikelab-viz-'))
    const ext = videoFile.name.split('.').pop() || 'mp4'
    const videoPath = path.join(tempDir, `spike_video.${ext}`)

    const bytes = await videoFile.arrayBuffer()
    await writeFile(videoPath, Buffer.from(bytes))

    console.log(`[SpikeLab-Visualize] Processing video: ${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)}MB)`)

    const frameCount = 8
    const framePaths = await extractFrames(videoPath, tempDir, frameCount, '[SpikeLab-Visualize]')
    console.log(`[SpikeLab-Visualize] Extracted ${framePaths.length} frames`)

    // Read all frames as base64 before cleanup
    const frameBase64Map = new Map<string, string>()
    for (const fp of framePaths) {
      try {
        const buf = readFileSync(fp)
        frameBase64Map.set(fp, buf.toString('base64'))
      } catch { /* skip */ }
    }

    // Analyze each frame with VLM
    const frames: VlmFrame[] = []
    for (let i = 0; i < framePaths.length; i++) {
      const fp = framePaths[i]
      const base64 = frameBase64Map.get(fp)
      if (!base64) continue

      try {
        const result = await new Promise<string>((resolve, reject) => {
          execFile('z-ai', ['vision', '-p', VIZ_PROMPT, '-i', fp], {
            timeout: 30_000, maxBuffer: 5 * 1024 * 1024,
          }, (error, stdout) => {
            if (error) { reject(new Error(error.message)); return }
            resolve(stdout)
          })
        })

        const content = extractContentFromCliOutput(result)
        if (!content) continue

        let cleaned = content.trim()
        const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
        if (fenceMatch) cleaned = fenceMatch[1].trim()

        const data = JSON.parse(cleaned)
        frames.push({
          index: i,
          phase: data.phase || 'contact',
          keypoints: data.keypoints || {},
          measurements: data.measurements || {},
          imageBase64: base64,
        })
      } catch (err) {
        console.warn(`[SpikeLab-Visualize] Frame ${i} analysis failed:`, err instanceof Error ? err.message : err)
      }
    }

    console.log(`[SpikeLab-Visualize] Returning ${frames.length} frames with keypoints`)
    return NextResponse.json({ frames })
  } catch (err: unknown) {
    console.error('[SpikeLab-Visualize] Error:', err)
    return NextResponse.json({ error: 'Visualization failed.' }, { status: 500 })
  } finally {
    if (tempDir) {
      try {
        const files = await readdir(tempDir).catch(() => [])
        for (const f of files) await unlink(path.join(tempDir, f)).catch(() => {})
        await unlink(tempDir).catch(() => {})
      } catch { /* ignore */ }
    }
  }
}