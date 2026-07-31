import 'express-async-errors'
import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { PrismaClient, Role, ScheduleKind, TravelMode, TripStatus } from '@prisma/client'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import webpush from 'web-push'
import { cert, initializeApp } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import { decryptValue, encryptValue } from './crypto.js'
import { localScheduleParts, scheduledInstant } from './schedule.js'

const prisma = new PrismaClient()
const app = express()
const port = Number(process.env.PORT || 3000)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const jwtSecret = process.env.JWT_SECRET
if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres')
const CONSENT_VERSION = '2026-07-29-v1'
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY?.trim() || ''
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY?.trim() || ''
const pushEnabled = Boolean(vapidPublicKey && vapidPrivateKey)
if (pushEnabled) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://rutasegura.placeat.org', vapidPublicKey, vapidPrivateKey)
else if (vapidPublicKey || vapidPrivateKey) console.warn('Web Push desactivado: deben configurarse VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY')

const firebaseServiceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim() || ''
const liveEnabled = Boolean(firebaseServiceAccountBase64)
if (liveEnabled) {
  const serviceAccount = JSON.parse(Buffer.from(firebaseServiceAccountBase64, 'base64').toString('utf8'))
  initializeApp({ credential: cert(serviceAccount) })
} else console.warn('"Ver ahora" desactivado: falta FIREBASE_SERVICE_ACCOUNT_BASE64')

const LIVE_REQUEST_TTL_MS = 60_000
type LiveRequest = { tutorId: string, usuarioId: string, status: 'pending' | 'done' | 'expired', lat?: number, lng?: number, createdAt: number }
const liveRequests = new Map<string, LiveRequest>()
function pruneLiveRequests() {
  const cutoff = Date.now() - 5 * 60_000
  for (const [id, entry] of liveRequests) if (entry.createdAt < cutoff) liveRequests.delete(id)
}

type AuthRequest = express.Request & { user?: { id: string, role: Role, privacyAcceptedAt: Date | null, consentVersion: string | null } }
const publicUser = { id: true, email: true, name: true, role: true, active: true, privacyAcceptedAt: true, consentVersion: true, timezone: true, createdAt: true } as const

app.set('trust proxy', 1)
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin === 'https://localhost') {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
  }
  next()
})
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
  fontSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org'], connectSrc: ["'self'", 'https://nominatim.openstreetmap.org'],
  objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
} } }))
app.use(express.json({ limit: '100kb' }))
app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false }))

const credentialsSchema = z.object({ email: z.string().trim().email().max(200).transform(v => v.toLowerCase()), password: z.string().min(8).max(100) })
const registerSchema = credentialsSchema.extend({
  name: z.string().trim().min(2).max(100), password: z.string().min(10).max(100),
  role: z.nativeEnum(Role).default(Role.USUARIO), privacyAccepted: z.literal(true),
})

function tokenFor(user: { id: string, role: Role }) { return jwt.sign({ role: user.role }, jwtSecret!, { subject: user.id, expiresIn: '365d' }) }
async function authenticate(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Debes iniciar sesión' })
  try {
    const payload = jwt.verify(token, jwtSecret!) as jwt.JwtPayload
    const user = await prisma.user.findUnique({ where: { id: String(payload.sub) }, select: { id: true, role: true, active: true, privacyAcceptedAt: true, consentVersion: true } })
    if (!user?.active) return res.status(401).json({ error: 'Cuenta no disponible' })
    req.user = { id: user.id, role: user.role, privacyAcceptedAt: user.privacyAcceptedAt, consentVersion: user.consentVersion }
    next()
  } catch { res.status(401).json({ error: 'La sesión no es válida' }) }
}
function consentRequired(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  if (!req.user?.privacyAcceptedAt || req.user.consentVersion !== CONSENT_VERSION) return res.status(403).json({ error: 'Debes aceptar la política de privacidad' })
  next()
}
function tutorOnly(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  if (req.user?.role !== Role.TUTOR) return res.status(403).json({ error: 'Acceso reservado a la persona tutora' })
  next()
}
function usuarioOnly(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  if (req.user?.role !== Role.USUARIO) return res.status(403).json({ error: 'Acceso reservado a la persona usuaria' })
  next()
}
function randomPairingCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)]
  return code
}
function decryptRoute<T extends { label: string }>(item: T) { return { ...item, label: decryptValue(item.label) } }

