import crypto from 'node:crypto'

const rawKey = process.env.ENCRYPTION_KEY || ''
const key = Buffer.from(rawKey, 'hex')
if (key.length !== 32) throw new Error('ENCRYPTION_KEY debe contener exactamente 64 caracteres hexadecimales')

const PREFIX = 'enc:v1:'

export function isEncrypted(value: string) { return value.startsWith(PREFIX) }

export function encryptValue(value: string) {
  if (!value || isEncrypted(value)) return value
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`
}

export function decryptValue(value: string) {
  if (!value || !isEncrypted(value)) return value
  const parts = value.slice(PREFIX.length).split(':')
  if (parts.length !== 3) throw new Error('Formato de dato cifrado no válido')
  const [iv, tag, encrypted] = parts.map(part => Buffer.from(part, 'base64url'))
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
