'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FrameData {
  index: number
  phase: string
  imageBase64: string // data:image/jpeg;base64,...
  keypoints: Record<string, [number, number] | null>
  measurements: {
    groundY: number | null
    highestPointY: number | null
    torsoAngleDeg: number | null
    kneeAngleDeg: number | null
    armAngleDeg: number | null
  }
}

interface SpikeVisualizationProps {
  frames: FrameData[]
  playerName: string
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SKELETON_COLOR = '#E85D26'
const HEIGHT_COLOR = '#22C55E'
const TORSO_ANGLE_COLOR = '#F59E0B'
const KP_RADIUS = 4
const STROKE_WIDTH = 2
const CAP_WIDTH = 8
const ARC_RADIUS = 36

const PHASE_COLORS: Record<string, string> = {
  approach: '#8C877F',
  plant: '#E85D26',
  takeoff: '#D97706',
  ascent: '#059669',
  peak: '#E85D26',
  descent: '#059669',
  contact: '#DC2626',
  follow_through: '#7C3AED',
  landing: '#6366F1',
}

/* ------------------------------------------------------------------ */
/*  Skeleton bone definitions                                          */
/* ------------------------------------------------------------------ */

// Each bone connects two named keypoints. Both must be non-null to draw.
const BONES: [string, string][] = [
  // Spine / torso
  ['head', 'neck'],
  ['neck', 'leftShoulder'],
  ['neck', 'rightShoulder'],
  ['leftShoulder', 'rightShoulder'], // shoulder line
  ['neck', 'leftHip'],
  ['neck', 'rightHip'],
  ['leftHip', 'rightHip'], // hip line
  // Left arm
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  // Right arm
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  // Left leg
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  // Right leg
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
]

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function kp(keypoints: Record<string, [number, number] | null>, name: string): [number, number] | null {
  return keypoints[name] ?? null
}

function midpoint(a: [number, number] | null, b: [number, number] | null): [number, number] | null {
  if (!a || !b) return null
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngleDeg: number,
  endAngleDeg: number,
): string {
  // Convert to radians. 0° = top (negative Y), clockwise positive.
  const toRad = (d: number) => ((d - 90) * Math.PI) / 180
  const start = toRad(startAngleDeg)
  const end = toRad(endAngleDeg)
  const x1 = cx + r * Math.cos(start)
  const y1 = cy + r * Math.sin(start)
  const x2 = cx + r * Math.cos(end)
  const y2 = cy + r * Math.sin(end)
  const largeArc = Math.abs(endAngleDeg - startAngleDeg) > 180 ? 1 : 0
  const sweep = endAngleDeg > startAngleDeg ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2} ${y2}`
}

function formatPhase(phase: string): string {
  return phase
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/* ------------------------------------------------------------------ */
/*  SVG Overlay Sub-component                                          */
/* ------------------------------------------------------------------ */

function FrameOverlay({ frame }: { frame: FrameData }) {
  const { keypoints, measurements } = frame

  const shoulderMid = midpoint(kp(keypoints, 'leftShoulder'), kp(keypoints, 'rightShoulder'))
  const hipMid = midpoint(kp(keypoints, 'leftHip'), kp(keypoints, 'rightHip'))

  // ---- Skeleton bones ----
  const boneLines = BONES.map(([a, b]) => {
    const pa = kp(keypoints, a)
    const pb = kp(keypoints, b)
    if (!pa || !pb) return null
    return (
      <line
        key={`bone-${a}-${b}`}
        x1={pa[0]}
        y1={pa[1]}
        x2={pb[0]}
        y2={pb[1]}
        stroke={SKELETON_COLOR}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        opacity={0.7}
      />
    )
  })

  // ---- Keypoint dots ----
  const kpDots = Object.entries(keypoints).map(([name, pos]) => {
    if (!pos) return null
    return (
      <circle
        key={`kp-${name}`}
        cx={pos[0]}
        cy={pos[1]}
        r={KP_RADIUS}
        fill={SKELETON_COLOR}
      />
    )
  })

  // ---- Height measurement ----
  let heightLines: React.ReactNode = null
  const { groundY, highestPointY } = measurements
  if (groundY !== null && highestPointY !== null) {
    const topY = Math.min(groundY, highestPointY)
    const botY = Math.max(groundY, highestPointY)
    const heightPx = Math.abs(botY - topY)
    // Position line on the right side of the frame
    const lineX = 280

    heightLines = (
      <g>
        {/* Vertical line */}
        <line
          x1={lineX}
          y1={topY}
          x2={lineX}
          y2={botY}
          stroke={HEIGHT_COLOR}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
        />
        {/* Top cap */}
        <line
          x1={lineX - CAP_WIDTH / 2}
          y1={topY}
          x2={lineX + CAP_WIDTH / 2}
          y2={topY}
          stroke={HEIGHT_COLOR}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
        />
        {/* Bottom cap */}
        <line
          x1={lineX - CAP_WIDTH / 2}
          y1={botY}
          x2={lineX + CAP_WIDTH / 2}
          y2={botY}
          stroke={HEIGHT_COLOR}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
        />
        {/* Label */}
        <text
          x={lineX + 6}
          y={(topY + botY) / 2}
          fill={HEIGHT_COLOR}
          fontSize={11}
          fontWeight={600}
          fontFamily="system-ui, sans-serif"
          dominantBaseline="central"
          paintOrder="stroke"
          stroke="#000"
          strokeWidth={3}
          strokeLinejoin="round"
        >
          {`${Math.round(heightPx)}px`}
        </text>
      </g>
    )
  }

  // ---- Torso angle arc ----
  let torsoArc: React.ReactNode = null
  const { torsoAngleDeg } = measurements
  if (torsoAngleDeg !== null && hipMid && shoulderMid) {
    // Compute the angle of the hip→shoulder vector from vertical (negative Y)
    const dx = shoulderMid[0] - hipMid[0]
    const dy = shoulderMid[1] - hipMid[1]
    const angleRad = Math.atan2(dx, -dy) // 0 = straight up
    const angleDeg = (angleRad * 180) / Math.PI

    // Arc from 0° (vertical) to the actual angle
    const startDeg = 0
    const endDeg = angleDeg

    const showArc = Math.abs(angleDeg) > 1

    torsoArc = showArc ? (
      <g>
        {/* Vertical reference line (dashed) */}
        <line
          x1={hipMid[0]}
          y1={hipMid[1]}
          x2={hipMid[0]}
          y2={hipMid[1] - ARC_RADIUS * 1.4}
          stroke={TORSO_ANGLE_COLOR}
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.6}
        />
        {/* Arc */}
        <path
          d={describeArc(hipMid[0], hipMid[1], ARC_RADIUS, startDeg, endDeg)}
          fill="none"
          stroke={TORSO_ANGLE_COLOR}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
        />
        {/* Angle label */}
        <text
          x={hipMid[0] + (angleDeg > 0 ? 8 : -8)}
          y={hipMid[1] - ARC_RADIUS - 6}
          fill={TORSO_ANGLE_COLOR}
          fontSize={10}
          fontWeight={600}
          fontFamily="system-ui, sans-serif"
          textAnchor={angleDeg > 0 ? 'start' : 'end'}
          dominantBaseline="auto"
          paintOrder="stroke"
          stroke="#000"
          strokeWidth={3}
          strokeLinejoin="round"
        >
          {`torso: ${Math.round(angleDeg)}°`}
        </text>
      </g>
    ) : null
  }

  // ---- Knee angle arc ----
  let kneeArc: React.ReactNode = null
  const { kneeAngleDeg } = measurements
  if (kneeAngleDeg !== null) {
    const leftKneePos = kp(keypoints, 'leftKnee')
    if (leftKneePos) {
      kneeArc = (
        <text
          x={leftKneePos[0] + 10}
          y={leftKneePos[1]}
          fill="#E85D26"
          fontSize={9}
          fontWeight={500}
          fontFamily="system-ui, sans-serif"
          dominantBaseline="central"
          paintOrder="stroke"
          stroke="#000"
          strokeWidth={3}
          strokeLinejoin="round"
          opacity={0.8}
        >
          {`${Math.round(kneeAngleDeg)}°`}
        </text>
      )
    }
  }

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 320 240"
      preserveAspectRatio="xMidYMid meet"
    >
      {boneLines}
      {kpDots}
      {heightLines}
      {torsoArc}
      {kneeArc}
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  Phase Badge                                                        */
/* ------------------------------------------------------------------ */

function PhaseBadge({ phase }: { phase: string }) {
  const bg = PHASE_COLORS[phase] ?? '#8C877F'
  const isPeak = phase === 'peak'
  const label = formatPhase(phase)

  return (
    <span
      className="absolute top-2 left-2 z-10 px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider text-white shadow-sm"
      style={{
        backgroundColor: bg,
        fontWeight: isPeak ? 800 : 600,
        letterSpacing: isPeak ? '0.1em' : '0.06em',
        fontSize: isPeak ? 11 : 10,
      }}
    >
      {label}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Frame Card                                                         */
/* ------------------------------------------------------------------ */

function FrameCard({
  frame,
  index,
}: {
  frame: FrameData
  index: number
}) {
  return (
    <motion.div
      className="flex-shrink-0 w-[260px] sm:w-[300px] rounded-2xl overflow-hidden bg-white shadow-md hover:shadow-lg transition-shadow duration-200"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.45,
        delay: index * 0.08,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
    >
      {/* Image + overlay container */}
      <div className="relative aspect-[4/3] bg-zinc-100 overflow-hidden">
        {/* Phase badge */}
        <PhaseBadge phase={frame.phase} />

        {/* Frame image */}
        <img
          src={frame.imageBase64}
          alt={`Frame ${frame.index + 1} — ${formatPhase(frame.phase)}`}
          className="w-full h-full object-cover"
          draggable={false}
        />

        {/* SVG overlay */}
        <FrameOverlay frame={frame} />
      </div>

      {/* Card footer info */}
      <div className="px-3 py-2.5 flex items-center justify-between border-t border-zinc-100">
        <span className="text-xs font-medium text-zinc-700 truncate">
          {formatPhase(frame.phase)}
        </span>
        <span className="text-[11px] text-zinc-400 tabular-nums">
          Frame {frame.index + 1}
        </span>
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function SpikeVisualization({ frames, playerName }: SpikeVisualizationProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateScrollButtons()
    el.addEventListener('scroll', updateScrollButtons, { passive: true })
    window.addEventListener('resize', updateScrollButtons)
    return () => {
      el.removeEventListener('scroll', updateScrollButtons)
      window.removeEventListener('resize', updateScrollButtons)
    }
  }, [updateScrollButtons, frames])

  const scroll = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    const cardWidth = el.querySelector<HTMLElement>('[data-frame-card]')?.offsetWidth ?? 300
    const gap = 16
    el.scrollBy({
      left: direction === 'left' ? -(cardWidth + gap) : cardWidth + gap,
      behavior: 'smooth',
    })
  }, [])

  if (!frames.length) {
    return null
  }

  return (
    <section className="w-full" aria-label="Frame-by-Frame Analysis">
      {/* Header */}
      <motion.div
        className="mb-5"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
          Frame-by-Frame Analysis
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          {playerName ? `${playerName} — ` : ''}
          {frames.length} frame{frames.length !== 1 ? 's' : ''} with biomechanical overlays
        </p>
      </motion.div>

      {/* Scrollable frame strip */}
      <div className="relative group">
        {/* Left nav arrow */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scroll('left')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-9 h-9 flex items-center justify-center rounded-full bg-white/90 shadow-md border border-zinc-200 text-zinc-600 hover:text-zinc-900 hover:bg-white transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-teal-400/50"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {/* Right nav arrow */}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scroll('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-20 w-9 h-9 flex items-center justify-center rounded-full bg-white/90 shadow-md border border-zinc-200 text-zinc-600 hover:text-zinc-900 hover:bg-white transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-teal-400/50"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}

        {/* Scroll container */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scroll-smooth px-1 pb-2 snap-x snap-mandatory scrollbar-thin"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#d4d4d8 transparent',
          }}
        >
          {frames.map((frame, i) => (
            <div key={frame.index} className="snap-center" data-frame-card>
              <FrameCard frame={frame} index={i} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Re-export types for consumers                                      */
/* ------------------------------------------------------------------ */

export type { FrameData, SpikeVisualizationProps }