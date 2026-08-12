export interface SupabaseArtifact {
  url: string;
  key: string;
  keyKind: 'legacy-anon' | 'publishable';
  tables: string[];
  storageBuckets: string[];
}

export interface FirebaseArtifact {
  apiKey?: string;
  projectId?: string;
  databaseUrl?: string;
  storageBucket?: string;
}

export interface ClientArtifacts {
  supabase?: SupabaseArtifact;
  firebase?: FirebaseArtifact;
  s3Hosts: string[];
  routeLiterals: string[];
}

function decodeJwtRole(value: string): string | null {
  try {
    const encoded = value.split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    return JSON.parse(decoded).role ?? null;
  } catch {
    return null;
  }
}

function property(source: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:["']?${escaped}["']?)\\s*:\\s*["']([^"']+)["']`, 'i').exec(source);
  return match?.[1];
}

export function extractSameOriginScriptUrls(html: string, baseUrl: string, limit = 8): string[] {
  const origin = new URL(baseUrl).origin;
  const found: string[] = [];
  const seen = new Set<string>();
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const match = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/i.exec(tag);
    const raw = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!raw) continue;
    try {
      const url = new URL(raw, baseUrl);
      url.hash = '';
      if (url.origin !== origin || seen.has(url.href)) continue;
      if (!/\.(?:m?js)(?:$|\?)/i.test(url.href)) continue;
      seen.add(url.href);
      found.push(url.href);
      if (found.length >= limit) break;
    } catch {
      // Malformed source attributes are ignored.
    }
  }
  return found;
}

export function extractClientArtifacts(source: string): ClientArtifacts {
  const supabaseUrl = source.match(/https:\/\/[a-z0-9]{15,}\.supabase\.co/i)?.[0];
  const publishableKey = source.match(/sb_publishable_[A-Za-z0-9_-]{20,}/)?.[0];
  const legacyKeys = source.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? [];
  const legacyAnonKey = legacyKeys.find(key => decodeJwtRole(key) === 'anon');
  const tables = new Set<string>();
  const storageBuckets = new Set<string>();
  for (const match of source.matchAll(/\.from\(\s*["']([A-Za-z_][A-Za-z0-9_]{0,62})["']\s*\)/g)) {
    const prefix = source.slice(Math.max(0, (match.index ?? 0) - 24), match.index);
    if (!/\.storage\s*$/i.test(prefix)) tables.add(match[1]);
  }
  for (const match of source.matchAll(/\/rest\/v1\/([A-Za-z_][A-Za-z0-9_]{0,62})/g)) tables.add(match[1]);
  for (const match of source.matchAll(/\.storage\s*\.\s*from\(\s*["']([A-Za-z0-9_.-]{1,100})["']\s*\)/g)) {
    storageBuckets.add(match[1]);
  }
  for (const match of source.matchAll(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([A-Za-z0-9_.-]{1,100})/g)) {
    storageBuckets.add(match[1]);
  }

  const firebase: FirebaseArtifact = {};
  const apiKey = property(source, 'apiKey');
  if (apiKey?.startsWith('AIza')) firebase.apiKey = apiKey;
  firebase.projectId = property(source, 'projectId');
  firebase.databaseUrl = property(source, 'databaseURL');
  firebase.storageBucket = property(source, 'storageBucket');
  if (!firebase.databaseUrl) {
    firebase.databaseUrl = source.match(/https:\/\/[a-z0-9-]+(?:-default-rtdb)?\.(?:firebaseio\.com|firebasedatabase\.app)/i)?.[0];
  }

  const s3Hosts = new Set<string>();
  for (const match of source.matchAll(/https:\/\/([a-z0-9][a-z0-9.-]{1,61}\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com)(?:[/?"'])/gi)) {
    s3Hosts.add(match[1].toLowerCase());
  }

  const routeLiterals = new Set<string>();
  for (const match of source.matchAll(/["'](\/api\/[A-Za-z0-9_./-]{1,120})["']/g)) {
    routeLiterals.add(match[1]);
    if (routeLiterals.size >= 20) break;
  }

  return {
    supabase: supabaseUrl && (publishableKey || legacyAnonKey)
      ? {
          url: supabaseUrl,
          key: publishableKey ?? legacyAnonKey!,
          keyKind: publishableKey ? 'publishable' : 'legacy-anon',
          tables: [...tables].slice(0, 5),
          storageBuckets: [...storageBuckets].slice(0, 3),
        }
      : undefined,
    firebase: Object.values(firebase).some(Boolean) ? firebase : undefined,
    s3Hosts: [...s3Hosts].slice(0, 3),
    routeLiterals: [...routeLiterals],
  };
}

export function mergeClientArtifacts(...sets: ClientArtifacts[]): ClientArtifacts {
  const supabase = sets.find(set => set.supabase)?.supabase;
  if (supabase) {
    supabase.tables = [...new Set(sets.flatMap(set => set.supabase?.tables ?? []))].slice(0, 5);
    supabase.storageBuckets = [...new Set(sets.flatMap(set => set.supabase?.storageBuckets ?? []))].slice(0, 3);
  }
  const firebase = Object.assign({}, ...sets.map(set => set.firebase ?? {})) as FirebaseArtifact;
  return {
    supabase,
    firebase: Object.values(firebase).some(Boolean) ? firebase : undefined,
    s3Hosts: [...new Set(sets.flatMap(set => set.s3Hosts))].slice(0, 3),
    routeLiterals: [...new Set(sets.flatMap(set => set.routeLiterals))].slice(0, 20),
  };
}

/** Extract the public build id only from Next.js' structured __NEXT_DATA__. */
export function extractNextBuildId(html: string): string | null {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = match[1];
    const id = /\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/i.exec(attributes);
    if ((id?.[1] ?? id?.[2] ?? id?.[3]) !== '__NEXT_DATA__') continue;
    try {
      const parsed = JSON.parse(match[2]) as { buildId?: unknown };
      return typeof parsed.buildId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(parsed.buildId)
        ? parsed.buildId
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Keep only concrete, same-site page paths from the public Next.js manifest. */
export function extractNextManifestRoutes(source: string, limit = 20): string[] {
  const routes = new Set<string>();
  for (const match of source.matchAll(/["'](\/(?!_next(?:\/|$))[A-Za-z0-9_./-]{0,160})["']/g)) {
    const route = match[1].replace(/\/$/, '') || '/';
    if (route.includes('..') || route.includes('//') || route.includes('[')) continue;
    if (/\.(?:js|css|json|map|png|jpe?g|gif|svg|ico|woff2?)$/i.test(route)) continue;
    routes.add(route);
    if (routes.size >= limit) break;
  }
  return [...routes];
}
