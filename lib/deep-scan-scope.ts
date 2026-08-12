import { DEEP_ONLY_PHASE_IDS, SURFACE_PHASE_IDS } from '@/lib/scan-lanes';
import { SCAN_PHASES, type ScanPhase } from '@/lib/scan-phases';

export type DeepScanModuleGroup = 'browser' | 'transport' | 'exposure' | 'inputs' | 'access' | 'cloud';
export type RequestIntensity = 'local' | 'light' | 'moderate' | 'heavy';

export interface DeepScanModuleDefinition {
  id: string;
  group: DeepScanModuleGroup;
  benefit: string;
  limitation: string;
  intensity: RequestIntensity;
}

/**
 * Client-safe capability contract. Each entry explains both why the bounded
 * module is useful and what conclusion it cannot support.
 */
export const DEEP_SCAN_MODULES = [
  { id: 'vibe', group: 'browser', intensity: 'moderate', benefit: 'Reads the submitted page and selected same-origin scripts for material browser-exposed credentials and provider configuration.', limitation: 'Only browser-delivered files are visible; server environment variables and unreferenced chunks are outside scope.' },
  { id: 'components', group: 'browser', intensity: 'local', benefit: 'Finds reviewable version strings for a small set of legacy browser libraries.', limitation: 'A version string does not prove the vulnerable code path is loaded; the catalogue is intentionally narrow.' },
  { id: 'sourcemaps', group: 'browser', intensity: 'light', benefit: 'Checks declared and conventional same-origin source-map locations for embedded source or mapping metadata.', limitation: 'Only selected referenced scripts are inspected; missing maps do not prove source is private.' },

  { id: 'headers', group: 'transport', intensity: 'local', benefit: 'Evaluates effective CSP, HSTS, framing, MIME, referrer, and browser-permission policies on the submitted page.', limitation: 'One response cannot establish that every route uses the same headers.' },
  { id: 'cookies', group: 'transport', intensity: 'local', benefit: 'Reviews observed cookies for Secure, HttpOnly, SameSite, and prefix-contract mistakes.', limitation: 'Cookies set only after login or on another route are not observed.' },
  { id: 'ssl', group: 'transport', intensity: 'light', benefit: 'Checks whether plain HTTP is forced to the verified HTTPS host.', limitation: 'This is not a certificate-chain, protocol-version, cipher-suite, or expiry audit.' },
  { id: 'info', group: 'transport', intensity: 'local', benefit: 'Finds detailed server and framework versions disclosed in response headers.', limitation: 'Product names without versions are usually context, not a vulnerability.' },
  { id: 'sri', group: 'transport', intensity: 'local', benefit: 'Validates integrity and crossorigin attributes on immutable third-party page resources.', limitation: 'Same-origin and intentionally moving third-party assets are not meaningfully covered by SRI.' },
  { id: 'cors', group: 'transport', intensity: 'moderate', benefit: 'Tests the page and selected API routes with hostile Origin values for dangerous credentialed reflection.', limitation: 'Unauthenticated responses cannot prove what a signed-in browser could read.' },
  { id: 'hostheader', group: 'transport', intensity: 'light', benefit: 'Checks whether a forged Host controls an external redirect or is reflected in a successful response.', limitation: 'It does not submit password-reset flows or prove cache poisoning.' },
  { id: 'crlf', group: 'transport', intensity: 'moderate', benefit: 'Tests discovered response-shaping GET inputs for creation of an unintended response header.', limitation: 'No conclusion is made when no suitable public input is discovered.' },
  { id: 'ratelimit', group: 'transport', intensity: 'moderate', benefit: 'Records whether one discovered public API route exposes rate-limit headers or throttles a six-request burst.', limitation: 'Six safe requests cannot prove protection against brute force, distributed abuse, login attempts, or higher production thresholds.' },

  { id: 'files', group: 'exposure', intensity: 'heavy', benefit: 'Checks a bounded inventory of high-risk configuration, repository, backup, and diagnostic files with content validation.', limitation: 'It cannot enumerate arbitrary filenames or reconstruct a repository from one Git marker.' },
  { id: 'admin', group: 'exposure', intensity: 'heavy', benefit: 'Looks for actual unauthenticated privileged-interface content at common management paths.', limitation: 'A login page is not reported; custom or unlinked management paths are not discoverable.' },
  { id: 'errors', group: 'exposure', intensity: 'light', benefit: 'Looks for stack traces and framework internals in a small set of safe error responses.', limitation: 'It does not exercise every controller, parser, or application exception.' },
  { id: 'dirlist', group: 'exposure', intensity: 'moderate', benefit: 'Checks selected common asset and backup directories for real index listings.', limitation: 'Custom directories and authenticated listings remain outside scope.' },
  { id: 'robots', group: 'exposure', intensity: 'light', benefit: 'Reviews robots.txt for disclosed admin, backup, and configuration paths.', limitation: 'A Disallow entry is disclosure context, not proof that the path is reachable.' },
  { id: 'serverstatus', group: 'exposure', intensity: 'light', benefit: 'Requires real Apache mod_status content before reporting public server-status exposure.', limitation: 'Other vendor-specific diagnostic consoles are not covered.' },
  { id: 'apidocs', group: 'exposure', intensity: 'moderate', benefit: 'Finds structured OpenAPI, Swagger, and ReDoc content at selected conventional paths.', limitation: 'Public documentation may be intentional; custom documentation routes can be missed.' },
  { id: 'graphql', group: 'exposure', intensity: 'moderate', benefit: 'Sends a bounded schema query to selected conventional GraphQL endpoints.', limitation: 'Public introspection is often intentional and does not establish data exposure.' },

  { id: 'xss', group: 'inputs', intensity: 'moderate', benefit: 'Uses a unique marker on discovered public GET inputs to detect differential unencoded HTML reflection.', limitation: 'This does not execute JavaScript in a browser or cover DOM, stored, POST, or authenticated XSS.' },
  { id: 'sqli', group: 'inputs', intensity: 'heavy', benefit: 'Compares benign and SQL-shaped values on discovered public GET inputs for database-specific error disclosure.', limitation: 'It does not prove SQL execution, extract data, or submit login/password forms.' },
  { id: 'nosql', group: 'inputs', intensity: 'moderate', benefit: 'Compares benign and MongoDB-shaped query values on discovered public API inputs.', limitation: 'It detects differential error evidence, not authentication bypass or database extraction.' },
  { id: 'redirect', group: 'inputs', intensity: 'moderate', benefit: 'Tests discovered redirect-like GET parameters with an external destination.', limitation: 'POST-only, JavaScript-only, and multi-step redirect flows are not covered.' },
  { id: 'ssrf', group: 'inputs', intensity: 'moderate', benefit: 'Looks for a differential cloud-metadata signature through discovered URL-fetching inputs.', limitation: 'Without a consented callback service it misses blind SSRF and many non-metadata egress paths.' },
  { id: 'traversal', group: 'inputs', intensity: 'heavy', benefit: 'Requires differential Unix account-file evidence through discovered file/path GET inputs.', limitation: 'It does not cover Windows targets, arbitrary files, uploads, or POST-only parameters.' },

  { id: 'forced', group: 'access', intensity: 'moderate', benefit: 'Checks selected discovered API routes for material account, configuration, or secret-shaped JSON without authentication.', limitation: 'Public JSON can be intentional; full authorization testing needs authenticated roles and ownership expectations.' },
  { id: 'idor', group: 'access', intensity: 'moderate', benefit: 'Compares two sequential public records and a nonexistent control on a discovered object route.', limitation: 'This is an ownership-review signal, not proof of IDOR without two authenticated principals.' },
  { id: 'nextauth', group: 'access', intensity: 'moderate', benefit: 'Differentially tests discovered Next.js protected routes for the known middleware-bypass header pattern.', limitation: 'Only applicable Next.js builds and manifest-discovered routes are covered.' },

  { id: 'supabase', group: 'cloud', intensity: 'moderate', benefit: 'Uses discovered public project configuration and table names for a few bounded anonymous reads.', limitation: 'Dynamic or server-only table names are missed, and anonymous access can be intentional under RLS.' },
  { id: 'firebase', group: 'cloud', intensity: 'moderate', benefit: 'Makes shallow or one-item reads against exact Firebase database and storage endpoints published to the browser.', limitation: 'Only the discovered project and a bounded first level are sampled.' },
  { id: 'storage', group: 'cloud', intensity: 'moderate', benefit: 'Tests discovered Supabase Storage and S3 endpoints for anonymous listing permission.', limitation: 'Private buckets, unreferenced buckets, object reads, writes, and signed URLs are not tested.' },
] as const satisfies readonly DeepScanModuleDefinition[];

