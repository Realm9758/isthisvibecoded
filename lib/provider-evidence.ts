const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const SENSITIVE_TABLE_NAME = /^(?:users?|profiles?|customers?|accounts?|members?|contacts?|orders?|payments?|subscriptions?|invoices?|addresses?|messages?|leads?|sessions?)$/i;
const SENSITIVE_COLUMN_NAME = /^(?:email|phone|address|full_?name|first_?name|last_?name|user_?id|owner_?id|date_of_birth|dob|ssn|password|password_?hash|secret|access_?token|refresh_?token|stripe_?customer_?id|payment_?method|billing_?address)$/i;
const PLACEHOLDER_VALUE = /^(?:null|none|undefined|redacted|hidden|n\/?a|not[-_ ]?set|placeholder|example|sample|demo|test|unknown|change[-_ ]?me|replace[-_ ]?me|your[-_ ].*|x{4,}|0{4,}|\*{3,}|-+|\$\{[^}]+\}|0{8}-0{4}-0{4}-0{4}-0{12})$/i;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function validDnsName(value: string): boolean {
  return value.length <= 253 && value.split('.').every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  );
}

/**
 * Resolve the actual provider project or bucket that receives a probe.
 * Shared service hosts such as firebasestorage.googleapis.com are never quota
 * identities on their own: the validated bucket in the path is the target.
 */
export function providerQuotaIdentity(input: URL | string): string | null {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (/^[a-z0-9]{15,64}\.supabase\.co$/.test(hostname)) {
    return `supabase-project:${hostname}`;
  }

  if (
    /\.(?:firebaseio\.com|firebasedatabase\.app)$/.test(hostname)
    && validDnsName(hostname)
  ) {
    return `firebase-database:${hostname}`;
  }

  if (hostname === 'firebasestorage.googleapis.com') {
    const match = /^\/v0\/b\/([a-z0-9][a-z0-9._-]{1,220}\.(?:appspot\.com|firebasestorage\.app))\/o$/.exec(url.pathname);
    return match ? `firebase-storage:${match[1]}` : null;
  }

  const s3 = /^(.+)\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.exec(hostname);
  if (s3 && validDnsName(s3[1])) return `s3-bucket:${s3[1]}`;

  return null;
}

export type ProviderListState = 'empty' | 'nonempty';

/** Classify the array returned by Supabase Storage list APIs. */
export function classifyArrayList(value: unknown): ProviderListState | null {
  if (!Array.isArray(value)) return null;
  return value.length > 0 ? 'nonempty' : 'empty';
}

/** Firebase returns either `{ items: [...] }` or an empty object for a list. */
export function classifyFirebaseStorageList(value: unknown): ProviderListState | null {
  const result = record(value);
  if (!result || Object.hasOwn(result, 'error')) return null;
  if (!Object.hasOwn(result, 'items')) return Object.keys(result).length === 0 ? 'empty' : null;
  return classifyArrayList(result.items);
}

/** Validate the bounded XML shape of an S3 ListObjectsV2 response. */
export function classifyS3List(source: string): ProviderListState | null {
  const body = source.trim();
  const hasRoot = /<(?:[A-Za-z0-9_-]+:)?ListBucketResult\b[^>]*>/i.test(body)
    && /<\/(?:[A-Za-z0-9_-]+:)?ListBucketResult\s*>/i.test(body);
  if (!hasRoot) return null;
  return /<(?:[A-Za-z0-9_-]+:)?Contents\b/i.test(body) ? 'nonempty' : 'empty';
}

function hasMaterialValue(value: unknown, depth = 0): boolean {
  if (value === null || value === undefined || depth > 3) return false;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized || PLACEHOLDER_VALUE.test(normalized)) return false;
    if (/^[*x_\s-]+$/i.test(normalized)) return false;
    if (/^[^@\s]+@example\.(?:com|org|net|test)$/i.test(normalized)) return false;
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'bigint') return true;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).some(item => hasMaterialValue(item, depth + 1));
  const object = record(value);
  return object
    ? Object.values(object).slice(0, 30).some(child => hasMaterialValue(child, depth + 1))
    : false;
}

/** Sensitive-looking columns that actually contain material returned data. */
export function sensitiveMaterialFields(value: unknown): string[] {
  const row = record(value);
  if (!row) return [];
  return Object.entries(row)
    .filter(([field, child]) => SENSITIVE_COLUMN_NAME.test(field) && hasMaterialValue(child))
    .map(([field]) => field);
}

function schemaProperties(document: JsonRecord, table: string): string[] {
  const definitions = record(document.definitions);
  const components = record(document.components);
  const componentSchemas = record(components?.schemas);
  const schemas = [definitions, componentSchemas].filter((value): value is JsonRecord => value !== null);

  for (const collection of schemas) {
    const exact = record(collection[table]);
    const matchingKey = exact
      ? table
      : Object.keys(collection).find(key => key.toLowerCase() === table.toLowerCase());
    const schema = matchingKey ? record(collection[matchingKey]) : null;
    const properties = record(schema?.properties);
    if (properties) return Object.keys(properties);
  }
  return [];
}

/**
 * Read table candidates from the bounded OpenAPI document returned by a
 * PostgREST root endpoint. Only concrete single-segment paths with a GET
 * operation qualify. RPCs and arbitrary nested paths are never turned into
 * follow-up requests.
 *
 * Candidates with sensitive-looking schemas are ordered first so a small
 * read budget is spent where an accidental anonymous policy would matter.
 */
export function extractPostgrestTableCandidates(source: string, requestedLimit = 5): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return [];
  }

  const document = record(parsed);
  if (!document) return [];
  const version = typeof document.openapi === 'string'
    ? document.openapi
    : typeof document.swagger === 'string'
      ? document.swagger
      : '';
  if (!/^[23]\./.test(version)) return [];

  const paths = record(document.paths);
  if (!paths) return [];
  const limit = Math.max(0, Math.min(10, Math.floor(requestedLimit)));
  if (limit === 0) return [];

  const candidates: Array<{ table: string; priority: number; order: number }> = [];
  let order = 0;
  for (const [path, rawPathItem] of Object.entries(paths)) {
    const match = /^\/([A-Za-z_][A-Za-z0-9_]{0,62})$/.exec(path);
    const pathItem = record(rawPathItem);
    if (!match || !pathItem || !Object.hasOwn(pathItem, 'get')) continue;
    const table = match[1];
    if (!TABLE_NAME.test(table)) continue;

    const sensitiveColumns = schemaProperties(document, table)
      .filter(column => SENSITIVE_COLUMN_NAME.test(column)).length;
    candidates.push({
      table,
      priority: sensitiveColumns * 100 + (SENSITIVE_TABLE_NAME.test(table) ? 10 : 0),
      order: order++,
    });
  }

  return candidates
    .sort((left, right) => right.priority - left.priority || left.order - right.order)
    .slice(0, limit)
    .map(candidate => candidate.table);
}
