import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

// This endpoint supports the OLD cached frontend that calls /api/analyze
// with slider metrics, optional image, and video description.
// Returns an AI coach insight based on the metrics and optional media.

interface AnalyzeRequest {
  imageBase64?: string
  videoDescription?: string
  metrics: Record<string, number>
  profile: {
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

function getScoreLabel(score: number): string {
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

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequest = await request.json()
    const { imageBase64, videoDescription, metrics, profile } = body

    if (!metrics || Object.keys(metrics).length === 0) {
      return NextResponse.json({ error: 'No metrics provided' }, { status: 400 })
    }

    // Build a context from the metrics for the AI
    const phaseGroups: Record<string, { key: string; score: number }[]> = {}
    for (const [key, score] of Object.entries(metrics)) {
      // Determine phase from key naming convention
      let phase = 'approach'
      if (['verticalJumpConversion', 'hipShoulderRotation', 'bodyPositionAir'].includes(key)) phase = 'jump'
      else if (['bowAndArrow', 'armSwingSpeed', 'contactPoint', 'wristSnap', 'contactHeight'].includes(key)) phase = 'arm-swing'
      else if (['followThrough', 'landingBalance'].includes(key)) phase = 'follow-through'

      if (!phaseGroups[phase]) phaseGroups[phase] = []
      phaseGroups[phase].push({ key, score })
    }

    const allScores = Object.values(metrics)
    const overallAvg = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)

    // Find weakest and strongest phases
    const phaseScores = Object.entries(phaseGroups).map(([phase, items]) => ({
      phase,
      label: getPhaseLabel(phase),
      score: Math.round(items.reduce((a, b) => a + b.score, 0) / items.length),
    }))
    phaseScores.sort((a, b) => a.score - b.score)

    const weakest = phaseScores[0]
    const strongest = phaseScores[phaseScores.length - 1]

    const weakMetrics = allScores
      .map((s, i) => ({ key: Object.keys(metrics)[i], score: s }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)

    const strongMetrics = [...allScores]
      .map((s, i) => ({ key: Object.keys(metrics)[i], score: s }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    const playerName = profile?.name || 'the player'
    const position = profile?.position || 'Outside Hitter'

    // Build prompt for AI insight
    let prompt = `You are an elite volleyball coach analyzing a spike. Provide a concise, specific coaching insight (2-4 sentences max).

Player: ${playerName} | Position: ${position} | Overall score: ${overallAvg}/100

Phase scores:
${phaseScores.map(p => `- ${p.label}: ${p.score}/100 (${getScoreLabel(p.score)})`).join('\n')}

Weakest areas: ${weakMetrics.map(m => `${m.key} (${m.score})`).join(', ')}
Strongest areas: ${strongMetrics.map(m => `${m.key} (${m.score})`).join(', ')}

Key coaching priority: Fix ${weakest?.label || 'weakest phase'} (${weakest?.score}/100).`

    // If user uploaded an image, use VLM for visual analysis
    if (imageBase64 && imageBase64.startsWith('data:')) {
      prompt += `\n\nThe player also uploaded a photo. Analyze the visual mechanics and provide specific feedback on body position, arm swing, and contact point visible in the image.`
    }

    if (videoDescription && videoDescription.trim()) {
      prompt += `\n\nPlayer's self-description: "${videoDescription.trim()}"`
    }

    prompt += `\n\nRespond with ONLY the coaching insight text. No JSON, no markdown, no headers. Just 2-4 sentences of direct, actionable coaching.`

    let insight = ''

    // Try to use AI for the insight, fall back to generated text
    try {
      const zai = await ZAI.create()

      if (imageBase64 && imageBase64.startsWith('data:')) {
        // Use VLM for image analysis
        const { execSync } = await import('child_process')
        const fs = await import('fs')
        const path = await import('path')
        const os = await import('os')

        // Save image to temp file for CLI
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

          // Parse CLI output
          const jsonStart = result.indexOf('{"choices"')
          if (jsonStart >= 0) {
            const jsonStr = result.substring(jsonStart)
            const parsed = JSON.parse(jsonStr)
            insight = parsed.choices?.[0]?.message?.content || ''
          } else {
            // Fallback: use content after emoji banners
            const lines = result.split('\n').filter(l => !l.match(/^[\p{Emoji}\s]+$/u) && l.trim())
            insight = lines.join(' ').trim()
          }
        } finally {
          fs.unlinkSync(imgPath)
          fs.rmdirSync(tempDir)
        }
      } else {
        // Use LLM for text-only insight
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

    // Fallback insight if AI failed
    if (!insight.trim()) {
      const level = overallAvg >= 76 ? 'solid' : overallAvg >= 51 ? 'developing' : 'beginner'
      insight = `${playerName}, your ${weakest?.label || 'weakest area'} at ${weakest?.score}/100 is your biggest opportunity. ` +
        `Focus on ${weakMetrics[0]?.key?.replace(/([A-Z])/g, ' $1').trim() || 'your weakest mechanic'} first — ` +
        `even a 10-point improvement there will add noticeable power. ` +
        `Your ${strongest?.label || 'strongest phase'} is your ${level} foundation to build from.`
    }

    return NextResponse.json({ insight: insight.trim() })
  } catch (err: unknown) {
    console.error('[SpikeLab] Analyze error:', err)
    const message = err instanceof Error ? err.message : 'An unexpected error occurred'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}