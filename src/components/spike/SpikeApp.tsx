'use client'

import { useState, useCallback, useEffect, Component, type ReactNode, type ErrorInfo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Zap, Target, TrendingUp, Video, Brain,
  Activity, Dumbbell, CheckCircle2, AlertTriangle,
  RotateCcw, ChevronRight, Upload, ArrowRight
} from 'lucide-react'
import { analyzeVideo } from '@/lib/spike-analyzer'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import VideoUploader from './VideoUploader'
import PlayerProfileForm from './PlayerProfileForm'
import AnalysisView from './AnalysisView'
import TrainingPlanView from './TrainingPlanView'
import LanguageToggle from './LanguageToggle'
import ThemeToggle from './ThemeToggle'
import {
  type SpikeAnalysis,
  type TrainingPlan,
  type PlayerProfile,
} from '@/lib/spike-types'
import { useI18n } from '@/lib/i18n-store'
import { analyzeVideoInBrowser } from '@/lib/yolo-browser'

type TabState = 'upload' | 'analysis' | 'training'

/* ─── Analysis Error Boundary ────────────────────────────────── */
interface ErrorBoundaryProps { children: ReactNode; onError: (msg: string) => void }
interface ErrorBoundaryState { hasError: boolean; error: string | null }
class AnalysisErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) { super(props); this.state = { hasError: false, error: null } }
  static getDerivedStateFromError(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { hasError: true, error: msg }
  }
  componentDidCatch(err: unknown, info: ErrorInfo) {
    console.error('[SpikeLab] AnalysisView render error:', err, info.componentStack)
    this.props.onError(err instanceof Error ? err.message : String(err))
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-destructive/10 text-destructive rounded-lg p-6 text-center">
          <AlertTriangle className="w-8 h-8 mx-auto mb-3" />
          <p className="font-medium mb-1">Rendering Error</p>
          <p className="text-sm text-destructive/80 mb-3">{this.state.error}</p>
          <p className="text-xs text-muted-foreground">Please try again with a different video.</p>
        </div>
      )
    }
    return this.props.children
  }
}

/* ─── Step indicator for stepper tabs ───────────────────────── */
const STEP_ICONS: Record<TabState, typeof Video> = {
  upload: Video,
  analysis: Activity,
  training: Dumbbell,
}

