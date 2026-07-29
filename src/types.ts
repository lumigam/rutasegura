export const LEGAL_CONSENT_VERSION = '2026-07-29-v1'

export interface UserAccount {
  id: string
  email: string
  name: string
  role: 'TUTOR' | 'USUARIO'
  active: boolean
  privacyAcceptedAt: string | null
  consentVersion: string | null
  timezone: string
  createdAt: string
}
