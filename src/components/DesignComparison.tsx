'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, LayoutDashboard, Feather, Flame, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DesignOption {
  id: string
  title: string
  subtitle: string
  image: string
  icon: React.ElementType
  color: string
  description: string
  layoutTraits: string[]
  colorTraits: string[]
  feelTraits: string[]
  inspiredBy: string[]
}

const DESIGNS: DesignOption[] = [
  {
    id: 'dashboard',
    title: 'Sports Performance Dashboard',
    subtitle: 'Bold, asymmetric, data-forward',
    image: '/design-option-a.png',
    icon: LayoutDashboard,
    color: 'from-orange-500 to-amber-500',
    description:
      'Think Nike Training Club meets Whoop. Asymmetric split-screen layouts with large stat numbers as the visual hero. Full-width accent bars, angled section dividers, and magazine-style pull quotes. The data IS the design.',
    layoutTraits: [
      'Split-screen hero (text left, score ring right)',
      'Horizontal metrics bar with 4 large stat cards',
      'Angled/diagonal section dividers',
      'Asymmetric 2-column layouts throughout',
      'Large pull numbers and editorial typography',
    ],
    colorTraits: [
      'Dark charcoal base (#1A1A1A)',
      'Bright orange accents (#EA580C)',
      'Cards with orange left-border accents',
      'High contrast white text on dark',
    ],
    feelTraits: [
      'Energetic and sporty',
      'Data-driven and authoritative',
      'Magazine-style visual rhythm',
      'Professional sports tech',
    ],
    inspiredBy: ['Nike Training Club', 'Whoop', 'Strava'],
  },
  {
    id: 'editorial',
    title: 'Minimal Editorial',
    subtitle: 'Clean, airy, typography-first',
    image: '/design-option-b.png',
    icon: Feather,
    color: 'from-stone-500 to-stone-700',
    description:
      'Think The Athletic sports journalism meets premium print. Ultra-generous white space, thin 1px lines instead of heavy borders, warm earth tones. The content breathes. Typography carries the weight, not decoration.',
    layoutTraits: [
      'Minimal hero: large elegant text, thin underline accent',
      '2-column editorial layouts (text + illustration)',
      'Cards with no background, just subtle shadows',
      'Thin 1px borders instead of heavy card containers',
      'Generous vertical spacing (py-32 sections)',
    ],
    colorTraits: [
      'Warm white base (#FAFAF8)',
      'Soft sand backgrounds (#F5F0EB)',
      'Charcoal text (#2D2D2D)',
      'Terracotta accent (#C4724E)',
    ],
    feelTraits: [
      'Premium and sophisticated',
      'Calm and trustworthy',
      'Content-focused, no visual noise',
      'Like a high-end sports magazine',
    ],
    inspiredBy: ['The Athletic', 'Monocle', 'Kinfolk'],
  },
  {
    id: 'arena',
    title: 'Dark Arena',
    subtitle: 'Immersive, cinematic, dramatic',
    image: '/design-option-c.png',
    icon: Flame,
    color: 'from-orange-600 to-red-500',
    description:
      'Think esports broadcast meets sports tech startup. Deep dark background throughout, neon orange glows, glassmorphism cards with frosted glass. Dramatic diagonal section cuts, glowing progress bars and score rings. Cinematic intensity.',
    layoutTraits: [
      'Full dark background throughout (#0A0A0F)',
      'Glassmorphism tool cards (frosted glass)',
      'Neon-glowing score rings and progress bars',
      'Diagonal cut section dividers',
      'Full-bleed accent elements',
    ],
    colorTraits: [
      'Deep navy-black base (#0A0A0F)',
      'Neon orange glow (#FF6B2B)',
      'Amber radiance accents',
      'Semi-transparent card surfaces',
    ],
    feelTraits: [
      'Dramatic and immersive',
      'Cinematic intensity',
      'Futuristic sports tech',
      'Esports broadcast energy',
    ],
    inspiredBy: ['Esports UI', 'Valorant/Overwatch broadcast', 'Sports tech startups'],
  },
]