async function sendPushToUser(userId: string, message: { title: string, body: string, tag: string }) {
  if (!pushEnabled) return
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } })
  const payload = JSON.stringify({ title: message.title, body: message.body, tag: message.tag, url: '/' })
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 300, urgency: 'high' })
    } catch (cause) {
      const statusCode = typeof cause === 'object' && cause && 'statusCode' in cause ? Number(cause.statusCode) : 0
      if (statusCode === 404 || statusCode === 410) await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => undefined)
      else console.error('No se pudo enviar un aviso push', cause)
    }
  }
}

app.get('/api/health', async (_req, res) => { await prisma.$queryRaw`SELECT 1`; res.json({ ok: true, pushEnabled, liveEnabled }) })
app.post('/api/auth/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Revisa el nombre, correo y contraseña' })
  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } })
  if (exists) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo' })
  const now = new Date()
  const user = await prisma.user.create({ data: {
    name: parsed.data.name, email: parsed.data.email, role: parsed.data.role,
    passwordHash: await bcrypt.hash(parsed.data.password, 12), privacyAcceptedAt: now, consentVersion: CONSENT_VERSION,
  }, select: publicUser })
  res.status(201).json({ user, token: tokenFor(user) })
})
app.post('/api/auth/login', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Correo o contraseña no válidos' })
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })
  if (!user || !user.active || !await bcrypt.compare(parsed.data.password, user.passwordHash)) return res.status(401).json({ error: 'Correo o contraseña incorrectos' })
  const { passwordHash: _password, updatedAt: _updated, pairingCode: _pairingCode, pairingCodeExpiresAt: _pairingCodeExpiresAt, ...safeUser } = user
  res.json({ user: safeUser, token: tokenFor(user) })
})
app.get('/api/auth/me', authenticate, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: publicUser })
  if (!user?.active) return res.status(401).json({ error: 'Cuenta no disponible' })
  res.json(user)
})
app.post('/api/auth/refresh', authenticate, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: publicUser })
  if (!user?.active) return res.status(401).json({ error: 'Cuenta no disponible' })
  res.json({ user, token: tokenFor(user) })
})
app.post('/api/auth/consent', authenticate, async (req: AuthRequest, res) => {
  const parsed = z.object({ privacyAccepted: z.literal(true) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Debes aceptar la política de privacidad' })
  const now = new Date()
  const user = await prisma.user.update({ where: { id: req.user!.id }, data: { privacyAcceptedAt: now, consentVersion: CONSENT_VERSION }, select: publicUser })
  res.json(user)
})
app.get('/api/account/export', authenticate, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: publicUser })
  res.setHeader('Content-Disposition', 'attachment; filename="ruta-segura-datos.json"')
  res.json({ exportedAt: new Date().toISOString(), user })
})
app.delete('/api/account', authenticate, async (req: AuthRequest, res) => {
  const parsed = z.object({ password: z.string().min(8).max(100) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Debes indicar tu contraseña' })
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user || !await bcrypt.compare(parsed.data.password, user.passwordHash)) return res.status(401).json({ error: 'La contraseña no es correcta' })
  await prisma.user.delete({ where: { id: user.id } })
  res.json({ ok: true })
})

const pushSubscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(4096),
    keys: z.object({ p256dh: z.string().min(20).max(500), auth: z.string().min(8).max(200) }),
  }),
  timezone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat('es-ES', { timeZone: value }).format(); return true } catch { return false }
  }),
})
app.get('/api/notifications/config', (_req, res) => res.json({ enabled: pushEnabled, publicKey: pushEnabled ? vapidPublicKey : null }))
app.post('/api/notifications/subscribe', authenticate, consentRequired, async (req: AuthRequest, res) => {
  if (!pushEnabled) return res.status(503).json({ error: 'Las notificaciones push todavía no están configuradas en el servidor' })
  const parsed = pushSubscriptionSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Suscripción de notificaciones no válida' })
  const { endpoint, keys } = parsed.data.subscription
  await prisma.$transaction([
    prisma.user.update({ where: { id: req.user!.id }, data: { timezone: parsed.data.timezone } }),
    prisma.pushSubscription.upsert({ where: { endpoint }, update: { p256dh: keys.p256dh, auth: keys.auth, userId: req.user!.id }, create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, userId: req.user!.id } }),
  ])
  res.json({ ok: true })
})

const pointSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
const routeSchema = z.object({
  usuarioId: z.string().uuid(),
  label: z.string().trim().min(1).max(140),
  points: z.array(pointSchema).min(2).max(500),
  mode: z.nativeEnum(TravelMode).default('WALK'),
  corridorWidthMeters: z.number().int().min(10).max(500).default(75),
})
const routeUpdateSchema = z.object({
  label: z.string().trim().min(1).max(140),
  points: z.array(pointSchema).min(2).max(500),
  mode: z.nativeEnum(TravelMode),
  corridorWidthMeters: z.number().int().min(10).max(500),
  active: z.boolean(),
})
const scheduleSchema = z.object({
  kind: z.nativeEnum(ScheduleKind).default('WEEKLY'),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  windowMinutesBefore: z.number().int().min(0).max(180).default(15),
  windowMinutesAfter: z.number().int().min(0).max(180).default(45),
  estimatedArrivalMinutes: z.number().int().min(1).max(240).nullable().default(null),
  arrivalToleranceMinutes: z.number().int().min(5).max(120).default(20),
  active: z.boolean().default(true),
}).refine(data => data.kind !== 'WEEKLY' || (data.days?.length && data.time), { message: 'Selecciona los días y la hora' })
const directionsSchema = z.object({
  mode: z.nativeEnum(TravelMode),
  origin: pointSchema,
  destination: pointSchema,
})

app.post('/api/pairing/code', authenticate, consentRequired, usuarioOnly, async (req: AuthRequest, res) => {
  const code = randomPairingCode()
  const expiresAt = new Date(Date.now() + 15 * 60_000)
  await prisma.user.update({ where: { id: req.user!.id }, data: { pairingCode: code, pairingCodeExpiresAt: expiresAt } })
  res.json({ code, expiresAt })
})
app.post('/api/pairing/claim', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  const parsed = z.object({ code: z.string().trim().toUpperCase().length(6) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Código no válido' })
  const usuario = await prisma.user.findFirst({ where: { pairingCode: parsed.data.code, pairingCodeExpiresAt: { gt: new Date() }, role: Role.USUARIO } })
  if (!usuario) return res.status(404).json({ error: 'El código no es válido o ha caducado' })
  await prisma.$transaction([
    prisma.link.upsert({ where: { tutorId_usuarioId: { tutorId: req.user!.id, usuarioId: usuario.id } }, update: {}, create: { tutorId: req.user!.id, usuarioId: usuario.id } }),
    prisma.user.update({ where: { id: usuario.id }, data: { pairingCode: null, pairingCodeExpiresAt: null } }),
  ])
  res.json({ ok: true, usuario: { id: usuario.id, name: usuario.name } })
})
app.get('/api/pairing/links', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  const links = await prisma.link.findMany({ where: { tutorId: req.user!.id }, include: { usuario: { select: { id: true, name: true, email: true } } } })
  res.json(links.map(l => l.usuario))
})
app.delete('/api/pairing/links/:usuarioId', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  await prisma.$transaction([
    prisma.route.deleteMany({ where: { tutorId: req.user!.id, usuarioId: String(req.params.usuarioId) } }),
    prisma.link.deleteMany({ where: { tutorId: req.user!.id, usuarioId: String(req.params.usuarioId) } }),
  ])
  res.json({ ok: true })
})

