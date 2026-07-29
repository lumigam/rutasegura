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
  fontSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"],
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
