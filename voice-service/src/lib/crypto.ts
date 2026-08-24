import { randomBytes, createHash, createHmac, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { config } from '../config.js';

/** Generates a URL-safe random token (raw — only ever placed in an email link, never persisted). */
export function generateVerificationToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest — what actually gets persisted in verification_token_hash. */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** Constant-time hash comparison to avoid timing side-channels on token lookups. */
export function tokensMatch(hashA: string, hashB: string): boolean {
  const bufA = Buffer.from(hashA, 'hex');
  const bufB = Buffer.from(hashB, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** HMAC-SHA256 signing, used for anything beyond plain token hashing if needed later. */
export function sign(payload: string): string {
  return createHmac('sha256', config.TOKEN_SIGNING_SECRET).update(payload).digest('hex');
}

const AES_ALGO = 'aes-256-gcm';

/** Encrypts a caller phone number (or other small PII) at rest. */
export function encryptPii(plaintext: string): string {
  const key = Buffer.from(config.PII_ENCRYPTION_KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv(AES_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv.authTag.ciphertext, all base64url, so it's one storable string
  return [iv.toString('base64url'), authTag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptPii(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted PII value');
  const key = Buffer.from(config.PII_ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(ivB64, 'base64url');
  const authTag = Buffer.from(tagB64, 'base64url');
  const data = Buffer.from(dataB64, 'base64url');
  const decipher = createDecipheriv(AES_ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