app.get('/api/routes', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  const routes = await prisma.route.findMany({ where: { tutorId: req.user!.id }, include: { schedules: true }, orderBy: { createdAt: 'asc' } })
  res.json(routes.map(decryptRoute))
})
app.get('/api/routes/mine', authenticate, consentRequired, usuarioOnly, async (req: AuthRequest, res) => {
  const routes = await prisma.route.findMany({ where: { usuarioId: req.user!.id, active: true }, include: { schedules: true }, orderBy: { createdAt: 'asc' } })
  res.json(routes.map(decryptRoute))
})
app.post('/api/routes', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  const parsed = routeSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Datos de ruta no válidos', details: parsed.error.flatten() })
  const link = await prisma.link.findUnique({ where: { tutorId_usuarioId: { tutorId: req.user!.id, usuarioId: parsed.data.usuarioId } } })
  if (!link) return res.status(403).json({ error: 'Esa persona usuaria no está vinculada a tu cuenta' })
  const route = await prisma.route.create({ data: {
    tutorId: req.user!.id, usuarioId: parsed.data.usuarioId, label: encryptValue(parsed.data.label),
    points: parsed.data.points, mode: parsed.data.mode, corridorWidthMeters: parsed.data.corridorWidthMeters,
  }, include: { schedules: true } })
  res.status(201).json(decryptRoute(route))
})
app.patch('/api/routes/:id', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  const parsed = routeUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Datos de ruta no válidos', details: parsed.error.flatten() })
  const existing = await prisma.route.findFirst({ where: { id: String(req.params.id), tutorId: req.user!.id } })
  if (!existing) return res.status(404).json({ error: 'Ruta no encontrada' })
  const route = await prisma.route.update({ where: { id: existing.id }, data: {
    label: encryptValue(parsed.data.label), points: parsed.data.points, mode: parsed.data.mode,
    corridorWidthMeters: parsed.data.corridorWidthMeters, active: parsed.data.active,
  }, include: { schedules: true } })
  res.json(decryptRoute(route))
})
app.delete('/api/routes/:id', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  await prisma.route.deleteMany({ where: { id: String(req.params.id), tutorId: req.user!.id } })
  res.json({ ok: true })
})

const ORS_PROFILES: Record<TravelMode, string> = { WALK: 'foot-walking', CAR: 'driving-car' }
const orsApiKey = process.env.ORS_API_KEY?.trim() || ''
app.get('/api/routes/directions/config', (_req, res) => res.json({ enabled: Boolean(orsApiKey) }))
app.post('/api/routes/directions', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  if (!orsApiKey) return res.status(503).json({ error: 'El cálculo automático de rutas todavía no está configurado en el servidor' })
  const parsed = directionsSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Puntos de origen o destino no válidos' })
  const profile = ORS_PROFILES[parsed.data.mode]
  let orsResponse: Response
  try {
    orsResponse = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
      method: 'POST',
      headers: { Authorization: orsApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [
        [parsed.data.origin.lng, parsed.data.origin.lat],
        [parsed.data.destination.lng, parsed.data.destination.lat],
      ] }),
    })
  } catch { return res.status(502).json({ error: 'No se pudo contactar con el servicio de rutas' }) }
  if (!orsResponse.ok) {
    const body = await orsResponse.text()
    console.error(`OpenRouteService devolvió ${orsResponse.status}:`, body)
    const reason = (() => { try { return JSON.parse(body)?.error?.message || JSON.parse(body)?.error } catch { return null } })()
    return res.status(502).json({ error: reason ? `No se ha podido calcular la ruta: ${reason}` : 'No se ha podido calcular una ruta entre esos dos puntos' })
  }
  const geojson = await orsResponse.json() as { features?: { geometry?: { coordinates?: [number, number][] }, properties?: { summary?: { distance?: number, duration?: number } } }[] }
  const coordinates = geojson.features?.[0]?.geometry?.coordinates
  if (!coordinates?.length) return res.status(502).json({ error: 'No se ha podido calcular una ruta entre esos dos puntos' })
  const summary = geojson.features?.[0]?.properties?.summary
  res.json({ points: coordinates.map(([lng, lat]) => ({ lat, lng })), distanceMeters: summary?.distance ?? null, durationSeconds: summary?.duration ?? null })
})