export type DeepScanModuleId = typeof DEEP_SCAN_MODULES[number]['id'];

export const DEEP_SCAN_GROUP_LABELS: Record<DeepScanModuleGroup, string> = {
  browser: 'Browser code',
  transport: 'Browser & transport policy',
  exposure: 'Public exposure',
  inputs: 'Public input handling',
  access: 'Access control indicators',
  cloud: 'Cloud data rules',
};

export const DEEP_SCAN_PROFILES = {
  full: {
    label: 'Full external review',
    description: 'All bounded modules. Recommended when you own the target and want the broadest evidence.',
    phaseIds: DEEP_SCAN_MODULES.map(module => module.id),
  },
  application: {
    label: 'Web application',
    description: 'Public inputs, API access, sessions, CORS, error behaviour, and abuse signals.',
    phaseIds: ['vibe', 'headers', 'cookies', 'cors', 'errors', 'xss', 'sqli', 'nosql', 'redirect', 'ssrf', 'traversal', 'forced', 'ratelimit', 'idor', 'nextauth', 'graphql', 'hostheader', 'crlf'],
  },
  exposure: {
    label: 'Exposure & configuration',
    description: 'Published secrets, files, browser assets, diagnostics, headers, and documentation.',
    phaseIds: ['vibe', 'files', 'headers', 'cookies', 'ssl', 'admin', 'errors', 'dirlist', 'robots', 'sri', 'info', 'serverstatus', 'components', 'sourcemaps', 'apidocs'],
  },
  data: {
    label: 'APIs & cloud data',
    description: 'Unauthenticated APIs, public objects, GraphQL, provider rules, storage, CORS, and throttling signals.',
    phaseIds: ['vibe', 'cors', 'forced', 'ratelimit', 'idor', 'supabase', 'firebase', 'storage', 'graphql', 'apidocs'],
  },
} as const satisfies Record<string, { label: string; description: string; phaseIds: readonly DeepScanModuleId[] }>;

