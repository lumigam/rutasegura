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

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6
export interface LatLng { lat: number, lng: number }

export interface LinkedUsuario { id: string, name: string, email: string }

export interface Schedule {
  id: string
  routeId: string
  days: Weekday[]
  time: string
  windowMinutesBefore: number
  windowMinutesAfter: number
  estimatedArrivalMinutes: number | null
  arrivalToleranceMinutes: number
  active: boolean
}

export interface Route {
  id: string
  tutorId: string
  usuarioId: string
  label: string
  points: LatLng[]
  corridorWidthMeters: number
  active: boolean
  createdAt: string
  schedules: Schedule[]
}
