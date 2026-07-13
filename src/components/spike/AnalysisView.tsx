'use client'

import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { useState, useMemo, useEffect } from 'react'
import {
  CheckCircle2, AlertTriangle, ArrowRight, Activity,
  Footprints, Dumbbell, ShieldCheck, Flame, Target,
  Info, Clock, Eye, EyeOff, ChevronLeft, ChevronRight,
  Film
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip, TooltipContent, TooltipTrigger
} from '@/components/ui/tooltip'
import {
  type SpikeAnalysis,
  CHECKPOINT_LABELS,
  getScoreColor,
  getConfidenceLabel,
} from '@/lib/spike-types'
import { useI18n } from '@/lib/i18n-store'

/* ─── Compact Inline Frame Navigator ────────────────────────── */
function InlineFrameNav({
  frames,
  frameIndices,
  frameTimestamps,
  label,
}: {
  frames: string[]
  frameIndices: number[]
  frameTimestamps?: number[]
  label: string
}) {
  const [currentIdx, setCurrentIdx] = useState(0)

  const relevantFrames = useMemo(() => {
    if (!frames || frames.length === 0) return []
    return frameIndices
      .filter(i => i >= 0 && i < frames.length)
      .map(i => ({
        src: frames[i],
        index: i,
        timestamp: frameTimestamps?.[i] ?? null,
      }))
  }, [frames, frameIndices, frameTimestamps])

  if (relevantFrames.length === 0) return null

  const canPrev = currentIdx > 0
  const canNext = currentIdx < relevantFrames.length - 1
  const currentFrame = relevantFrames[currentIdx]

  return (
    <div className="mt-2 rounded-lg border bg-muted/20 overflow-hidden">
      {/* Frame image */}
      <div className="relative">
        <div className="aspect-video bg-black/5 flex items-center justify-center max-h-48">
          {currentFrame && (
            <img
              src={currentFrame.src}
              alt={`Frame ${currentFrame.index + 1}`}
              className="max-w-full max-h-full object-contain"
              loading="lazy"
            />
          )}
        </div>
        {/* Navigation arrows */}
        {relevantFrames.length > 1 && (
          <>
            <button
              onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
              disabled={!canPrev}
              className={`absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-background/90 backdrop-blur-sm border shadow-sm flex items-center justify-center transition-all ${
                canPrev ? 'opacity-100 hover:scale-110 hover:bg-background' : 'opacity-20 cursor-not-allowed'
              }`}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setCurrentIdx(i => Math.min(relevantFrames.length - 1, i + 1))}
              disabled={!canNext}
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-background/90 backdrop-blur-sm border shadow-sm flex items-center justify-center transition-all ${
                canNext ? 'opacity-100 hover:scale-110 hover:bg-background' : 'opacity-20 cursor-not-allowed'
              }`}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        {/* Timestamp overlay */}
        {currentFrame?.timestamp !== null && (
          <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px] font-mono">
            {(currentFrame.timestamp ?? 0).toFixed(2)}s
          </div>
        )}
      </div>
      {/* Bottom bar: label + counter + dots */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-muted/30 border-t">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Film className="w-3 h-3" />
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {relevantFrames.length > 1 && (
            <div className="flex gap-0.5">
              {relevantFrames.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentIdx(i)}
                  className={`rounded-full transition-all ${
                    i === currentIdx ? 'bg-primary w-3.5 h-1.5' : 'bg-muted-foreground/25 w-1.5 h-1.5 hover:bg-muted-foreground/40'
                  }`}
                />
              ))}
            </div>
          )}
          <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
            {currentIdx + 1}/{relevantFrames.length}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ─── Full Frame Carousel (for phase galleries) ────────────── */
function FrameCarousel({
  frames,
  frameIndices,
  frameTimestamps,
  label,
}: {
  frames: string[]
  frameIndices: number[]
  frameTimestamps?: number[]
  label: string
}) {
  const [currentIdx, setCurrentIdx] = useState(0)

  const relevantFrames = useMemo(() => {
    if (!frames || frames.length === 0) return []
    return frameIndices
      .filter(i => i >= 0 && i < frames.length)
      .map(i => ({
        src: frames[i],
        index: i,
        timestamp: frameTimestamps?.[i] ?? null,
      }))
  }, [frames, frameIndices, frameTimestamps])

  if (relevantFrames.length === 0) return null

  const canPrev = currentIdx > 0
  const canNext = currentIdx < relevantFrames.length - 1
  const currentFrame = relevantFrames[currentIdx]

  return (
    <div className="mt-3 rounded-lg border bg-muted/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Film className="w-3.5 h-3.5" />
          <span>{label}</span>
        </div>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {currentIdx + 1} / {relevantFrames.length}
        </span>
      </div>
      <div className="relative">
        <div className="aspect-video bg-black/5 flex items-center justify-center">
          {currentFrame && (
            <img
              src={currentFrame.src}
              alt={`Frame ${currentFrame.index + 1}`}
              className="max-w-full max-h-full object-contain"
              loading="lazy"
            />
          )}
        </div>
        {relevantFrames.length > 1 && (
          <>
            <button
              onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
              disabled={!canPrev}
              className={`absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/80 backdrop-blur-sm border shadow-sm flex items-center justify-center transition-all hover:bg-background ${
                canPrev ? 'opacity-100 hover:scale-105' : 'opacity-30 cursor-not-allowed'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentIdx(i => Math.min(relevantFrames.length - 1, i + 1))}
              disabled={!canNext}
              className={`absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/80 backdrop-blur-sm border shadow-sm flex items-center justify-center transition-all hover:bg-background ${
                canNext ? 'opacity-100 hover:scale-105' : 'opacity-30 cursor-not-allowed'
              }`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}
        {currentFrame?.timestamp !== null && (
          <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] font-mono">
            {(currentFrame.timestamp ?? 0).toFixed(2)}s
          </div>
        )}
      </div>
      {relevantFrames.length > 1 && (
        <div className="flex justify-center gap-1 py-2">
          {relevantFrames.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentIdx(i)}
              className={`w-1.5 h-1.5 rounded-full transition-all ${
                i === currentIdx ? 'bg-primary w-4' : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Animated Score Ring ────────────────────────────────── */
function AnimatedScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 52 // ~327
  const count = useMotionValue(0)
  const rounded = useTransform(count, (v) => Math.round(v))
  const [displayScore, setDisplayScore] = useState(0)

  useEffect(() => {
    count.set(0)
    const controls = animate(count, score, {
      duration: 1.2,
      ease: 'easeOut',
    })
    const unsubscribe = rounded.on('change', (v) => setDisplayScore(v))
    return () => {
      controls.stop()
      unsubscribe()
    }
  }, [score, count, rounded])

  const strokeDash = useTransform(
    count,
    (v) => `${(v / 100) * circumference} ${circumference}`
  )

  return (
    <div className="relative w-28 h-28 sm:w-32 sm:h-32">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="8" />
        <motion.circle
          cx="60" cy="60" r="52" fill="none"
          stroke="currentColor" strokeWidth="8" strokeLinecap="round"
          style={{ strokeDasharray: strokeDash }}
          className={getScoreColor(score)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold">{displayScore}</span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
    </div>
  )
}

/* ─── Main Component ─────────────────────────────────────── */
interface AnalysisViewProps {
  analysis: SpikeAnalysis
  playerName: string
  onGeneratePlan: () => void
  isGenerating: boolean
  onReset: () => void
}

export default function AnalysisView({
  analysis,
  playerName,
  onGeneratePlan,
  isGenerating,
  onReset,
}: AnalysisViewProps) {
  const { t } = useI18n()

  const scoreKeys = Object.keys(CHECKPOINT_LABELS) as Array<keyof typeof CHECKPOINT_LABELS>
  const conf = analysis.confidence
  const meta = analysis.metadata
  const hasFrames = analysis.frames && analysis.frames.length > 0

  // When confidence data exists, average only high-confidence scores
  const scoreEntries = scoreKeys.map(k => ({
    key: k,
    score: (analysis.scores as Record<string, number>)[k] ?? 0,
    conf: conf ? (conf as Record<string, number>)[k] ?? 0 : 100,
  }))
  const highConfScores = scoreEntries.filter(e => e.conf >= 51).map(e => e.score)
  const overallAvg = highConfScores.length > 0
    ? Math.round(highConfScores.reduce((a, b) => a + b, 0) / highConfScores.length)
    : scoreEntries.length > 0
      ? Math.round(scoreEntries.reduce((a, b) => a + b.score, 0) / scoreEntries.length)
      : 0

  const phases = [
    { key: 'approach' as const, label: t().analysis.phaseApproach, labelKey: 'phaseLabelApproach' as const, icon: Footprints, color: 'text-teal-500' },
    { key: 'jump' as const, label: t().analysis.phaseJump, labelKey: 'phaseLabelJump' as const, icon: Activity, color: 'text-cyan-500' },
    { key: 'contact' as const, label: t().analysis.phaseContact, labelKey: 'phaseLabelContact' as const, icon: Flame, color: 'text-teal-400' },
    { key: 'followThrough' as const, label: t().analysis.phaseFollowThrough, labelKey: 'phaseLabelFollowThrough' as const, icon: ShieldCheck, color: 'text-emerald-500' },
  ]

  const phaseLabelMap: Record<string, string> = {
    approach: t().analysis.phaseLabelApproach,
    jump: t().analysis.phaseLabelJump,
    contact: t().analysis.phaseLabelContact,
    followThrough: t().analysis.phaseFollowThrough,
  }

  // Map phase keys to their checkpoint keys
  const phaseToCheckpoints: Record<string, string[]> = {
    approach: ['approach_speed', 'approach_angle', 'last_step_length', 'footwork_rhythm', 'arms_swing_back'],
    jump: ['vertical_jump_conversion', 'hip_shoulder_rotation', 'body_position_air', 'torso_angle_air'],
    contact: ['bow_and_arrow', 'arm_swing_speed', 'contact_point', 'wrist_snap', 'contact_height'],
    followThrough: ['follow_through', 'landing_balance'],
  }

  function getScoreLabel(score: number): string {
    if (score >= 90) return t().scoreLabels.elite
    if (score >= 76) return t().scoreLabels.excellent
    if (score >= 60) return t().scoreLabels.decent
    if (score >= 40) return t().scoreLabels.needsWork
    return t().scoreLabels.critical
  }

  const checkpoints = t().checkpoints
  const checkpointFeedback = analysis.checkpointFeedback ?? {}

  // Get frame indices for a checkpoint key
  const getCheckpointFrameIndices = (key: string): number[] => {
    return analysis.checkpointFrames?.[key] ?? []
  }

  // Map checkpoint keys back from the label text in topWeaknesses
  const labelToKey = useMemo(() => {
    const map: Record<string, string> = {}
    for (const [k, v] of Object.entries(CHECKPOINT_LABELS)) {
      map[v.label.toLowerCase()] = k
    }
    return map
  }, [])

  const getWeaknessKey = (weaknessText: string): string | null => {
    const lower = weaknessText.toLowerCase()
    for (const [label, key] of Object.entries(labelToKey)) {
      if (lower.startsWith(label)) return key
    }
    return null
  }

  // Get the weakest checkpoints per phase (for inline frame display)
  const getWeakCheckpointsForPhase = (phaseKey: string): string[] => {
    const cpKeys = phaseToCheckpoints[phaseKey] ?? []
    return cpKeys
      .map(k => ({ key: k, score: (analysis.scores as Record<string, number>)[k] ?? 0 }))
      .filter(e => e.score < 75)
      .sort((a, b) => a.score - b.score)
      .slice(0, 2)
      .map(e => e.key)
  }

  return (
    <div className="space-y-6">
      {/* Overall Score */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-teal-500/10 via-cyan-500/5 to-transparent p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <AnimatedScoreRing score={overallAvg} />
            <div className="text-center sm:text-left flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap justify-center sm:justify-start">
                <Badge variant="secondary">{analysis.estimatedLevel || 'intermediate'}</Badge>
                <Badge variant="outline" className="text-xs font-normal">
                  <Target className="w-3 h-3 mr-1" />
                  {t().analysis.analysisMethod}
                </Badge>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold mb-1">
                {playerName ? `${playerName}'s` : t().analysis.yourSpikeAnalysis}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {analysis.coachNotes || ''}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Analysis Quality Banner */}
      {meta && (
        <Card className="border-l-4 overflow-hidden"
          style={{ borderLeftColor: meta.averageConfidence && meta.averageConfidence >= 60 ? '#10b981' : meta.averageConfidence && meta.averageConfidence >= 30 ? '#f59e0b' : '#ef4444' }}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Eye className={`w-5 h-5 mt-0.5 shrink-0 ${meta.averageConfidence && meta.averageConfidence >= 60 ? 'text-emerald-500' : meta.averageConfidence && meta.averageConfidence >= 30 ? 'text-yellow-500' : 'text-red-500'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {meta.averageConfidence && meta.averageConfidence >= 60 ? t().analysis.qualityHigh : meta.averageConfidence && meta.averageConfidence >= 30 ? t().analysis.qualityMedium : t().analysis.qualityLow}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {meta.frameCount && <span>{meta.frameCount} {t().analysis.framesExtracted}</span>}
                  {meta.averageConfidence !== undefined && <span> · {t().analysis.avgConfidence}: {meta.averageConfidence}%</span>}
                  {meta.framesWithPlayer !== undefined && <span> · {meta.framesWithPlayer}/{meta.frameCount} {t().analysis.framesWithPlayer}</span>}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phase Scores with inline frame nav for weak areas */}
      <div className="grid sm:grid-cols-2 gap-4">
        {phases.map(({ key, label, icon: Icon, color }) => {
          const phase = analysis.phaseAnalysis?.[key]
          if (!phase) return null
          const score = typeof phase.score === 'number' ? phase.score : 50
          const weakCps = getWeakCheckpointsForPhase(key)
          const needsImprovement = score < 75 && hasFrames && weakCps.length > 0

          return (
            <Card key={key} className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon className={`w-5 h-5 ${color}`} />
                  <h3 className="font-semibold">{label}</h3>
                </div>
                <span className={`text-2xl font-bold ${getScoreColor(score)}`}>{score}</span>
              </div>
              <Progress value={score} className="h-2 mb-3" />
              <p className="text-sm text-muted-foreground">{phase.feedback || ''}</p>

              {/* Specific fix with frame navigation */}
              {phase.specificFix && (
                <div className="mt-2 text-sm text-amber-600 dark:text-amber-400 flex gap-2 items-start">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{phase.specificFix}</span>
                </div>
              )}

              {/* Show frames for the weakest checkpoint in this phase */}
              {needsImprovement && (
                <div className="mt-3 space-y-2">
                  {weakCps.map(cpKey => {
                    const cpLabel = CHECKPOINT_LABELS[cpKey as keyof typeof CHECKPOINT_LABELS]?.label ?? cpKey
                    const cpScore = (analysis.scores as Record<string, number>)[cpKey] ?? 0
                    const cpConf = conf ? (conf as Record<string, number>)[cpKey] ?? 0 : 100
                    if (cpConf < 26) return null // Skip if not visible

                    return (
                      <div key={cpKey}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Badge variant="outline" className="text-[10px] border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                            {cpLabel}: {cpScore}
                          </Badge>
                        </div>
                        <InlineFrameNav
                          frames={analysis.frames!}
                          frameIndices={getCheckpointFrameIndices(cpKey)}
                          frameTimestamps={analysis.frameTimestamps}
                          label={cpLabel}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {/* Detailed Checkpoint Scores with inline frame nav */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t().analysis.allCheckpoints}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(['approach', 'jump', 'contact', 'followThrough'] as const).map(phase => {
            const scoresObj = analysis.scores ?? {}
            const phaseCheckpoints = Object.entries(scoresObj)
              .filter(([k, v]) => typeof v === 'number' && CHECKPOINT_LABELS[k as keyof typeof CHECKPOINT_LABELS]?.phase === phase)
            const phaseLabel = phaseLabelMap[phase] || phase
            if (phaseCheckpoints.length === 0) return null
            return (
              <div key={phase}>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {phaseLabel}
                </h4>
                <div className="space-y-2">
                  {phaseCheckpoints.map(([key, score]) => {
                    const label = checkpoints[key as keyof typeof checkpoints] ?? key
                    const feedback = checkpointFeedback[key]
                    const cpKey = key as keyof typeof CHECKPOINT_LABELS
                    const cpLabel = CHECKPOINT_LABELS[cpKey]
                    const confVal = conf ? (conf as Record<string, number>)[key] ?? 0 : 100
                    const confInfo = getConfidenceLabel(confVal)
                    const isNA = (score as number) === 0 && confVal === 0
                    const isTemporal = cpLabel?.isTemporal ?? false
                    const opacity = confVal < 26 ? 'opacity-40' : confVal < 51 ? 'opacity-60' : ''
                    const isLowScore = (score as number) > 0 && (score as number) < 75
                    const hasFramesForCheckpoint = hasFrames && getCheckpointFrameIndices(key).length > 0

                    return (
                      <div key={key}>
                        <div className={`flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2 ${opacity}`}>
                          <span className="text-sm">{label}</span>
                          <div className="flex items-center gap-1.5">
                            {isTemporal && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="text-[10px] gap-1 border-dashed">
                                    <Clock className="w-2.5 h-2.5" />
                                    {t().analysis.temporal}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="max-w-[200px] text-xs">
                                  {t().analysis.temporalTooltip}
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {isNA ? (
                              <span className="text-xs italic text-muted-foreground">N/A</span>
                            ) : (
                              <>
                                <span className={`text-sm font-semibold ${getScoreColor(score as number)}`}>{score}</span>
                                {conf && confVal < 51 && (
                                  <Badge variant="outline" className={`text-[9px] ${confInfo.color}`}>
                                    {confVal < 26 ? <EyeOff className="w-2.5 h-2.5 mr-0.5" /> : null}
                                    {confInfo.label}
                                  </Badge>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        {/* Feedback text */}
                        {feedback && !isNA && (
                          <p className="text-xs text-muted-foreground mt-1 ml-3 pl-3 border-l-2 border-muted-foreground/20">
                            {feedback}
                          </p>
                        )}
                        {/* Frame navigation for low-scored checkpoints */}
                        {isLowScore && hasFramesForCheckpoint && confVal >= 26 && (
                          <InlineFrameNav
                            frames={analysis.frames!}
                            frameIndices={getCheckpointFrameIndices(key)}
                            frameTimestamps={analysis.frameTimestamps}
                            label={label}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Strengths & Weaknesses with Frame Carousels */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" /> {t().analysis.topStrengths}
          </h3>
          <ul className="space-y-2">
            {(analysis.topStrengths ?? []).map((s, i) => (
              <li key={i} className="text-sm text-muted-foreground flex gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500" /> {t().analysis.topWeaknesses}
          </h3>
          <ul className="space-y-2">
            {(analysis.topWeaknesses ?? []).map((w, i) => {
              const cpKey = getWeaknessKey(w)
              const frameIndices = cpKey ? getCheckpointFrameIndices(cpKey) : []
              return (
                <li key={i}>
                  <div className="text-sm text-muted-foreground flex gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </div>
                  {hasFrames && frameIndices.length > 0 && (
                    <InlineFrameNav
                      frames={analysis.frames!}
                      frameIndices={frameIndices}
                      frameTimestamps={analysis.frameTimestamps}
                      label={cpKey ? CHECKPOINT_LABELS[cpKey as keyof typeof CHECKPOINT_LABELS]?.label ?? cpKey : 'Related frames'}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      {/* Phase-specific frame galleries */}
      {hasFrames && analysis.phaseFrames && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Film className="w-5 h-5" />
              Phase Breakdown — Key Frames
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {phases.map(({ key, label, icon: Icon, color }) => {
              const phaseFrameIndices = analysis.phaseFrames?.[key] ?? []
              if (phaseFrameIndices.length === 0) return null
              return (
                <div key={key}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${color}`} />
                    <h4 className="text-sm font-semibold">{label}</h4>
                    <Badge variant="secondary" className="text-[10px]">
                      {phaseFrameIndices.length} frames
                    </Badge>
                  </div>
                  <FrameCarousel
                    frames={analysis.frames!}
                    frameIndices={phaseFrameIndices}
                    frameTimestamps={analysis.frameTimestamps}
                    label={`${label} phase`}
                  />
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Methodology Disclosure */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground/70">{t().analysis.methodologyTitle}</p>
            <p>{t().analysis.methodologyDesc}</p>
            {meta?.frameCount && <p>{meta.frameCount} {t().analysis.framesExtracted.toLowerCase()}. {t().analysis.methodologyTip}</p>}
          </div>
        </div>
      </Card>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button size="lg" className="flex-1 gap-2" onClick={onGeneratePlan} disabled={isGenerating}>
          {isGenerating ? (
            <>
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                <Dumbbell className="w-4 h-4" />
              </motion.div>
              {t().analysis.generatingBtn}
            </>
          ) : (
            <>{t().analysis.generateBtn} <ArrowRight className="w-4 h-4" /></>
          )}
        </Button>
        <Button variant="outline" size="lg" onClick={onReset}>
          {t().analysis.newAnalysisBtn}
        </Button>
      </div>
    </div>
  )
}