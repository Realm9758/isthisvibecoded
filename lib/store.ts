import { randomBytes } from 'crypto';
import type { AnalysisResult } from '@/types/analysis';

export type Plan = 'free' | 'pro' | 'team';

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  plan: Plan;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  createdAt: number;
}

export interface StoredScan {
  id: string;
  result: AnalysisResult;
  userId?: string;
  isPublic: boolean;
  roasts: string[];
  createdAt: number;
}

function genId(len = 10): string {
  return randomBytes(Math.ceil(len * 3 / 4)).toString('base64url').slice(0, len);
}

function todayKey(id: string): string {
  return `${id}:${new Date().toISOString().slice(0, 10)}`;
}

class Store {
  users = new Map<string, User>();
  usersByEmail = new Map<string, string>(); // email → id
  scans = new Map<string, StoredScan>();
  usage = new Map<string, number>(); // `id:YYYY-MM-DD` → count

  // ── Users ─────────────────────────────
  createUser(data: Omit<User, 'id' | 'createdAt'>): User {
    const user: User = { ...data, id: genId(), createdAt: Date.now() };
    this.users.set(user.id, user);
    this.usersByEmail.set(data.email.toLowerCase(), user.id);
    return user;
  }

  getUserById(id: string): User | undefined {
    return this.users.get(id);
  }

  getUserByEmail(email: string): User | undefined {
    const id = this.usersByEmail.get(email.toLowerCase());
    return id ? this.users.get(id) : undefined;
  }

  updateUser(id: string, patch: Partial<User>): User | undefined {
    const user = this.users.get(id);
    if (!user) return undefined;
    const updated = { ...user, ...patch };
    this.users.set(id, updated);
    return updated;
  }

  // ── Scans ─────────────────────────────
  saveScan(data: Omit<StoredScan, 'id' | 'createdAt'>): StoredScan {
    const scan: StoredScan = { ...data, id: genId(10), createdAt: Date.now() };
    this.scans.set(scan.id, scan);
    return scan;
  }

  getScan(id: string): StoredScan | undefined {
    return this.scans.get(id);
  }

  getPublicScans(limit = 30): StoredScan[] {
    return [...this.scans.values()]
      .filter(s => s.isPublic)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  getTopVibeScans(limit = 10): StoredScan[] {
    return [...this.scans.values()]
      .filter(s => s.isPublic)
      .sort((a, b) => b.result.vibe.score - a.result.vibe.score)
      .slice(0, limit);
  }

  getTopSecureScans(limit = 10): StoredScan[] {
    return [...this.scans.values()]
      .filter(s => s.isPublic)
      .sort((a, b) => b.result.security.score - a.result.security.score)
      .slice(0, limit);
  }

  getMostScannedDomains(limit = 10): { domain: string; count: number; latestScan: StoredScan }[] {
    const counts = new Map<string, { count: number; latestScan: StoredScan }>();
    for (const scan of this.scans.values()) {
      if (!scan.isPublic) continue;
      try {
        const domain = new URL(scan.result.url).hostname;
        const existing = counts.get(domain);
        if (!existing || scan.createdAt > existing.latestScan.createdAt) {
          counts.set(domain, { count: (existing?.count ?? 0) + 1, latestScan: scan });
        } else {
          counts.set(domain, { ...existing, count: existing.count + 1 });
        }
      } catch {
        // skip invalid URLs
      }
    }
    return [...counts.entries()]
      .map(([domain, data]) => ({ domain, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  // ── Usage / Rate limits ───────────────
  getDailyCount(id: string): number {
    return this.usage.get(todayKey(id)) ?? 0;
  }

  incrementUsage(id: string): void {
    const key = todayKey(id);
    this.usage.set(key, (this.usage.get(key) ?? 0) + 1);
  }

  getRemainingScans(id: string, plan: Plan): number | null {
    if (plan === 'pro' || plan === 'team') return null; // unlimited
    const used = this.getDailyCount(id);
    return Math.max(0, 5 - used);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __vibeStore: Store | undefined;
}

export const store = global.__vibeStore ?? (global.__vibeStore = new Store());
