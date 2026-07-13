'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Target, Dumbbell, Youtube, ChevronDown, Package, Lightbulb,
  RotateCcw, Printer, ChevronRight
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger
} from '@/components/ui/accordion'
import { type TrainingPlan } from '@/lib/spike-types'
import { useI18n } from '@/lib/i18n-store'

interface TrainingPlanViewProps {
  plan: TrainingPlan
  onReset: () => void
}

export default function TrainingPlanView({
  plan,
  onReset,
}: TrainingPlanViewProps) {
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
      <Card className="bg-gradient-to-r from-teal-500/10 via-cyan-500/5 to-transparent p-6 sm:p-8">
        <h2 className="text-xl sm:text-2xl font-bold mb-2">{t().training.title}</h2>
        <p className="text-muted-foreground mb-4">{plan.summary}</p>
        <div className="flex flex-wrap gap-2">
          {plan.keyFocus.map(f => (
            <Badge key={f} variant="secondary"><Target className="w-3 h-3 mr-1" />{f}</Badge>
          ))}
        </div>
      </Card>

      {/* Accordion weeks */}
      <Accordion type="multiple" defaultValue={['week-1']} className="space-y-3">
        {plan.weeks.map((week, weekIdx) => (
          <AccordionItem key={week.week} value={`week-${week.week}`} className="border rounded-lg overflow-hidden">
            <AccordionTrigger className="bg-muted/30 px-5 py-4 hover:no-underline hover:bg-muted/50 transition-colors [&[data-state=open]>svg.accordion-chevron]:rotate-180">
              <div className="flex items-center gap-3 text-left flex-1 mr-4">
                <Badge variant="outline" className="shrink-0">{t().training.week} {week.week}</Badge>
                <div className="min-w-0">
                  <p className="font-semibold text-sm">{week.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{week.focus}</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 accordion-chevron transition-transform duration-200" />
            </AccordionTrigger>
            <AccordionContent className="p-0">
              <div className="p-4 space-y-3">
                {week.days.map((day) => (
                  <div key={day.day} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-sm">{day.day}</h4>
                      <Badge variant="secondary" className="text-xs">{day.phase}</Badge>
                    </div>
                    <div className="space-y-2">
                      {day.drills.map((drill, i) => {
                        const videoId = drill.videoUrl ? getYouTubeId(drill.videoUrl) : null
                        const drillKey = `w${week.week}-${day.day}-${i}`
                        const isOpen = openVideo === drillKey
                        const needsEquipment = drill.equipment && drill.equipment !== 'None'
                        return (
                          <div key={i} className="bg-muted/30 rounded-md p-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium">{drill.name}</p>
                                  {needsEquipment && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-teal-600 dark:text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded-full shrink-0">
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
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <div className="flex flex-col sm:flex-row justify-center gap-3 pt-4">
        <Button variant="outline" size="lg" onClick={() => window.print()} className="gap-2">
          <Printer className="w-4 h-4" /> {t().training.printPlan}
        </Button>
        <Button variant="outline" size="lg" onClick={onReset} className="gap-2">
          <RotateCcw className="w-4 h-4" /> {t().training.startOver}
        </Button>
      </div>
    </div>
  )
}