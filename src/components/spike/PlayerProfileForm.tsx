'use client'

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useI18n } from '@/lib/i18n-store'
import { POSITIONS, EXPERIENCE_LEVELS, type PlayerProfile } from '@/lib/spike-types'

interface PlayerProfileFormProps {
  profile: PlayerProfile
  onChange: (profile: PlayerProfile) => void
}

export default function PlayerProfileForm({ profile, onChange }: PlayerProfileFormProps) {
  const { t } = useI18n()
  const positionLabels = t().positionLabels
  const experienceLabels = t().experienceLabels

  return (
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
            onChange={(e) => onChange({ ...profile, name: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>{t().upload.positionLabel}</Label>
          <Select value={profile.position} onValueChange={(v) => onChange({ ...profile, position: v })}>
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
          <Select value={profile.experience} onValueChange={(v) => onChange({ ...profile, experience: v })}>
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
  )
}