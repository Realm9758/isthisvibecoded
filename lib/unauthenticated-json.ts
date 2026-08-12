export type UnauthenticatedJsonRisk = 'high' | 'medium' | null;

function materialScalar(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized) return false;
  return !/^(?:required|missing|invalid|unauthori[sz]ed|forbidden|redacted|null|none|false|true|\*+|example|placeholder)$/i.test(normalized);
}

/** Distinguishes returned data from validators, schemas, and error envelopes. */
export function classifyUnauthenticatedJson(body: string): UnauthenticatedJsonRisk {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length <= 4 && keys.some(key => /^(?:error|message|status|code)$/i.test(key))) return null;
  }

  let severity: UnauthenticatedJsonRisk = null;
  const accountSignals = new Set<string>();
  function visit(value: unknown, depth: number): void {
    if (depth > 3 || value === null || typeof value !== 'object') return;
    const entries = Array.isArray(value)
      ? value.slice(0, 20).map((item, index) => [String(index), item] as const)
      : Object.entries(value as Record<string, unknown>).slice(0, 50);
    for (const [key, child] of entries) {
      if (materialScalar(child) && /(?:password|passwd|secret|private[_-]?key|access[_-]?token|service[_-]?role)/i.test(key)) {
        severity = 'high';
      } else if (materialScalar(child) && /^(?:email|phone|address|full_?name|user_?id)$/i.test(key)) {
        accountSignals.add(key.toLowerCase().replace(/_/g, ''));
      }
      visit(child, depth + 1);
    }
  }
  visit(parsed, 0);
  if (severity !== 'high' && accountSignals.size >= 2) severity = 'medium';
  return severity;
}
