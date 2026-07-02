import { create } from 'zustand'
import { type Lang, translations } from './i18n'

interface I18nState {
  lang: Lang
  setLang: (lang: Lang) => void
  t: () => typeof translations.en
}

export const useI18n = create<I18nState>((set, get) => ({
  lang: (typeof window !== 'undefined'
    ? (localStorage.getItem('spikelab-lang') as Lang) || 'en'
    : 'en'),

  setLang: (lang: Lang) => {
    localStorage.setItem('spikelab-lang', lang)
    set({ lang })
  },

  t: () => translations[get().lang],
}))