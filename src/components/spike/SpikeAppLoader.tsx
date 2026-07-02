'use client'

import dynamic from 'next/dynamic'

const SpikeApp = dynamic(() => import('@/components/spike/SpikeApp'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center animate-pulse">
          <svg className="w-6 h-6 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">Loading SpikeLab...</p>
      </div>
    </div>
  ),
})

export default function SpikeAppLoader() {
  return <SpikeApp />
}