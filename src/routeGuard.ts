import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Route } from './types'

export type RouteGuardStatus = {
  foregroundLocation: boolean
  backgroundLocation: boolean
  playServicesAvailable: boolean
  activeRouteCount: number
}

type RouteGuardScheduleInput = {
  id: string
  days: number[]
  time: string
  windowMinutesBefore: number
  windowMinutesAfter: number
}
type RouteGuardRouteInput = {
  id: string
  points: { lat: number, lng: number }[]
  mode: string
  corridorWidthMeters: number
  schedules: RouteGuardScheduleInput[]
}

interface RouteGuardNativePlugin {
  status(): Promise<RouteGuardStatus>
  requestForegroundLocation(): Promise<RouteGuardStatus>
  requestBackgroundLocation(): Promise<RouteGuardStatus>
  openLocationSettings(): Promise<void>
  updateSession(options: { token: string, apiBaseUrl: string }): Promise<void>
  syncRoutes(options: { routes: RouteGuardRouteInput[] }): Promise<RouteGuardStatus>
  stopAll(): Promise<void>
  registerLiveToken(): Promise<void>
}

const RouteGuard = registerPlugin<RouteGuardNativePlugin>('RouteGuard')

export const isNativeAndroid = () => Capacitor.getPlatform() === 'android'
export const getRouteGuardStatus = () => RouteGuard.status()
export const requestForegroundLocation = () => RouteGuard.requestForegroundLocation()
export const requestBackgroundLocation = () => RouteGuard.requestBackgroundLocation()
export const openLocationSettings = () => RouteGuard.openLocationSettings()
export const updateRouteGuardSession = (token: string, apiBaseUrl: string) => RouteGuard.updateSession({ token, apiBaseUrl })
export const stopRouteGuard = () => RouteGuard.stopAll()
export const registerLiveLocationToken = () => RouteGuard.registerLiveToken().catch(() => undefined)

export function syncRouteGuardRoutes(routes: Route[]) {
  if (!isNativeAndroid()) return Promise.resolve(null)
  const input: RouteGuardRouteInput[] = routes.filter(route => route.active).map(route => ({
    id: route.id,
    points: route.points,
    mode: route.mode,
    corridorWidthMeters: route.corridorWidthMeters,
    schedules: route.schedules.filter(schedule => schedule.active).map(schedule => ({
      id: schedule.id, days: schedule.days, time: schedule.time,
      windowMinutesBefore: schedule.windowMinutesBefore, windowMinutesAfter: schedule.windowMinutesAfter,
    })),
  }))
  return RouteGuard.syncRoutes({ routes: input })
}
