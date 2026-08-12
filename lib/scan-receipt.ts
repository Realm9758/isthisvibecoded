import type { CheckCoverage } from '@/types/deep-scan';

export interface ScanReceipt {
  modules: number;
  completedModules: number;
  incompleteModules: number;
  notApplicableModules: number;
  networkModules: number;
  localModules: number;
}

/** Summarises the persisted per-module execution evidence for the report. */
export function summarizeScanReceipt(checks: readonly CheckCoverage[]): ScanReceipt {
  const applicable = checks.filter(check => check.applicable !== false);
  return {
    modules: checks.length,
    completedModules: applicable.filter(check => check.complete).length,
    incompleteModules: applicable.filter(check => !check.complete).length,
    notApplicableModules: checks.length - applicable.length,
    networkModules: applicable.filter(check => check.requestsAttempted > 0).length,
    localModules: applicable.filter(check => check.requestsAttempted === 0).length,
  };
}

export function formatModuleDuration(durationMs: number | undefined): string | null {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1) return '<1 ms';
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1_000).toFixed(1)} s`;
}

/** Short, non-technical execution evidence shown beside one module. */
export function moduleExecutionSummary(check: CheckCoverage): string {
  const duration = formatModuleDuration(check.durationMs);
  if (check.applicable === false) {
    return ['not applicable', duration].filter(Boolean).join(' · ');
  }
  const activity = check.requestsAttempted === 0
    ? 'analysed downloaded page data'
    : `${check.requestsAttempted} HTTP attempt${check.requestsAttempted === 1 ? '' : 's'}`;
  return [activity, duration].filter(Boolean).join(' · ');
}
