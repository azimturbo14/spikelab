'use client'

import { useI18n } from '@/lib/i18n-store'
import { LANG_FLAGS, LANG_LABELS, type Lang } from '@/lib/i18n'

const LANGS: Lang[] = ['en', 'ru', 'uz']

export default function LanguageToggle() {
  const { lang, setLang } = useI18n()

  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-background p-0.5">
      {LANGS.map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all ${
            lang === l
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        >
          <span className="text-[11px] leading-none">{LANG_FLAGS[l]}</span>
          <span className="hidden sm:inline">{LANG_LABELS[l]}</span>
        </button>
      ))}
    </div>
  )
}