import type { LinkedUsuario, Route, Schedule, UserAccount } from './types'
import { Capacitor } from '@capacitor/core'

const TOKEN_KEY = 'rutasegura:session-token:v1'
const USER_KEY = 'rutasegura:session-user:v1'
const API_ORIGIN = Capacitor.isNativePlatform() ? 'https://rutasegura.placeat.org' : ''

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY)
  const response = await fetch(`${API_ORIGIN}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers },
  })
  const data = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new ApiError(data.error || `Error ${response.status}`, response.status)
  return data as T
}

type Session = { user: UserAccount, token: string }

export async function login(email: string, password: string): Promise<UserAccount> {
  const session = await request<Session>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  localStorage.setItem(TOKEN_KEY, session.token)
  localStorage.setItem(USER_KEY, JSON.stringify(session.user))
  return session.user
}

export async function register(name: string, email: string, password: string, role: UserAccount['role'], privacyAccepted: boolean): Promise<UserAccount> {
  const session = await request<Session>('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, role, privacyAccepted }) })
  localStorage.setItem(TOKEN_KEY, session.token)
  localStorage.setItem(USER_KEY, JSON.stringify(session.user))
  return session.user
}

export async function currentUser(): Promise<UserAccount | null> {
  if (!localStorage.getItem(TOKEN_KEY)) return null
  try {
    const session = await request<Session>('/api/auth/refresh', { method: 'POST' })
    localStorage.setItem(TOKEN_KEY, session.token)
    localStorage.setItem(USER_KEY, JSON.stringify(session.user))
    return session.user
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) { logout(); return null }
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') as UserAccount | null } catch { return null }
  }
}

export function logout() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY) }

export const acceptLegalConsent = async () => {
  const user = await request<UserAccount>('/api/auth/consent', { method: 'POST', body: JSON.stringify({ privacyAccepted: true }) })
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  return user
}

export type PushConfig = { enabled: boolean, publicKey: string | null }
export const getPushConfig = () => request<PushConfig>('/api/notifications/config')
export const savePushSubscription = (subscription: PushSubscriptionJSON, timezone: string) => request<{ ok: boolean }>('/api/notifications/subscribe', { method: 'POST', body: JSON.stringify({ subscription, timezone }) })
export async function exportAccountData() {
  const data = await request<unknown>('/api/account/export')
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = `ruta-segura-datos-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url)
}
export const deleteOwnAccount = (password: string) => request<{ ok: boolean }>('/api/account', { method: 'DELETE', body: JSON.stringify({ password }) }).then(() => undefined)

export const generatePairingCode = () => request<{ code: string, expiresAt: string }>('/api/pairing/code', { method: 'POST' })
export const claimPairingCode = (code: string) => request<{ ok: boolean, usuario: LinkedUsuario }>('/api/pairing/claim', { method: 'POST', body: JSON.stringify({ code }) })
export const loadLinkedUsuarios = () => request<LinkedUsuario[]>('/api/pairing/links')
export const unlinkUsuario = (usuarioId: string) => request<{ ok: boolean }>(`/api/pairing/links/${usuarioId}`, { method: 'DELETE' }).then(() => undefined)

export const loadRoutes = () => request<Route[]>('/api/routes')
export const loadMyRoutes = () => request<Route[]>('/api/routes/mine')
export type RouteInput = { usuarioId: string, label: string, points: { lat: number, lng: number }[], corridorWidthMeters: number }
export type RouteUpdateInput = { label: string, points: { lat: number, lng: number }[], corridorWidthMeters: number, active: boolean }
export const createRoute = (data: RouteInput) => request<Route>('/api/routes', { method: 'POST', body: JSON.stringify(data) })
export const updateRoute = (id: string, data: RouteUpdateInput) => request<Route>(`/api/routes/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
export const deleteRoute = (id: string) => request<{ ok: boolean }>(`/api/routes/${id}`, { method: 'DELETE' }).then(() => undefined)

export type ScheduleInput = Omit<Schedule, 'id' | 'routeId'>
export const createSchedule = (routeId: string, data: ScheduleInput) => request<Schedule>(`/api/routes/${routeId}/schedules`, { method: 'POST', body: JSON.stringify(data) })
export const updateSchedule = (id: string, data: ScheduleInput) => request<Schedule>(`/api/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
export const deleteSchedule = (id: string) => request<{ ok: boolean }>(`/api/schedules/${id}`, { method: 'DELETE' }).then(() => undefined)