/* ─── Main App ──────────────────────────────────────────────── */
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
  const [progressStep, setProgressStep] = useState('')
  const [progressMsg, setProgressMsg] = useState('')
  const [progressPct, setProgressPct] = useState(0)
  const [showProfile, setShowProfile] = useState(false)

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
    setProgressStep('analyzing')
    setProgressMsg('')
    setProgressPct(0)

    try {
      console.log('[SpikeLab Client] Starting browser-side analysis...')
      const result = await analyzeVideo(videoFile, (pct, msg) => {
        setProgressPct(pct)
        if (msg) setProgressMsg(msg)
        if (pct < 20) setProgressStep('starting')
        else if (pct < 55) setProgressStep('analyzing')
        else if (pct < 85) setProgressStep('generating')
        else setProgressStep('finalizing')
      })

      if (!result?.scores || !result?.phaseAnalysis) {
        throw new Error(t().errors.unexpectedFormat)
      }
      console.log('[SpikeLab Client] Analysis complete, switching tab')
      setAnalysis(result)
      setActiveTab('analysis')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t().errors.somethingWentWrong
      console.error('[SpikeLab Client] Analysis error:', msg, err)
      setError(msg)
    } finally {
      setIsAnalyzing(false)
      setProgressStep('')
      setProgressMsg('')
      setProgressPct(0)
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
    setShowProfile(false)
  }

  const canAnalyze = videoFile !== null && !isAnalyzing

  // Step completion state
  const steps: { key: TabState; label: string; completed: boolean; active: boolean }[] = [
    { key: 'upload', label: t().stepperUpload, completed: !!analysis, active: activeTab === 'upload' },
    { key: 'analysis', label: t().stepperAnalysis, completed: !!trainingPlan, active: activeTab === 'analysis' },
    { key: 'training', label: t().stepperTraining, completed: false, active: activeTab === 'training' },
  ]

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
          <div className="flex items-center gap-2">
            <nav className="hidden md:flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => {
                const el = document.getElementById('upload-section')
                el?.scrollIntoView({ behavior: 'smooth' })
              }}>{t().header.nav.analyze}</Button>
            </nav>
            <LanguageToggle />
            <ThemeToggle />
          </div>
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
                <Brain className="w-4 h-4 text-primary" /> {t().hero.pill1}
              </span>
              <span className="flex items-center gap-1.5">
                <Target className="w-4 h-4 text-primary" /> {t().hero.pill2}
              </span>
              <span className="flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-primary" /> {t().hero.pill3}
              </span>
            </motion.div>
          </div>
        </section>

        {/* How It Works — bridge section */}
        <section className="border-y bg-muted/30">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
            <h2 className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-8">
              {t().howItWorks.title}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
              {[
                { num: '01', title: t().howItWorks.step1Title, desc: t().howItWorks.step1Desc, icon: Upload },
                { num: '02', title: t().howItWorks.step2Title, desc: t().howItWorks.step2Desc, icon: Brain },
                { num: '03', title: t().howItWorks.step3Title, desc: t().howItWorks.step3Desc, icon: Target },
              ].map((step, i) => (
                <motion.div
                  key={step.num}
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="text-center"
                >
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary mb-3">
                    <step.icon className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-bold text-primary/60 mb-1">{step.num}</p>
                  <h3 className="font-semibold mb-1">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Main Tool */}
        <section id="upload-section" className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
          {/* Stepper Tabs */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {steps.map((step, i) => {
                const Icon = STEP_ICONS[step.key]
                const isClickable = step.key === 'upload' || (step.key === 'analysis' && analysis) || (step.key === 'training' && trainingPlan)
                return (
                  <div key={step.key} className="flex items-center flex-1">
                    <button
                      onClick={() => isClickable && setActiveTab(step.key)}
                      disabled={!isClickable}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        step.active
                          ? 'bg-primary text-primary-foreground'
                          : step.completed
                            ? 'bg-primary/10 text-primary hover:bg-primary/15'
                            : 'text-muted-foreground cursor-not-allowed'
                      }`}
                    >
                      {step.completed && !step.active ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <Icon className="w-4 h-4" />
                      )}
                      <span className="hidden sm:inline">{step.label}</span>
                      <span className="sm:hidden">{i + 1}</span>
                    </button>
                    {i < steps.length - 1 && (
                      <div className={`flex-1 h-px mx-2 transition-colors ${
                        step.completed ? 'bg-primary/30' : 'bg-border'
                      }`} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Tab Content */}
          {activeTab === 'upload' && (
            <Card>
              <CardContent className="p-4 sm:p-6 space-y-6">
                {/* Video Upload (primary) */}
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

                {/* Progress Bar during analysis */}
                {isAnalyzing && (
                  <div className="space-y-2 pt-2">
                    <Progress value={progressPct} className="h-2" />
                    {progressMsg && (
                      <p className="text-sm text-muted-foreground text-center animate-pulse">
                        {progressMsg}
                      </p>
                    )}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <Button
                    size="lg"
                    className="flex-1 gap-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0"
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
                        {progressMsg || t().upload.analyzingBtn}
                        {progressPct > 0 && (
                          <span className="text-xs opacity-70">({progressPct}%)</span>
                        )}
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

                <Separator />

                {/* Player Profile — progressive disclosure */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowProfile(!showProfile)}
                    className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                  >
                    <ChevronRight className={`w-4 h-4 transition-transform ${showProfile ? 'rotate-90' : ''}`} />
                    {t().upload.profileTitle}
                    <span className="text-xs text-muted-foreground/60 font-normal">({t().upload.profileDesc.split('.')[0]})</span>
                  </button>
                  <AnimatePresence>
                    {showProfile && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="pt-4">
                          <PlayerProfileForm profile={profile} onChange={setProfile} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Video Tips — redesigned with checkmark icons */}
                <div className="border-l-2 border-primary/30 bg-primary/5 rounded-r-xl p-4 space-y-2.5">
                  <h4 className="font-medium text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-primary" /> {t().upload.tipsTitle}
                  </h4>
                  <ul className="text-sm text-muted-foreground space-y-2">
                    {[t().upload.tip1, t().upload.tip2, t().upload.tip3, t().upload.tip4].map((tip, i) => (
                      <li key={i} className="flex gap-2 items-start">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'analysis' && (
            analysis ? (
              <AnalysisErrorBoundary onError={(msg) => { setError(msg); setActiveTab('upload') }}>
                <AnalysisView
                  analysis={analysis}
                  playerName={profile.name}
                  onGeneratePlan={handleGeneratePlan}
                  isGenerating={isGeneratingPlan}
                  onReset={handleReset}
                />
              </AnalysisErrorBoundary>
            ) : (
              <Card className="p-10 text-center">
                <Activity className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
                <h3 className="font-semibold text-lg mb-2">{t().analysis.emptyTitle}</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">{t().analysis.emptyMsg}</p>
                <Button variant="outline" className="mt-6" onClick={() => setActiveTab('upload')}>
                  <ArrowRight className="w-4 h-4 mr-2" />{t().stepperUpload}
                </Button>
              </Card>
            )
          )}

          {activeTab === 'training' && (
            trainingPlan ? (
              <TrainingPlanView plan={trainingPlan} onReset={handleReset} />
            ) : analysis ? (
              <Card className="p-10 text-center">
                <Dumbbell className="w-12 h-12 mx-auto mb-4 text-primary/50" />
                <h3 className="font-semibold text-lg mb-2">{t().training.emptyTitle}</h3>
                <p className="text-sm text-muted-foreground mb-6">{t().training.readyMsg}</p>
                <Button onClick={handleGeneratePlan} disabled={isGeneratingPlan} className="gap-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0">
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
              <Card className="p-10 text-center">
                <Dumbbell className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
                <h3 className="font-semibold text-lg mb-2">{t().training.emptyTitle}</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">{t().training.emptyMsg}</p>
                <Button variant="outline" className="mt-6" onClick={() => setActiveTab('analysis')}>
                  <ArrowRight className="w-4 h-4 mr-2" />{t().stepperAnalysis}
                </Button>
              </Card>
            )
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-8 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
                <Zap className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-semibold text-foreground">SpikeLab</span>
              <Badge variant="secondary" className="text-[10px] font-normal ml-1">{t().footer.version}</Badge>
            </div>
            <p className="text-xs text-center sm:text-right max-w-md text-muted-foreground leading-relaxed">
              {t().footer.tagline}
            </p>
          </div>
          <p className="text-xs text-center text-muted-foreground/70">
            {t().footer.disclaimer}
          </p>
        </div>
      </footer>
    </div>
  )
}