'use client'

import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { useState, useEffect } from 'react'
import {
  CheckCircle2, AlertTriangle, ArrowRight, Activity,
  Footprints, Dumbbell, ShieldCheck, Flame, Target,
  Info, Clock, Eye, EyeOff
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

/* ─── Animated Score Ring ────────────────────────────────── */
function AnimatedScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 52 // ~327
  const count = useMotionValue(0)
  const rounded = useTransform(count, (v) => Math.round(v))
  const [displayScore, setDisplayScore] = useState(0)

  useEffect(() => {
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
    followThrough: t().analysis.phaseLabelFollowThrough,
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

      {/* Phase Scores */}
      <div className="grid sm:grid-cols-2 gap-4">
        {phases.map(({ key, label, icon: Icon, color }) => {
          const phase = analysis.phaseAnalysis?.[key]
          if (!phase) return null
          const score = typeof phase.score === 'number' ? phase.score : 50
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
            </Card>
          )
        })}
      </div>

      {/* Detailed Checkpoint Scores */}
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
                <div className="grid sm:grid-cols-2 gap-2">
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

                    const scoreEl = (
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
                    )

                    if (feedback && !isNA) {
                      return (
                        <Tooltip key={key}>
                          <TooltipTrigger asChild>
                            {scoreEl}
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs text-sm">
                            {feedback}
                          </TooltipContent>
                        </Tooltip>
                      )
                    }
                    return <div key={key}>{scoreEl}</div>
                  })}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Strengths & Weaknesses */}
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
            {(analysis.topWeaknesses ?? []).map((w, i) => (
              <li key={i} className="text-sm text-muted-foreground flex gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

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