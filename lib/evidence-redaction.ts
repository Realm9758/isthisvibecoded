import type { DeepFinding, DeepScanResult } from '@/types/deep-scan';

export function redactEvidenceText(value: string): string {
  return value
    .replace(/sk_(?:live|test)_[A-Za-z0-9]{12,}/g, match => `${match.slice(0, 8)}...<redacted>`)
    .replace(/sb_secret_[A-Za-z0-9_-]{12,}/g, 'sb_secret_...<redacted>')
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'eyJ...<redacted-jwt>')
    .replace(/AIza[A-Za-z0-9_-]{35}/g, 'AIza...<redacted>')
    .replace(/ghp_[A-Za-z0-9]{20,}/g, 'ghp_...<redacted>')
    .replace(/SG\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/g, 'SG....<redacted>')
    .replace(/(Set-Cookie:\s*[^=;\s]+)=([^;\s]+)/gi, '$1=<redacted>')
    .replace(/((?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*["']?)[A-Za-z0-9_-]{20,}/gi, '$1<redacted>');
}

/** Final defence before SSE or persistence, independent of detector logic. */
export function sanitizeFindings(findings: readonly DeepFinding[]): DeepFinding[] {
  return findings.map(finding => ({
    ...finding,
    description: redactEvidenceText(finding.description),
    evidence: finding.evidence ? redactEvidenceText(finding.evidence) : undefined,
    remediation: redactEvidenceText(finding.remediation),
    url: finding.url ? redactEvidenceText(finding.url) : undefined,
  }));
}

export function sanitizeScanResult(result: DeepScanResult): DeepScanResult {
  return {
    ...result,
    findings: sanitizeFindings(result.findings),
    checked: result.checked.map(item => ({ ...item, detail: redactEvidenceText(item.detail) })),
    provenance: result.provenance
      ? { ...result.provenance, evidence: result.provenance.evidence.map(redactEvidenceText) }
      : undefined,
  };
}