export default function DesignComparison() {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <div className="border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-orange-400 mb-3">Design Exploration</p>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mb-3" style={{ fontFamily: 'var(--font-heading), system-ui, sans-serif' }}>
            Pick a Direction for SpikeLab
          </h1>
          <p className="text-zinc-400 max-w-xl mx-auto">
            Here are 3 distinct design directions. Each changes the layout, spacing, visual hierarchy, and overall feel — not just colors. Click the one you like best.
          </p>
        </div>
      </div>

      {/* Options Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="grid gap-6 lg:grid-cols-3">
          {DESIGNS.map((design, index) => {
            const Icon = design.icon
            const isSelected = selected === design.id

            return (
              <motion.div
                key={design.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.15 }}
                onClick={() => setSelected(design.id)}
                className={`group relative rounded-2xl border cursor-pointer transition-all duration-300 overflow-hidden ${
                  isSelected
                    ? 'border-orange-500 ring-2 ring-orange-500/30 shadow-[0_0_40px_rgba(234,88,12,0.15)]'
                    : 'border-zinc-800 hover:border-zinc-600'
                }`}
              >
                {/* Selected indicator */}
                {isSelected && (
                  <div className="absolute top-4 right-4 z-20">
                    <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-white" />
                    </div>
                  </div>
                )}

                {/* Image */}
                <div className="relative aspect-[9/16] max-h-[480px] overflow-hidden bg-zinc-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={design.image}
                    alt={design.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  />
                  {/* Gradient overlay at bottom of image */}
                  <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-zinc-950 to-transparent" />
                </div>

                {/* Content */}
                <div className="p-5 sm:p-6">
                  {/* Title + Icon */}
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${design.color} flex items-center justify-center shadow-lg`}>
                      <Icon className="w-4.5 h-4.5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg leading-tight">{design.title}</h3>
                      <p className="text-xs text-zinc-500">{design.subtitle}</p>
                    </div>
                  </div>

                  <p className="text-sm text-zinc-400 leading-relaxed mt-3 mb-4">{design.description}</p>

                  {/* Traits */}
                  <div className="space-y-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold mb-1.5">Layout Changes</p>
                      <ul className="space-y-1">
                        {design.layoutTraits.map((trait) => (
                          <li key={trait} className="text-xs text-zinc-400 flex items-start gap-1.5">
                            <span className="text-orange-500 mt-0.5">•</span>
                            {trait}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold mb-1.5">Palette & Feel</p>
                      <ul className="space-y-1">
                        {design.colorTraits.map((trait) => (
                          <li key={trait} className="text-xs text-zinc-400 flex items-start gap-1.5">
                            <span className="text-orange-500 mt-0.5">•</span>
                            {trait}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold mb-1.5">Vibe</p>
                      <div className="flex flex-wrap gap-1.5">
                        {design.feelTraits.map((trait) => (
                          <span key={trait} className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                            {trait}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold mb-1.5">Inspired By</p>
                      <div className="flex flex-wrap gap-1.5">
                        {design.inspiredBy.map((ref) => (
                          <span key={ref} className="text-[11px] px-2 py-0.5 rounded-full border border-zinc-800 text-zinc-500">
                            {ref}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* CTA */}
                  <Button
                    className={`w-full mt-5 gap-2 transition-all duration-300 ${
                      isSelected
                        ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-lg shadow-orange-500/20'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                    }`}
                    variant={isSelected ? 'default' : 'secondary'}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelected(design.id)
                    }}
                  >
                    {isSelected ? (
                      <>Selected <CheckCircle2 className="w-4 h-4" /></>
                    ) : (
                      <>Choose This <ArrowRight className="w-4 h-4" /></>
                    )}
                  </Button>
                </div>
              </motion.div>
            )
          })}
        </div>

        {/* Bottom note */}
        <div className="mt-12 text-center">
          <p className="text-sm text-zinc-600">
            Click a design to select it, then tell me &quot;go with option A/B/C&quot; and I&apos;ll rebuild the entire SpikeLab UI in that style.
          </p>
        </div>
      </div>
    </div>
  )
}