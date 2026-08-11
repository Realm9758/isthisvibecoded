/**
 * Every scan quota key and limit.
 *
 * Routes must not invent their own. The per-target cap in particular is an
 * abuse control rather than a billing limit: it is what stops Ironclad being
 * pointed at somebody else's server over and over, so it applies identically
 * to an anonymous visitor and to a paying account.
 *
 * Permission decides which checks run. These decide only how often.
 */

/** Anonymous callers, per pseudonymous address, per day. Redacted reports. */
export const ANONYMOUS_DAILY_LIMIT = 1;

/** Free accounts, lifetime, spanning both lanes. */
export const FREE_LIFETIME_LIMIT = 3;

/** Signed-in callers, per minute, every plan. Protects scanner availability. */
export const USER_BURST_LIMIT = 1;

/** Every caller combined, per target domain, per hour. Never relax this. */
export const TARGET_HOURLY_LIMIT = 10;

const day = (now: Date) => now.toISOString().slice(0, 10);
const hour = (now: Date) => now.toISOString().slice(0, 13);
const minute = (now: Date) => now.toISOString().slice(0, 16);

export function anonymousDailyKey(rateLimitKey: string, now: Date): string {
  return `surface:${rateLimitKey}:${day(now)}`;
}

/**
 * Named `deep:` for continuity. schema.sql seeds this counter from existing
 * scan rows, and renaming it would hand every existing account a fresh
 * allowance. It now covers both lanes.
 */
export function freeLifetimeKey(userId: string): string {
  return `deep:${userId}:lifetime`;
}

export function userBurstKey(userId: string, now: Date): string {
  return `scan-burst:${userId}:${minute(now)}`;
}

export function targetHourlyKey(domain: string, now: Date): string {
  return `scan-target:${domain.toLowerCase()}:${hour(now)}`;
}
