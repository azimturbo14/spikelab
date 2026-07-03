'use client'

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Zap, Target, TrendingUp, ShieldCheck, Play, ChevronRight,
  CheckCircle2, AlertTriangle, ArrowRight, Video, Brain,
  Activity, Flame, Footprints, Dumbbell, RotateCcw, Youtube,
  ChevronDown, Package, Lightbulb
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import VideoUploader from './VideoUploader'
import LanguageToggle from './LanguageToggle'
import {
  type SpikeAnalysis,
  type TrainingPlan,
  type PlayerProfile,
  type CheckpointScores,
  CHECKPOINT_LABELS,
  POSITIONS,
  EXPERIENCE_LEVELS,
  getScoreColor,
  getScoreBgColor,
} from '@/lib/spike-types'
import { useI18n } from '@/lib/i18n-store'

type TabState = 'upload' | 'analysis' | 'training'

export default function SpikeApp() {
  const { t } = useI18n()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const [activeTab, setActiveTab] = useState<TabState>('upload')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<SpikeAnalysis | null>(null)
  const [trainingPlan, setTrainingPlan] = useState<TrainingPlan | null>(null)
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [profile, setProfile] = useState<PlayerProfile>({
    name: '',
    position: 'Outside Hitter',
    experience: 'Intermediate (2-5 years)',
  })

  const handleVideoReady = useCallback((file: File) => {
    setVideoFile(file)
    setError(null)
  }, [])

  const handleAnalyze = async () => {
    if (!videoFile) return
    setIsAnalyzing(true)
    setError(null)
    setAnalysis(null)
    setTrainingPlan(null)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 180_000) // 3 min timeout

    try {
      const formData = new FormData()
      formData.append('video', videoFile)
      formData.append('name', profile.name)
      formData.append('position', profile.position)
      formData.append('experience', profile.experience)

      const res = await fetch('/api/analyze-spike', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      if (!res.ok) {
        let errMsg = t().errors.analysisFailed
        try {
          const errData = await res.json()
          errMsg = errData.error || errMsg
        } catch { /* response wasn't JSON */ }
        throw new Error(errMsg)
      }

      const data = await res.json()
      if (data.analysis) {
        setAnalysis(data.analysis)
        setActiveTab('analysis')
      } else if (data.scores) {
        // API returned analysis directly without wrapper
        setAnalysis(data as unknown as import('@/lib/spike-types').SpikeAnalysis)
        setActiveTab('analysis')
      } else {
        throw new Error(t().errors.unexpectedFormat)
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError(t().errors.timeout)
      } else {
        setError(err instanceof Error ? err.message : t().errors.somethingWentWrong)
      }
    } finally {
      clearTimeout(timeoutId)
      setIsAnalyzing(false)
    }
  }

  const handleGeneratePlan = async () => {
    if (!analysis) return
    setIsGeneratingPlan(true)

    try {
      const res = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis, profile }),
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || t().errors.planFailed)
      }

      const data = await res.json()
      setTrainingPlan(data.plan)
      setActiveTab('training')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t().errors.planGenerateFailed)
    } finally {
      setIsGeneratingPlan(false)
    }
  }

  const handleReset = () => {
    setVideoFile(null)
    setAnalysis(null)
    setTrainingPlan(null)
    setError(null)
    setActiveTab('upload')
  }

  const canAnalyze = videoFile !== null && !isAnalyzing

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center animate-pulse">
            <Zap className="w-6 h-6 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">{t().loading}</p>
        </div>
      </div>
    )
  }

  const positionLabels = t().positionLabels
  const experienceLabels = t().experienceLabels

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight">SpikeLab</span>
              <span className="hidden sm:inline text-xs text-muted-foreground ml-2 uppercase tracking-widest">{t().header.subtitle}</span>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => {
              const el = document.getElementById('upload-section')
              el?.scrollIntoView({ behavior: 'smooth' })
            }}>{t().header.nav.analyze}</Button>
            <LanguageToggle />
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-amber-500/5" />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
            <Badge variant="secondary" className="mb-4 gap-1.5">
              <Video className="w-3.5 h-3.5" /> {t().hero.badge}
            </Badge>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6"
            >
              {t().hero.title1}{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-amber-500">
                {t().hero.titleHighlight}
              </span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-8"
            >
              {t().hero.description}
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="flex flex-wrap justify-center gap-3 text-sm text-muted-foreground"
            >
              <span className="flex items-center gap-1.5">
                <Brain className="w-4 h-4 text-orange-500" /> {t().hero.pill1}
              </span>
              <span className="flex items-center gap-1.5">
                <Target className="w-4 h-4 text-orange-500" /> {t().hero.pill2}
              </span>
              <span className="flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-orange-500" /> {t().hero.pill3}
              </span>
            </motion.div>
          </div>
        </section>

        {/* Main Tool */}
        <section id="upload-section" className="max-w-4xl mx-auto px-4 sm:px-6 pb-20">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabState)}>
            <TabsList className="grid w-full grid-cols-3 mb-8">
              <TabsTrigger value="upload" className="gap-1.5" style={{ borderRadius: '6px' }}>
                <Video className="w-4 h-4" /> {t().tabs.upload}
              </TabsTrigger>
              <TabsTrigger value="analysis" disabled={!analysis} className="gap-1.5" style={{ borderRadius: '6px' }}>
                <Activity className="w-4 h-4" /> {t().tabs.analysis}
              </TabsTrigger>
              <TabsTrigger value="training" disabled={!trainingPlan} className="gap-1.5" style={{ borderRadius: '6px' }}>
                <Dumbbell className="w-4 h-4" /> {t().tabs.training}
              </TabsTrigger>
            </TabsList>

            {/* Tab 1: Upload */}
            <TabsContent value="upload">
              <Card>
                <CardContent className="p-4 sm:p-6 space-y-6">
                  {/* Player Profile - Minimal */}
                  <div>
                    <h3 className="font-semibold mb-1">{t().upload.profileTitle}</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      {t().upload.profileDesc}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="player-name">{t().upload.nameLabel}</Label>
                        <Input
                          id="player-name"
                          placeholder={t().upload.namePlaceholder}
                          value={profile.name}
                          onChange={(e) => setProfile(p => ({ ...p, name: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t().upload.positionLabel}</Label>
                        <Select value={profile.position} onValueChange={(v) => setProfile(p => ({ ...p, position: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {POSITIONS.map(pos => (
                              <SelectItem key={pos} value={pos}>{positionLabels[pos as keyof typeof positionLabels]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>{t().upload.experienceLabel}</Label>
                        <Select value={profile.experience} onValueChange={(v) => setProfile(p => ({ ...p, experience: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {EXPERIENCE_LEVELS.map(lvl => (
                              <SelectItem key={lvl} value={lvl}>{experienceLabels[lvl as keyof typeof experienceLabels]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Video Upload */}
                  <div>
                    <h3 className="font-semibold mb-1">{t().upload.videoTitle}</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      {t().upload.videoDesc}
                    </p>
                    <VideoUploader
                      onVideoReady={handleVideoReady}
                      isAnalyzing={isAnalyzing}
                      disabled={isAnalyzing}
                    />
                  </div>

                  {/* Video Tips */}
                  <div className="bg-muted/50 rounded-xl p-4 space-y-2">
                    <h4 className="font-medium text-sm flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" /> {t().upload.tipsTitle}
                    </h4>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                      <li>{t().upload.tip1}</li>
                      <li>{t().upload.tip2}</li>
                      <li>{t().upload.tip3}</li>
                      <li>{t().upload.tip4}</li>
                    </ul>
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">{t().upload.errorTitle}</p>
                        <p className="text-destructive/80">{error}</p>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <Button
                      size="lg"
                      className="flex-1 gap-2"
                      disabled={!canAnalyze}
                      onClick={handleAnalyze}
                    >
                      {isAnalyzing ? (
                        <>
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                          >
                            <RotateCcw className="w-4 h-4" />
                          </motion.div>
                          {t().upload.analyzingBtn}
                        </>
                      ) : (
                        <>
                          <Brain className="w-4 h-4" /> {t().upload.analyzeBtn}
                        </>
                      )}
                    </Button>
                    {videoFile && !isAnalyzing && (
                      <Button variant="outline" size="lg" onClick={handleReset}>
                        {t().upload.resetBtn}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab 2: Analysis */}
            <TabsContent value="analysis">
              {analysis ? (
                <AnalysisView
                  analysis={analysis}
                  playerName={profile.name}
                  onGeneratePlan={handleGeneratePlan}
                  isGenerating={isGeneratingPlan}
                  onReset={handleReset}
                />
              ) : (
                <Card className="p-8 text-center text-muted-foreground">
                  <Activity className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  <p>{t().analysis.emptyMsg}</p>
                </Card>
              )}
            </TabsContent>

            {/* Tab 3: Training Plan */}
            <TabsContent value="training">
              {trainingPlan ? (
                <TrainingPlanView plan={trainingPlan} onReset={handleReset} />
              ) : analysis ? (
                <Card className="p-8 text-center">
                  <Dumbbell className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground mb-4">{t().training.readyMsg}</p>
                  <Button onClick={handleGeneratePlan} disabled={isGeneratingPlan} className="gap-2">
                    {isGeneratingPlan ? (
                      <>
                        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                          <RotateCcw className="w-4 h-4" />
                        </motion.div>
                        {t().training.generatingBtn}
                      </>
                    ) : (
                      <>{t().training.generateBtn} <ChevronRight className="w-4 h-4" /></>
                    )}
                  </Button>
                </Card>
              ) : (
                <Card className="p-8 text-center text-muted-foreground">
                  <Dumbbell className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  <p>{t().training.emptyMsg}</p>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-8 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4" />
            <span className="font-medium text-foreground">SpikeLab</span>
            <span>{t().footer.subtitle}</span>
          </div>
          <p className="text-xs text-center sm:text-right max-w-md">
            {t().footer.disclaimer}
          </p>
        </div>
      </footer>
    </div>
  )
}

/* ─── Analysis View ──────────────────────────────────────────── */

function AnalysisView({
  analysis,
  playerName,
  onGeneratePlan,
  isGenerating,
  onReset,
}: {
  analysis: SpikeAnalysis
  playerName: string
  onGeneratePlan: () => void
  isGenerating: boolean
  onReset: () => void
}) {
  const { t } = useI18n()

  const overallAvg = Math.round(
    Object.values(analysis.scores).reduce((a, b) => a + b, 0) / 15
  )

  const phases = [
    { key: 'approach' as const, label: t().analysis.phaseApproach, labelKey: 'phaseLabelApproach' as const, icon: Footprints, color: 'text-blue-500' },
    { key: 'jump' as const, label: t().analysis.phaseJump, labelKey: 'phaseLabelJump' as const, icon: Activity, color: 'text-violet-500' },
    { key: 'contact' as const, label: t().analysis.phaseContact, labelKey: 'phaseLabelContact' as const, icon: Flame, color: 'text-orange-500' },
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

  return (
    <div className="space-y-6">
      {/* Overall Score */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-transparent p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="relative w-28 h-28 sm:w-32 sm:h-32">
              <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="8" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="currentColor" strokeWidth="8" strokeLinecap="round"
                  strokeDasharray={`${(overallAvg / 100) * 327} 327`}
                  className={getScoreColor(overallAvg)}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold">{overallAvg}</span>
                <span className="text-xs text-muted-foreground">/ 100</span>
              </div>
            </div>
            <div className="text-center sm:text-left flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary">{analysis.estimatedLevel}</Badge>
                <Badge variant="outline" className="text-xs font-normal">
                  YOLOv8 Pose Tracking
                </Badge>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold mb-1">
                {playerName ? `${playerName}'s` : t().analysis.yourSpikeAnalysis}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {analysis.coachNotes}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Phase Scores */}
      <div className="grid sm:grid-cols-2 gap-4">
        {phases.map(({ key, label, icon: Icon, color }) => {
          const phase = analysis.phaseAnalysis[key]
          return (
            <Card key={key} className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon className={`w-5 h-5 ${color}`} />
                  <h3 className="font-semibold">{label}</h3>
                </div>
                <span className={`text-2xl font-bold ${getScoreColor(phase.score)}`}>{phase.score}</span>
              </div>
              <Progress value={phase.score} className="h-2 mb-3" />
              <p className="text-sm text-muted-foreground">{phase.feedback}</p>
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
            const phaseCheckpoints = (Object.entries(analysis.scores) as [keyof CheckpointScores, number][])
              .filter(([k]) => CHECKPOINT_LABELS[k].phase === phase)
            const phaseLabel = phaseLabelMap[phase]
            return (
              <div key={phase}>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {phaseLabel}
                </h4>
                <div className="grid sm:grid-cols-2 gap-2">
                  {phaseCheckpoints.map(([key, score]) => (
                    <div key={key} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                      <span className="text-sm">{checkpoints[key as keyof typeof checkpoints]}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${getScoreColor(score)}`}>{score}</span>
                        <Badge variant="outline" className={`text-[10px] ${getScoreColor(score)}`}>
                          {getScoreLabel(score)}
                        </Badge>
                      </div>
                    </div>
                  ))}
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
            {analysis.topStrengths.map((s, i) => (
              <li key={i} className="text-sm text-muted-foreground flex gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" /> {t().analysis.topWeaknesses}
          </h3>
          <ul className="space-y-2">
            {analysis.topWeaknesses.map((w, i) => (
              <li key={i} className="text-sm text-muted-foreground flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button size="lg" className="flex-1 gap-2" onClick={onGeneratePlan} disabled={isGenerating}>
          {isGenerating ? (
            <>
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                <RotateCcw className="w-4 h-4" />
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

/* ─── Training Plan View ─────────────────────────────────────── */

function TrainingPlanView({
  plan,
  onReset,
}: {
  plan: TrainingPlan
  onReset: () => void
}) {
  const { t } = useI18n()
  const [openVideo, setOpenVideo] = useState<string | null>(null)

  function getYouTubeId(url: string): string | null {
    const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
    return match ? match[1] : null
  }

  function toggleVideo(drillKey: string) {
    setOpenVideo(prev => prev === drillKey ? null : drillKey)
  }

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-transparent p-6 sm:p-8">
        <h2 className="text-xl sm:text-2xl font-bold mb-2">{t().training.title}</h2>
        <p className="text-muted-foreground mb-4">{plan.summary}</p>
        <div className="flex flex-wrap gap-2">
          {plan.keyFocus.map(f => (
            <Badge key={f} variant="secondary"><Target className="w-3 h-3 mr-1" />{f}</Badge>
          ))}
        </div>
      </Card>

      <AnimatePresence>
        {plan.weeks.map((week) => (
          <motion.div
            key={week.week}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: week.week * 0.1 }}
          >
            <Card className="overflow-hidden">
              <CardHeader className="bg-muted/30">
                <div className="flex items-center justify-between">
                  <div>
                    <Badge variant="outline" className="mb-1">{t().training.week} {week.week}</Badge>
                    <CardTitle className="text-lg">{week.title}</CardTitle>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{week.focus}</p>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-3">
                  {week.days.map((day) => (
                    <div key={day.day} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium text-sm">{day.day}</h4>
                        <Badge variant="secondary" className="text-xs">{day.phase}</Badge>
                      </div>
                      <div className="space-y-2">
                        {day.drills.map((drill, i) => {
                          const videoId = drill.videoUrl ? getYouTubeId(drill.videoUrl) : null
                          const drillKey = `${week.week}-${day.day}-${i}`
                          const isOpen = openVideo === drillKey
                          const needsEquipment = drill.equipment && drill.equipment !== 'None'
                          return (
                            <div key={i} className="bg-muted/30 rounded-md p-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-medium">{drill.name}</p>
                                    {needsEquipment && (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                                        <Package className="w-3 h-3" />
                                        {drill.equipment}
                                      </span>
                                    )}
                                    {videoId && (
                                      <button
                                        onClick={() => toggleVideo(drillKey)}
                                        className="inline-flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-400 transition-colors shrink-0"
                                      >
                                        <Youtube className="w-3.5 h-3.5" />
                                        {isOpen ? t().training.hide : t().training.watch}
                                        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                      </button>
                                    )}
                                  </div>
                                  {drill.cue && (
                                    <p className="text-xs text-muted-foreground mt-0.5 italic">
                                      &quot;{drill.cue}&quot;
                                    </p>
                                  )}
                                  {needsEquipment && drill.noEquipmentAlt && (
                                    <div className="mt-1.5 flex items-start gap-1.5 bg-emerald-500/5 border border-emerald-500/20 rounded-md px-2 py-1.5">
                                      <Lightbulb className="w-3 h-3 text-emerald-600 mt-0.5 shrink-0" />
                                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400 leading-relaxed">
                                        <span className="font-semibold">{t().training.noEquipment}</span> {drill.noEquipmentAlt}
                                      </p>
                                    </div>
                                  )}
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-xs font-medium">{drill.sets} × {drill.reps}</p>
                                  {drill.duration && (
                                    <p className="text-xs text-muted-foreground">{drill.duration}</p>
                                  )}
                                </div>
                              </div>
                              <AnimatePresence>
                                {isOpen && videoId && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                                    className="overflow-hidden"
                                  >
                                    <div className="mt-3 rounded-lg overflow-hidden border bg-black">
                                      <iframe
                                        className="w-full aspect-video"
                                        src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&start=${drill.videoStart || 0}`}
                                        title={`${drill.name} Tutorial`}
                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                        allowFullScreen
                                      />
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </AnimatePresence>

      <div className="flex justify-center pt-4">
        <Button variant="outline" size="lg" onClick={onReset} className="gap-2">
          <RotateCcw className="w-4 h-4" /> {t().training.startOver}
        </Button>
      </div>
    </div>
  )
}