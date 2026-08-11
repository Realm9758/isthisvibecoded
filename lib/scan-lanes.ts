/**
 * Which checks run in which lane, and the rule that decides it.
 *
 * The surface lane may request static artifacts that were published by
 * accident: configuration files, backups, build output, and documentation.
 * It may not request application entry points: admin panels, internal APIs,
 * and object endpoints. Requesting /.env retrieves a file the server is
 * already handing to anyone who asks. Requesting /admin looks like an
 * intrusion attempt, can lock accounts out, and will page somebody.
 *
 * Permission decides lane membership. Payment never does. Moving an entry
 * from DEEP_ONLY_PHASE_IDS to SURFACE_PHASE_IDS means deciding it is safe to
 * send at a stranger's server, unasked, and tests/scan-lanes.test.ts exists
 * to make that a deliberate act rather than an accident.
 */

export type ScanLane = 'surface' | 'deep';

/** Read-only requests of the class a browser or crawler already makes. */
export const SURFACE_PHASE_IDS = [
  'vibe',       // reads the already-fetched page
  'files',      // GET of well-known static paths
  'cors',       // GET carrying an Origin header
  'headers',    // reads the already-fetched response
  'cookies',    // reads the already-fetched response
  'methods',    // one OPTIONS request
  'ssl',        // GET over HTTP and HTTPS
  'dirlist',    // GET of common asset directories
  'robots',     // GET of /robots.txt
  'sri',        // reads the already-fetched page
  'info',       // reads response headers, one GET of /server-status
  'components', // reads the already-fetched page
  'sourcemaps', // GET of referenced .js.map files
  'graphql',    // POST of a read-only introspection query, mutates nothing
  'apidocs',    // GET of /swagger and /openapi.json
] as const satisfies readonly string[];

/** Sends a payload, probes an application entry point, or repeats requests. */
export const DEEP_ONLY_PHASE_IDS = [
  'xss', 'sqli', 'nosql', 'traversal', 'ssrf', 'crlf', 'hostheader',
  'redirect', 'errors', 'admin', 'forced', 'idor', 'ratelimit',
] as const satisfies readonly string[];

/** Present in both lanes: they frame the run rather than probing anything. */
export const FRAMING_PHASE_IDS = ['init', 'done'] as const;

export const LANE_LABELS: Record<ScanLane, string> = {
  surface: 'Surface scan',
  deep: 'Deep scan',
};

export const LANE_CHECK_COUNTS: Record<ScanLane, number> = {
  surface: SURFACE_PHASE_IDS.length,
  deep: SURFACE_PHASE_IDS.length + DEEP_ONLY_PHASE_IDS.length,
};

export function phaseRunsInLane(phaseId: string, lane: ScanLane): boolean {
  if ((FRAMING_PHASE_IDS as readonly string[]).includes(phaseId)) return true;
  if ((SURFACE_PHASE_IDS as readonly string[]).includes(phaseId)) return true;
  return lane === 'deep' && (DEEP_ONLY_PHASE_IDS as readonly string[]).includes(phaseId);
}

/** Phases to stream to the client for a lane, in scanner execution order. */
export function phasesForLane<T extends { id: string }>(phases: readonly T[], lane: ScanLane): T[] {
  return phases.filter(phase => phaseRunsInLane(phase.id, lane));
}
