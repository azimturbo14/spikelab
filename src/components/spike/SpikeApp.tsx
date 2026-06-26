'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Zap, Target, TrendingUp, ShieldCheck, Play, ChevronRight,
  CheckCircle2, AlertTriangle, ArrowRight, Video, Brain,
  Activity, Flame, Footprints, Dumbbell, RotateCcw
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
  getScoreLabel,
} from '@/lib/spike-types'

type TabState = 'upload' | 'analysis' | 'training'

export default function SpikeApp() {
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

    try {
      // Send video file directly as FormData (no frame extraction needed)
      const formData = new FormData()
      formData.append('video', videoFile)
      formData.append('name', profile.name)
      formData.append('position', profile.position)
      formData.append('experience', profile.experience)

      const res = await fetch('/api/analyze-spike', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        let errMsg = 'Analysis failed'
        try {
          const errData = await res.json()
          errMsg = errData.error || errMsg
        } catch { /* response wasn't JSON */ }
        throw new Error(errMsg)
      }

      const data = await res.json()
      setAnalysis(data.analysis)
      setActiveTab('analysis')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
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
        throw new Error(errData.error || 'Plan generation failed')
      }

      const data = await res.json()
      setTrainingPlan(data.plan)
      setActiveTab('training')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate plan')
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
              <span className="hidden sm:inline text-xs text-muted-foreground ml-2 uppercase tracking-widest">Volleyball Spike Analysis</span>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => {
              const el = document.getElementById('upload-section')
              el?.scrollIntoView({ behavior: 'smooth' })
            }}>Analyze</Button>
            <Button variant="ghost" size="sm" onClick={() => {
              const el = document.getElementById('features-section')
              el?.scrollIntoView({ behavior: 'smooth' })
            }}>Features</Button>
            <Button variant="ghost" size="sm" onClick={() => {
              const el = document.getElementById('science-section')
              el?.scrollIntoView({ behavior: 'smooth' })
            }}>The Science</Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-amber-500/5" />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
            <Badge variant="secondary" className="mb-4 gap-1.5">
              <Video className="w-3.5 h-3.5" /> Video-Powered Analysis
            </Badge>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6"
            >
              Upload your spike.{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-amber-500">
                Get the truth.
              </span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-8"
            >
              AI watches your spike video and rates 15 biomechanical checkpoints. No guessing, no
              subjective sliders. Just real data from your real movement.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="flex flex-wrap justify-center gap-3 text-sm text-muted-foreground"
            >
              <span className="flex items-center gap-1.5">
                <Brain className="w-4 h-4 text-orange-500" /> AI biomechanical audit
              </span>
              <span className="flex items-center gap-1.5">
                <Target className="w-4 h-4 text-orange-500" /> Strengths &amp; weaknesses ranked
              </span>
              <span className="flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-orange-500" /> Personalized 4-week plan
              </span>
            </motion.div>
          </div>
        </section>

        {/* Main Tool */}
        <section id="upload-section" className="max-w-4xl mx-auto px-4 sm:px-6 pb-20">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabState)}>
            <TabsList className="grid w-full grid-cols-3 mb-8">
              <TabsTrigger value="upload" className="gap-1.5">
                <Video className="w-4 h-4" /> 1. Upload Video
              </TabsTrigger>
              <TabsTrigger value="analysis" disabled={!analysis} className="gap-1.5">
                <Activity className="w-4 h-4" /> 2. Analysis
              </TabsTrigger>
              <TabsTrigger value="training" disabled={!trainingPlan} className="gap-1.5">
                <Dumbbell className="w-4 h-4" /> 3. Training Plan
              </TabsTrigger>
            </TabsList>

            {/* Tab 1: Upload */}
            <TabsContent value="upload">
              <Card>
                <CardContent className="p-4 sm:p-6 space-y-6">
                  {/* Player Profile - Minimal */}
                  <div>
                    <h3 className="font-semibold mb-1">Player Profile</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Optional. Helps calibrate your results against position-level benchmarks.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="player-name">Name / Nickname</Label>
                        <Input
                          id="player-name"
                          placeholder="Your name"
                          value={profile.name}
                          onChange={(e) => setProfile(p => ({ ...p, name: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Position</Label>
                        <Select value={profile.position} onValueChange={(v) => setProfile(p => ({ ...p, position: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {POSITIONS.map(pos => (
                              <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Experience</Label>
                        <Select value={profile.experience} onValueChange={(v) => setProfile(p => ({ ...p, experience: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {EXPERIENCE_LEVELS.map(lvl => (
                              <SelectItem key={lvl} value={lvl}>{lvl}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Video Upload */}
                  <div>
                    <h3 className="font-semibold mb-1">Upload Your Spike Video</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Record yourself performing a full spike approach and hit. Side angle works best.
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
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Tips for best results
                    </h4>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                      <li>Record from the <strong>side angle</strong> (perpendicular to the net)</li>
                      <li>Show the <strong>full approach and jump</strong> — not just the hit</li>
                      <li>Good lighting, steady camera</li>
                      <li>Wear contrasting clothing against the background</li>
                    </ul>
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">Analysis failed</p>
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
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <Brain className="w-4 h-4" /> Analyze My Spike
                        </>
                      )}
                    </Button>
                    {videoFile && !isAnalyzing && (
                      <Button variant="outline" size="lg" onClick={handleReset}>
                        Reset
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
                  <p>Upload and analyze a video first to see your results.</p>
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
                  <p className="text-muted-foreground mb-4">Your analysis is ready. Generate your personalized training plan.</p>
                  <Button onClick={handleGeneratePlan} disabled={isGeneratingPlan} className="gap-2">
                    {isGeneratingPlan ? (
                      <>
                        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                          <RotateCcw className="w-4 h-4" />
                        </motion.div>
                        Generating plan...
                      </>
                    ) : (
                      <>Generate 4-Week Plan <ChevronRight className="w-4 h-4" /></>
                    )}
                  </Button>
                </Card>
              ) : (
                <Card className="p-8 text-center text-muted-foreground">
                  <Dumbbell className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  <p>Complete the analysis first, then generate your training plan.</p>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </section>

        {/* Features */}
        <section id="features-section" className="bg-muted/30 py-16 sm:py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3">
              Everything you need to actually fix your spike
            </h2>
            <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-12">
              No more guessing. The AI watches your video and tells you exactly what&apos;s happening — then
              builds a plan around your real weaknesses.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                { icon: Video, title: 'Video-Powered Analysis', desc: 'Upload a video of your spike. The AI analyzes 15 biomechanical checkpoints from actual movement data — not subjective self-assessment.' },
                { icon: Brain, title: 'AI Biomechanical Audit', desc: 'A vision model trained on sports biomechanics rates your approach, jump, contact, and landing with expert-level accuracy.' },
                { icon: Target, title: 'Strengths & Weaknesses Ranked', desc: 'See what you\'re already doing well and what\'s killing your spike — in priority order. Stop fixing what isn\'t broken.' },
                { icon: TrendingUp, title: 'Personalized 4-Week Plan', desc: 'Daily drills with sets, reps, and coaching cues organized around your weakest phases. Built for actual athletes.' },
                { icon: Activity, title: 'Phase-by-Phase Breakdown', desc: 'Separate scores for Approach, Jump, Contact, and Follow-Through. Know exactly which phase to attack first.' },
                { icon: ShieldCheck, title: 'Injury-First Mindset', desc: 'Landing balance and follow-through are scored as hard as power. The best spike is one you can repeat injury-free.' },
              ].map((f) => (
                <Card key={f.title} className="p-6">
                  <f.icon className="w-8 h-8 text-orange-500 mb-3" />
                  <h3 className="font-semibold mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground">{f.desc}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Science */}
        <section id="science-section" className="py-16 sm:py-20">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3">
              The 4 phases of an elite spike
            </h2>
            <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-12">
              Power in volleyball is not about arm strength — it&apos;s about the kinetic chain. Energy flows from the ground through the legs, hips, torso, shoulder, arm, and wrist into the ball.
            </p>
            <div className="space-y-8">
              {[
                {
                  phase: '1. The Approach',
                  icon: Footprints,
                  color: 'from-blue-500/10 to-cyan-500/10',
                  border: 'border-blue-500/20',
                  desc: 'A 3-step (or 4-step) approach where the last two steps are the longest and fastest. The second-to-last step converts horizontal momentum into vertical force.',
                  items: ['Approach speed', 'Last step length', 'Approach angle', 'Footwork rhythm', 'Arm swing back'],
                },
                {
                  phase: '2. The Jump',
                  icon: Activity,
                  color: 'from-violet-500/10 to-purple-500/10',
                  border: 'border-violet-500/20',
                  desc: 'Maximized by hip-shoulder separation. The hips stay closed while the shoulders rotate, storing elastic energy in the core — the engine of spiking power.',
                  items: ['Vertical jump conversion', 'Hip-shoulder rotation', 'Air body position'],
                },
                {
                  phase: '3. Arm Swing & Contact',
                  icon: Flame,
                  color: 'from-orange-500/10 to-amber-500/10',
                  border: 'border-orange-500/20',
                  desc: 'The hitting arm loads into a bow-and-arrow position, then whips through with internal shoulder rotation. Wrist snap generates topspin for a heavy, sharp ball.',
                  items: ['Bow-and-arrow position', 'Arm swing speed', 'Contact point', 'Wrist snap', 'Contact height'],
                },
                {
                  phase: '4. Follow-Through & Landing',
                  icon: ShieldCheck,
                  color: 'from-emerald-500/10 to-green-500/10',
                  border: 'border-emerald-500/20',
                  desc: 'The arm continues across the body to decelerate safely. A soft two-foot landing with knees bent protects joints and enables instant defensive transition.',
                  items: ['Follow-through', 'Landing balance'],
                },
              ].map((p) => (
                <Card key={p.phase} className={`p-6 bg-gradient-to-r ${p.color} border ${p.border}`}>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-background/80 flex items-center justify-center shrink-0 mt-0.5">
                      <p.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg mb-1">{p.phase}</h3>
                      <p className="text-sm text-muted-foreground mb-3">{p.desc}</p>
                      <div className="flex flex-wrap gap-2">
                        {p.items.map(item => (
                          <Badge key={item} variant="secondary" className="text-xs">{item}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-8 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4" />
            <span className="font-medium text-foreground">SpikeLab</span>
            <span>Volleyball Spike Analysis & Training</span>
          </div>
          <p className="text-xs text-center sm:text-right max-w-md">
            Not a substitute for in-person coaching. Always warm up properly and consult a sports
            physiotherapist if you experience persistent pain.
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
  const overallAvg = Math.round(
    Object.values(analysis.scores).reduce((a, b) => a + b, 0) / 15
  )

  const phases = [
    { key: 'approach' as const, label: 'Approach', icon: Footprints, color: 'text-blue-500' },
    { key: 'jump' as const, label: 'Jump & Rotation', icon: Activity, color: 'text-violet-500' },
    { key: 'contact' as const, label: 'Arm Swing & Contact', icon: Flame, color: 'text-orange-500' },
    { key: 'followThrough' as const, label: 'Follow-Through & Landing', icon: ShieldCheck, color: 'text-emerald-500' },
  ]

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
              <Badge variant="secondary" className="mb-2">{analysis.estimatedLevel}</Badge>
              <h2 className="text-xl sm:text-2xl font-bold mb-1">
                {playerName ? `${playerName}'s` : 'Your'} Spike Analysis
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
          <CardTitle className="text-lg">All 15 Checkpoints</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(['approach', 'jump', 'contact', 'followThrough'] as const).map(phase => {
            const phaseCheckpoints = (Object.entries(analysis.scores) as [keyof CheckpointScores, number][])
              .filter(([k]) => CHECKPOINT_LABELS[k].phase === phase)
            const phaseLabel = phase === 'followThrough' ? 'Follow-Through' : phase.charAt(0).toUpperCase() + phase.slice(1)
            return (
              <div key={phase}>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {phaseLabel}
                </h4>
                <div className="grid sm:grid-cols-2 gap-2">
                  {phaseCheckpoints.map(([key, score]) => (
                    <div key={key} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                      <span className="text-sm">{CHECKPOINT_LABELS[key].label}</span>
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
            <CheckCircle2 className="w-5 h-5 text-emerald-500" /> Top Strengths
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
            <AlertTriangle className="w-5 h-5 text-amber-500" /> Top Weaknesses
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
              Generating plan...
            </>
          ) : (
            <>Generate 4-Week Training Plan <ArrowRight className="w-4 h-4" /></>
          )}
        </Button>
        <Button variant="outline" size="lg" onClick={onReset}>
          New Analysis
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
  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-transparent p-6 sm:p-8">
        <h2 className="text-xl sm:text-2xl font-bold mb-2">Your 4-Week Training Plan</h2>
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
                    <Badge variant="outline" className="mb-1">Week {week.week}</Badge>
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
                        {day.drills.map((drill, i) => (
                          <div key={i} className="bg-muted/30 rounded-md p-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <p className="text-sm font-medium">{drill.name}</p>
                                {drill.cue && (
                                  <p className="text-xs text-muted-foreground mt-0.5 italic">
                                    &quot;{drill.cue}&quot;
                                  </p>
                                )}
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-xs font-medium">{drill.sets} × {drill.reps}</p>
                                {drill.duration && (
                                  <p className="text-xs text-muted-foreground">{drill.duration}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
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
          <RotateCcw className="w-4 h-4" /> Start Over
        </Button>
      </div>
    </div>
  )
}