/** For a ONCE schedule, "days"/"time" are computed from the current instant (in the usuario's timezone) instead of chosen by the tutor. */
function onceScheduleFields(timezone: string) {
  const now = localScheduleParts(new Date(), timezone)
  return { days: [now.day], time: now.time, windowMinutesBefore: 0 }
}
app.post('/api/routes/:routeId/schedules', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  const parsed = scheduleSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Datos de horario no válidos', details: parsed.error.flatten() })
  const route = await prisma.route.findFirst({ where: { id: String(req.params.routeId), tutorId: req.user!.id }, include: { usuario: true } })
  if (!route) return res.status(404).json({ error: 'Ruta no encontrada' })
  const data = parsed.data.kind === 'ONCE'
    ? { ...parsed.data, ...onceScheduleFields(route.usuario.timezone) }
    : { ...parsed.data, days: parsed.data.days!, time: parsed.data.time! }
  const schedule = await prisma.schedule.create({ data: { routeId: route.id, ...data } })
  res.status(201).json(schedule)
})
app.patch('/api/schedules/:id', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  const parsed = scheduleSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Datos de horario no válidos', details: parsed.error.flatten() })
  const existing = await prisma.schedule.findFirst({ where: { id: String(req.params.id), route: { tutorId: req.user!.id } }, include: { route: { include: { usuario: true } } } })
  if (!existing) return res.status(404).json({ error: 'Horario no encontrado' })
  const data = parsed.data.kind === 'ONCE'
    ? { ...parsed.data, ...onceScheduleFields(existing.route.usuario.timezone) }
    : { ...parsed.data, days: parsed.data.days!, time: parsed.data.time! }
  const schedule = await prisma.schedule.update({ where: { id: existing.id }, data })
  res.json(schedule)
})
app.delete('/api/schedules/:id', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  const existing = await prisma.schedule.findFirst({ where: { id: String(req.params.id), route: { tutorId: req.user!.id } } })
  if (!existing) return res.status(404).json({ error: 'Horario no encontrado' })
  await prisma.schedule.delete({ where: { id: existing.id } })
  res.json({ ok: true })
})

const tripEventSchema = z.object({
  scheduleId: z.string().uuid(),
  type: z.enum(['DEPARTED', 'ARRIVED', 'DEVIATED', 'SOS']),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
})
const EVENT_MESSAGES: Record<string, { title: string, body: string }> = {
  DEPARTED: { title: '📍 Ha salido', body: 'Ha salido de camino según lo programado.' },
  ARRIVED: { title: '✅ Ha llegado', body: 'Ha llegado a su destino.' },
  DEVIATED: { title: '⚠️ Se ha desviado', body: 'Parece que se ha apartado del camino habitual.' },
  SOS: { title: '🆘 Aviso urgente', body: 'Se ha activado un aviso de ayuda.' },
}
app.post('/api/trips/events', authenticate, consentRequired, usuarioOnly, async (req: AuthRequest, res) => {
  const parsed = tripEventSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Evento no válido' })
  const schedule = await prisma.schedule.findFirst({
    where: { id: parsed.data.scheduleId, route: { usuarioId: req.user!.id } },
    include: { route: { include: { usuario: true } } },
  })
  if (!schedule) return res.status(404).json({ error: 'Horario no encontrado' })
  const scheduledFor = scheduledInstant(new Date(), schedule.route.usuario.timezone, schedule.time)
  const trip = await prisma.trip.upsert({
    where: { scheduleId_scheduledFor: { scheduleId: schedule.id, scheduledFor } },
    update: {}, create: { routeId: schedule.routeId, scheduleId: schedule.id, scheduledFor },
  })
  const data: { status?: TripStatus, startedAt?: Date, endedAt?: Date } = {}
  if (parsed.data.type === 'DEPARTED' && trip.status === TripStatus.NOT_STARTED) { data.status = TripStatus.IN_PROGRESS; data.startedAt = new Date() }
  else if (parsed.data.type === 'ARRIVED') { data.status = TripStatus.ARRIVED; data.endedAt = new Date() }
  else if (parsed.data.type === 'DEVIATED' && trip.status !== TripStatus.ARRIVED) { data.status = TripStatus.DEVIATED }
  if (Object.keys(data).length) await prisma.trip.update({ where: { id: trip.id }, data })
  if (parsed.data.type === 'ARRIVED' && schedule.kind === 'ONCE') await prisma.schedule.update({ where: { id: schedule.id }, data: { active: false } })
  await prisma.tripEvent.create({ data: { tripId: trip.id, type: parsed.data.type, lat: parsed.data.lat, lng: parsed.data.lng } })
  const message = EVENT_MESSAGES[parsed.data.type]
  await sendPushToUser(schedule.route.tutorId, { ...message, tag: `trip-${trip.id}-${parsed.data.type}` })
  res.json({ ok: true })
})

