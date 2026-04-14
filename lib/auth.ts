import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import type { Plan } from './store';

const scryptAsync = promisify(scrypt);

function getSecret() {
  const raw = process.env.JWT_SECRET;
  if (!raw) throw new Error('JWT_SECRET environment variable is not set');
  return new TextEncoder().encode(raw);
}

export interface AuthPayload extends JWTPayload {
  userId: string;
  email: string;
  plan: Plan;
  name: string;
}

export async function signToken(payload: Omit<AuthPayload, 'iat' | 'exp' | 'iss'>): Promise<string> {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as AuthPayload;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, 'hex');
  const inputHash = (await scryptAsync(password, salt, 64)) as Buffer;
  return timingSafeEqual(hashBuffer, inputHash);
}

export const AUTH_COOKIE = 'vc-auth';
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 60 * 60 * 24 * 7, // 7 days
  path: '/',
};

export const PLAN_LIMITS: Record<Plan, { scansPerDay: number | null; label: string }> = {
  free: { scansPerDay: 5, label: 'Free' },
  pro: { scansPerDay: null, label: 'Pro' },
  team: { scansPerDay: null, label: 'Team' },
};