const KNOWN_IDS = new Set<string>(DEEP_SCAN_MODULES.map(module => module.id));
const ORDER = new Map(DEEP_SCAN_MODULES.map((module, index) => [module.id, index]));

export function parseRequestedDeepScanScope(value: unknown): DeepScanModuleId[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Choose at least one assessment module before starting the scan.');
  }
  if (value.length > DEEP_SCAN_MODULES.length) throw new Error('Too many assessment modules were requested.');
  const unique = new Set<DeepScanModuleId>();
  for (const item of value) {
    if (typeof item !== 'string' || !KNOWN_IDS.has(item)) throw new Error('The requested scan scope contains an unknown module.');
    unique.add(item as DeepScanModuleId);
  }
  return [...unique].sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
}

export function fullDeepScanScope(): DeepScanModuleId[] {
  return DEEP_SCAN_MODULES.map(module => module.id);
}

export function isFullDeepScanScope(ids: readonly string[]): boolean {
  const selected = new Set(ids);
  return DEEP_SCAN_MODULES.every(module => selected.has(module.id));
}

export function phasesForDeepScanScope(ids: readonly string[]): ScanPhase[] {
  const selected = new Set(ids);
  return SCAN_PHASES.filter(phase => phase.id === 'init' || phase.id === 'done' || selected.has(phase.id));
}

/** Guard the catalogue against drifting away from the actual lane inventory. */
export function deepScanScopeInventoryMatchesLanes(): boolean {
  const laneIds = new Set<string>([...SURFACE_PHASE_IDS, ...DEEP_ONLY_PHASE_IDS]);
  return laneIds.size === KNOWN_IDS.size && [...laneIds].every(id => KNOWN_IDS.has(id));
}
