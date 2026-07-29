import { getPushConfig, savePushSubscription } from './storage'

const ALERTS_KEY = 'rutasegura:alerts-enabled:v1'

function applicationServerKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0))
}

export function alertsWereEnabled() { return localStorage.getItem(ALERTS_KEY) === 'true' }

export async function enablePushNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    localStorage.setItem(ALERTS_KEY, 'true')
    return { push: false, reason: 'unsupported' as const }
  }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return { push: false, reason: permission === 'denied' ? 'denied' as const : 'dismissed' as const }
  const config = await getPushConfig()
  if (!config.enabled || !config.publicKey) return { push: false, reason: 'server' as const }
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(config.publicKey),
  })
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid'
  await savePushSubscription(subscription.toJSON(), timezone)
  localStorage.setItem(ALERTS_KEY, 'true')
  return { push: true, reason: null }
}

export async function restorePushSubscription() {
  if (!alertsWereEnabled() || !('Notification' in window) || Notification.permission !== 'granted') return false
  try {
    const config = await getPushConfig()
    if (!config.enabled || !config.publicKey) return false
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(config.publicKey),
    })
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid'
    await savePushSubscription(subscription.toJSON(), timezone)
    return true
  } catch { return false }
}
