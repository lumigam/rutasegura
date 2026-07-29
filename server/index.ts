import 'express-async-errors'
import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { PrismaClient, Role } from '@prisma/client'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import webpush from 'web-push'
import { decryptValue, encryptValue } from './crypto.js'

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

app.get('/api/health', async (_req, res) => { await prisma.$queryRaw`SELECT 1`; res.json({ ok: true, pushEnabled }) })
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
  corridorWidthMeters: z.number().int().min(10).max(500).default(75),
})
const routeUpdateSchema = z.object({
  label: z.string().trim().min(1).max(140),
  points: z.array(pointSchema).min(2).max(500),
  corridorWidthMeters: z.number().int().min(10).max(500),
  active: z.boolean(),
})
const scheduleSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  windowMinutesBefore: z.number().int().min(0).max(180).default(15),
  windowMinutesAfter: z.number().int().min(0).max(180).default(45),
  estimatedArrivalMinutes: z.number().int().min(1).max(240).nullable().default(null),
  arrivalToleranceMinutes: z.number().int().min(5).max(120).default(20),
  active: z.boolean().default(true),
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
    points: parsed.data.points, corridorWidthMeters: parsed.data.corridorWidthMeters,
  }, include: { schedules: true } })
  res.status(201).json(decryptRoute(route))
})
app.patch('/api/routes/:id', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  const parsed = routeUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Datos de ruta no válidos', details: parsed.error.flatten() })
  const existing = await prisma.route.findFirst({ where: { id: String(req.params.id), tutorId: req.user!.id } })
  if (!existing) return res.status(404).json({ error: 'Ruta no encontrada' })
  const route = await prisma.route.update({ where: { id: existing.id }, data: {
    label: encryptValue(parsed.data.label), points: parsed.data.points,
    corridorWidthMeters: parsed.data.corridorWidthMeters, active: parsed.data.active,
  }, include: { schedules: true } })
  res.json(decryptRoute(route))
})
app.delete('/api/routes/:id', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  await prisma.route.deleteMany({ where: { id: String(req.params.id), tutorId: req.user!.id } })
  res.json({ ok: true })
})

app.post('/api/routes/:routeId/schedules', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  const parsed = scheduleSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Datos de horario no válidos', details: parsed.error.flatten() })
  const route = await prisma.route.findFirst({ where: { id: String(req.params.routeId), tutorId: req.user!.id } })
  if (!route) return res.status(404).json({ error: 'Ruta no encontrada' })
  const schedule = await prisma.schedule.create({ data: { routeId: route.id, ...parsed.data } })
  res.status(201).json(schedule)
})
app.patch('/api/schedules/:id', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  const parsed = scheduleSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Datos de horario no válidos', details: parsed.error.flatten() })
  const existing = await prisma.schedule.findFirst({ where: { id: String(req.params.id), route: { tutorId: req.user!.id } } })
  if (!existing) return res.status(404).json({ error: 'Horario no encontrado' })
  const schedule = await prisma.schedule.update({ where: { id: existing.id }, data: parsed.data })
  res.json(schedule)
})
app.delete('/api/schedules/:id', authenticate, consentRequired, tutorOnly, async (req: AuthRequest, res) => {
  const existing = await prisma.schedule.findFirst({ where: { id: String(req.params.id), route: { tutorId: req.user!.id } } })
  if (!existing) return res.status(404).json({ error: 'Horario no encontrado' })
  await prisma.schedule.delete({ where: { id: existing.id } })
  res.json({ ok: true })
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

async function start() {
  await prisma.$connect()
  await ensureAdmin()
  app.listen(port, '0.0.0.0', () => console.log(`Ruta Segura escuchando en el puerto ${port}`))
}
start().catch(error => { console.error('No se pudo iniciar la aplicación', error); process.exit(1) })