app.get('/api/live/config', (_req, res) => res.json({ enabled: liveEnabled }))
app.post('/api/live/token', authenticate, consentRequired, usuarioOnly, async (req: AuthRequest, res) => {
  const parsed = z.object({ token: z.string().min(20).max(4096) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Token no válido' })
  await prisma.fcmToken.upsert({ where: { token: parsed.data.token }, update: { userId: req.user!.id }, create: { token: parsed.data.token, userId: req.user!.id } })
  res.json({ ok: true })
})
app.post('/api/live/request', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  if (!liveEnabled) return res.status(503).json({ error: 'La ubicación bajo demanda todavía no está configurada en el servidor' })
  const parsed = z.object({ usuarioId: z.string().uuid() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Persona usuaria no válida' })
  const link = await prisma.link.findUnique({ where: { tutorId_usuarioId: { tutorId: req.user!.id, usuarioId: parsed.data.usuarioId } } })
  if (!link) return res.status(403).json({ error: 'Esa persona usuaria no está vinculada a tu cuenta' })
  const tokens = await prisma.fcmToken.findMany({ where: { userId: parsed.data.usuarioId } })
  if (!tokens.length) return res.status(404).json({ error: 'Esa persona usuaria no tiene la aplicación con las notificaciones activadas' })
  pruneLiveRequests()
  const requestId = randomUUID()
  const createdAt = Date.now()
  liveRequests.set(requestId, { tutorId: req.user!.id, usuarioId: parsed.data.usuarioId, status: 'pending', createdAt })
  await Promise.all(tokens.map(async token => {
    try {
      await getMessaging().send({ token: token.token, data: { type: 'LOCATE_REQUEST', requestId }, android: { priority: 'high' } })
    } catch (cause) {
      const code = typeof cause === 'object' && cause && 'code' in cause ? String(cause.code) : ''
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') await prisma.fcmToken.delete({ where: { id: token.id } }).catch(() => undefined)
      else console.error('No se pudo enviar el mensaje de ubicación', cause)
    }
  }))
  res.json({ requestId, expiresAt: new Date(createdAt + LIVE_REQUEST_TTL_MS).toISOString() })
})
app.post('/api/live/location', authenticate, consentRequired, usuarioOnly, async (req: AuthRequest, res) => {
  const parsed = z.object({ requestId: z.string().uuid(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Datos no válidos' })
  const entry = liveRequests.get(parsed.data.requestId)
  if (!entry || entry.usuarioId !== req.user!.id) return res.status(404).json({ error: 'Solicitud no encontrada' })
  if (Date.now() - entry.createdAt > LIVE_REQUEST_TTL_MS) { entry.status = 'expired'; return res.status(410).json({ error: 'La solicitud ha caducado' }) }
  entry.status = 'done'; entry.lat = parsed.data.lat; entry.lng = parsed.data.lng
  res.json({ ok: true })
})
app.get('/api/live/:requestId', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  const entry = liveRequests.get(String(req.params.requestId))
  if (!entry || entry.tutorId !== req.user!.id) return res.status(404).json({ error: 'Solicitud no encontrada' })
  if (entry.status === 'pending' && Date.now() - entry.createdAt > LIVE_REQUEST_TTL_MS) entry.status = 'expired'
  res.json({ status: entry.status, lat: entry.lat, lng: entry.lng })
})

app.use(express.static(path.join(root, 'dist')))
app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error)
  if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') return res.status(409).json({ error: 'Ese correo ya está registrado' })
  res.status(500).json({ error: 'Error interno del servidor' })
})

async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  if (!email) throw new Error('ADMIN_EMAIL es obligatorio')
  const password = process.env.ADMIN_PASSWORD
  if (!password || password.length < 10) throw new Error('ADMIN_PASSWORD debe tener al menos 10 caracteres')
  const existing = await prisma.user.findUnique({ where: { email } })
  if (!existing) await prisma.user.create({ data: { email, name: process.env.ADMIN_NAME || 'Administrador', passwordHash: await bcrypt.hash(password, 12), role: Role.TUTOR, privacyAcceptedAt: new Date(), consentVersion: CONSENT_VERSION } })
  else {
    const passwordChanged = !await bcrypt.compare(password, existing.passwordHash)
    await prisma.user.update({ where: { id: existing.id }, data: {
      role: Role.TUTOR, active: true, name: process.env.ADMIN_NAME || existing.name,
      ...(passwordChanged ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
    } })
  }
}

let scheduleCheckRunning = false
async function checkScheduleAlerts() {
  if (!pushEnabled || scheduleCheckRunning) return
  scheduleCheckRunning = true
  try {
    const now = new Date()
    const schedules = await prisma.schedule.findMany({
      where: { active: true, route: { active: true } },
      include: { route: { include: { usuario: true } } },
    })
    for (const schedule of schedules) {
      const timezone = schedule.route.usuario.timezone
      const local = localScheduleParts(now, timezone)
      if (!schedule.days.includes(local.day)) continue
      const scheduledFor = scheduledInstant(now, timezone, schedule.time)
      const trip = await prisma.trip.upsert({
        where: { scheduleId_scheduledFor: { scheduleId: schedule.id, scheduledFor } },
        update: {}, create: { routeId: schedule.routeId, scheduleId: schedule.id, scheduledFor },
        include: { events: true },
      })
      if (trip.events.some(event => event.type === 'DELAYED')) continue

      const notDepartedDeadline = new Date(scheduledFor.getTime() + schedule.windowMinutesAfter * 60_000)
      if (trip.status === TripStatus.NOT_STARTED && now > notDepartedDeadline) {
        await prisma.$transaction([
          prisma.trip.update({ where: { id: trip.id }, data: { status: TripStatus.DELAYED } }),
          prisma.tripEvent.create({ data: { tripId: trip.id, type: 'DELAYED' } }),
          ...(schedule.kind === 'ONCE' ? [prisma.schedule.update({ where: { id: schedule.id }, data: { active: false } })] : []),
        ])
        await sendPushToUser(schedule.route.tutorId, { title: '⏰ No ha salido', body: 'No ha salido todavía a la hora prevista.', tag: `trip-${trip.id}-no-departure` })
        continue
      }

      if (trip.status === TripStatus.IN_PROGRESS && schedule.estimatedArrivalMinutes != null) {
        const base = trip.startedAt ?? scheduledFor
        const deadline = new Date(base.getTime() + (schedule.estimatedArrivalMinutes + schedule.arrivalToleranceMinutes) * 60_000)
        if (now > deadline) {
          await prisma.$transaction([
            prisma.trip.update({ where: { id: trip.id }, data: { status: TripStatus.DELAYED } }),
            prisma.tripEvent.create({ data: { tripId: trip.id, type: 'DELAYED' } }),
            ...(schedule.kind === 'ONCE' ? [prisma.schedule.update({ where: { id: schedule.id }, data: { active: false } })] : []),
          ])
          const lateMinutes = trip.startedAt ? Math.round((trip.startedAt.getTime() - scheduledFor.getTime()) / 60_000) : 0
          const expected = new Date(deadline.getTime()).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: timezone })
          const body = lateMinutes > 0 ? `Aún no ha llegado. Salió ${lateMinutes} min tarde, se esperaba sobre las ${expected}.` : 'Aún no ha llegado a la hora prevista.'
          await sendPushToUser(schedule.route.tutorId, { title: '⏰ Retraso en la llegada', body, tag: `trip-${trip.id}-delayed-arrival` })
        }
      }
    }
  } finally { scheduleCheckRunning = false }
}

async function start() {
  await prisma.$connect()
  await ensureAdmin()
  app.listen(port, '0.0.0.0', () => console.log(`Ruta Segura escuchando en el puerto ${port}`))
  void checkScheduleAlerts()
  setInterval(() => void checkScheduleAlerts(), 60_000)
}
start().catch(error => { console.error('No se pudo iniciar la aplicación', error); process.exit(1) })
