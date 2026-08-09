export const VIBE_MODEL_VERSION = '2.1.0-evidence-bands';

/**
 * Ordinal display values for the four evidence outcomes. These values make
 * ordering easy to scan; distances between them are not calibrated odds.
 */
export const VIBE_EVIDENCE_INDEX = {
  inconclusive: 0,
  limited: 35,
  strong: 70,
  direct: 100,
} as const;

/**
 * These bands describe a public evidence index, not an authorship probability.
 * A high-confidence result still requires direct, declared provenance.
 */
export const VIBE_SCORE_BANDS = {
  limited: 20,
  strong: 50,
} as const;

export type VibeScoreBand = 'inconclusive' | 'limited' | 'strong';

export function getVibeScoreBand(score: number): VibeScoreBand {
  if (score >= VIBE_SCORE_BANDS.strong) return 'strong';
  if (score >= VIBE_SCORE_BANDS.limited) return 'limited';
  return 'inconclusive';
}

export function getVibeColor(score: number): string {
  const band = getVibeScoreBand(score);
  if (band === 'strong') return '#8b5cf6';
  if (band === 'limited') return '#f59e0b';
  return '#94a3b8';
}

export function getSecurityColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

/** Normalize current header-hardening bands and legacy stored `* Risk` values. */
export function getHeaderGapBand(value: string): 'Few' | 'Some' | 'Major' | 'Unknown' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'few header gaps' || normalized === 'low risk') return 'Few';
  if (normalized === 'some header gaps' || normalized === 'medium risk') return 'Some';
  if (normalized === 'major header gaps' || normalized === 'high risk') return 'Major';
  return 'Unknown';
}
