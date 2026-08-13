'use client';

import { useState, useEffect, useRef } from 'react';
import type { DeepScanResult, DeepFinding, ScanPhaseProgress } from '@/types/deep-scan';
import type { ScanPhase } from '@/lib/scan-phases';
import { explainPhaseReason, formatFindingCount, formatTerminalPhaseLog } from '@/lib/scan-progress-presentation';
import { apiPath } from '@/lib/site';
import { MUTATION_GUARD_HEADER, MUTATION_GUARD_VALUE } from '@/lib/request-security-constants';
import { DurableDeepScanRunner } from '@/components/DurableDeepScanRunner';

/**
 * Consumes a scan's SSE stream and renders live progress.
 *
 * Both the landing page and the dashboard run scans, so this lives in one
 * place rather than being duplicated. It knows nothing about lanes: the
 * endpoint and body decide which lane runs, and the phase list arrives from
 * the server, so the surface lane simply streams fewer rows.
 */

export type CompletedScan = DeepScanResult & {
  /** Absent when the scan ran but could not be written to history. */
  scanId?: string;
  claimToken?: string | null;
  redacted?: boolean;
  /** Set when the result is real but was not persisted. */
  notSaved?: string;
};

export interface ScanErrorMeta {
  /** The caller is out of anonymous scans and should create an account. */
  signupRequired?: boolean;
  /** The caller has spent their free allowance and should subscribe. */
  upgradeRequired?: boolean;
}

interface Props {
  endpoint: '/api/scan' | '/api/deep-scan';
  /** Request body. The deep endpoint also needs authorisation and terms. */
  body: Record<string, unknown>;
  /** Shown in the terminal header. */
  label: string;
  onResult: (result: CompletedScan) => void;
  onError: (message: string, meta: ScanErrorMeta) => void;
  /** Reconnect to an existing durable deep job instead of creating another. */
  existingJobId?: string | null;
}

type PhaseState = {
  phase: ScanPhase;
  status: 'pending' | 'running' | 'complete' | 'incomplete' | 'not_applicable';
  findingCount: number;
  coverage: ScanPhaseProgress['coverage'] | null;
  durationMs: number | null;
  reason: string | null;
};

type PhaseEvent = ScanPhase & ScanPhaseProgress & {
  findings?: DeepFinding[];
};

const TERMINAL_PHASE_STATUSES = new Set<PhaseState['status']>([
  'complete',
  'incomplete',
  'not_applicable',
]);

function initialPhaseState(phase: ScanPhase): PhaseState {
  return {
    phase,
    status: 'pending',
    findingCount: 0,
    coverage: null,
    durationMs: null,
    reason: null,
  };
}

function isTerminalPhase(status: PhaseState['status']): boolean {
  return TERMINAL_PHASE_STATUSES.has(status);
}

function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

function coverageParts(coverage: PhaseState['coverage']): string[] {
  if (!coverage) return [];

  const parts: string[] = [];
  if (coverage.requestsAttempted > 0) {
    parts.push(`${coverage.requestsCompleted}/${coverage.requestsAttempted} requests completed`);
  }
  if (coverage.requestsFailed > 0) {
    parts.push(`${coverage.requestsFailed} failed`);
  }
  if (coverage.requestsBlocked > 0) {
    parts.push(`${coverage.requestsBlocked} blocked`);
  }
  return parts;
}

function phaseOutcomeLabel(status: PhaseState['status']): string {
  if (status === 'complete') return 'Check complete';
  if (status === 'incomplete') return 'Coverage inconclusive';
  if (status === 'not_applicable') return 'Not applicable';
  if (status === 'running') return 'Running';
  return 'Waiting';
}

export function ScanRunner(props: Props) {
  if (props.endpoint === '/api/deep-scan') {
    return <DurableDeepScanRunner body={props.body} label={props.label} existingJobId={props.existingJobId} onResult={props.onResult} onError={props.onError} />;
  }
  return <StreamingScanRunner {...props} />;
}

function StreamingScanRunner({ endpoint, body, label, onResult, onError }: Props) {
  const [phases, setPhases] = useState<PhaseState[]>([]);
  const [currentPhaseId, setCurrentPhaseId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  // The parent usually passes inline literals for these. Holding them in refs
  // keeps a re-render from aborting and restarting a scan in flight. They are
  // written in an effect rather than during render, so a discarded render
  // cannot leave a ref pointing at a callback that was never committed.
  const bodyRef = useRef(body);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1_000);
    return () => window.clearInterval(timer);
  }, [endpoint, label]);

  useEffect(() => {
    bodyRef.current = body;
    onResultRef.current = onResult;
    onErrorRef.current = onError;
  }, [body, onResult, onError]);

  useEffect(() => {
    const ctrl = new AbortController();
    const addLog = (line: string) => setLog(prev => [...prev.slice(-60), line]);

    const runScan = async () => {
      addLog(`$ ironclad --target ${label}`);
      addLog('Waiting for the scanner to report its first step…');

      const res = await fetch(apiPath(endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [MUTATION_GUARD_HEADER]: MUTATION_GUARD_VALUE,
        },
        body: JSON.stringify(bodyRef.current),
        signal: ctrl.signal,
      }).catch(() => null);

      // React remounts effects in development, and the cleanup aborts the
      // first attempt. Reporting that abort would show "Connection failed"
      // over a scan that is actually still running.
      if (ctrl.signal.aborted) return;

      if (!res?.ok || !res.body) {
        const payload = res ? await res.json().catch(() => ({})) : {};
        onErrorRef.current(
          payload.error ?? (res ? 'Scan failed' : 'Connection failed'),
          {
            signupRequired: payload.signupRequired === true,
            upgradeRequired: payload.upgradeRequired === true,
          },
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let terminalEventReceived = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split('\n\n');
          buf = events.pop() ?? '';

          for (const block of events) {
            const lines = block.split('\n');
            const eventLine = lines.find(l => l.startsWith('event:'));
            const dataLine = lines.find(l => l.startsWith('data:'));
            if (!eventLine || !dataLine) continue;

            const event = eventLine.replace('event:', '').trim();
            const data = JSON.parse(dataLine.replace('data:', '').trim());

            if (event === 'phases') {
              if (!Array.isArray(data)) throw new Error('Invalid phase manifest');
              setPhases((data as ScanPhase[]).map(initialPhaseState));
            }

            if (event === 'phase') {
              const phaseEvent = data as PhaseEvent;
              const {
                id,
                label: phaseLabel,
                detail,
                status,
                coverage = null,
                durationMs = null,
                reason = null,
              } = phaseEvent;
              const findings = Array.isArray(phaseEvent.findings) ? phaseEvent.findings : [];
              const displayReason = explainPhaseReason(reason);

              if (!['start', 'progress', 'complete', 'incomplete', 'not_applicable'].includes(status)) {
                throw new Error('Invalid phase status');
              }

              setCurrentPhaseId(id);

              if (status === 'start') {
                addLog(`[>] ${phaseLabel}: ${detail}`);
              }

              if (status === 'complete' || status === 'incomplete' || status === 'not_applicable') {
                addLog(formatTerminalPhaseLog({
                  label: phaseLabel,
                  status,
                  findingCount: findings.length,
                  findingSeverities: findings.map(finding => finding?.severity),
                  reason: displayReason,
                }));
              }

              setPhases(prev => {
                const existing = prev.some(item => item.phase.id === id)
                  ? prev
                  : [...prev, initialPhaseState({ id, label: phaseLabel, detail })];
                return existing.map(item => {
                  if (item.phase.id !== id) return item;
                  const nextStatus: PhaseState['status'] = status === 'start' || status === 'progress'
                    ? 'running'
                    : status;
                  return {
                    ...item,
                    phase: { id, label: phaseLabel, detail },
                    status: nextStatus,
                    findingCount: isTerminalPhase(nextStatus) ? findings.length : item.findingCount,
                    coverage,
                    durationMs,
                    reason: displayReason,
                  };
                });
              });
            }

            if (event === 'result') {
              terminalEventReceived = true;
              const completed = data as CompletedScan;
              const resultPrefix = completed.findings.length > 0
                ? '[!]'
                : completed.summary.score === null || completed.notSaved
                  ? '[?]'
                  : '[✓]';
              const resultFindingText = completed.findings.length > 0
                ? formatFindingCount(completed.findings.length)
                : completed.summary.score === null
                  ? 'no findings confirmed'
                  : 'no findings';
              addLog(`${resultPrefix} Scan finished: ${resultFindingText}, ${
                completed.summary.score === null
                  ? 'grade withheld because coverage was incomplete'
                  : `grade ${completed.summary.score}/100`
              }${completed.notSaved ? '; report was not saved to scan history' : ''}`);
              if (!ctrl.signal.aborted) onResultRef.current(completed);
              return;
            }

            if (event === 'error') {
              terminalEventReceived = true;
              onErrorRef.current(data.error ?? 'Scan failed', {
                signupRequired: data.signupRequired === true,
                upgradeRequired: data.upgradeRequired === true,
              });
              return;
            }
          }
        }
      } catch {
        if (!ctrl.signal.aborted) {
          terminalEventReceived = true;
          onErrorRef.current('The scan stream was interrupted before a complete result was received.', {});
        }
      }

      if (!terminalEventReceived && !ctrl.signal.aborted) {
        onErrorRef.current('The scan ended without a complete result. No grade was produced.', {});
      }
    };

    // In development React mounts, cleans up, and mounts effects again to
    // expose unsafe side effects. Deferring the request by one task lets the
    // first cleanup cancel its scheduled request, so a scan and its quota are
    // never consumed twice.
    const startHandle = window.setTimeout(() => { void runScan(); }, 0);

    return () => {
      window.clearTimeout(startHandle);
      ctrl.abort();
    };
  }, [endpoint, label]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [log]);

  const checkPhases = phases.filter(p => p.phase.id !== 'init' && p.phase.id !== 'done');
  const resolvedPhases = phases.filter(p => isTerminalPhase(p.status));
  const resolvedChecks = checkPhases.filter(p => isTerminalPhase(p.status));
  const progress = phases.length ? Math.round((resolvedPhases.length / phases.length) * 100) : null;
  const findingCount = checkPhases.reduce((sum, phase) => sum + phase.findingCount, 0);
  const incompleteCount = checkPhases.filter(phase => phase.status === 'incomplete').length;
  const skippedCount = checkPhases.filter(phase => phase.status === 'not_applicable').length;
  const currentPhaseIndex = currentPhaseId === null
    ? -1
    : phases.findIndex(item => item.phase.id === currentPhaseId);
  const currentPhase = currentPhaseIndex >= 0 ? phases[currentPhaseIndex] : null;
  const currentPhaseIsCheck = currentPhase !== null
    && currentPhase.phase.id !== 'init'
    && currentPhase.phase.id !== 'done';
  const currentCoverage = currentPhase ? coverageParts(currentPhase.coverage) : [];
  const currentDuration = formatDuration(currentPhase?.durationMs ?? null);
  const currentFindingMeta = currentPhase && isTerminalPhase(currentPhase.status) && currentPhase.findingCount > 0
    ? [formatFindingCount(currentPhase.findingCount)]
    : [];
  const currentMeta = [
    ...currentFindingMeta,
    ...currentCoverage,
    ...(currentDuration ? [currentDuration] : []),
  ];
  const stepLabel = currentPhase
    ? `Step ${currentPhaseIndex + 1} of ${phases.length}: ${currentPhase.phase.label}`
    : 'Waiting for the server to start the scan';
  const progressText = phases.length
    ? `${resolvedPhases.length} of ${phases.length} server-reported steps resolved`
    : 'Waiting for the server-reported step list';
  const currentFindingAnnouncement = currentPhase && isTerminalPhase(currentPhase.status)
    ? currentPhase.findingCount > 0
      ? ` ${formatFindingCount(currentPhase.findingCount)} reported.`
      : currentPhase.status === 'complete' && currentPhaseIsCheck
        ? ' No matching findings reported.'
        : ''
    : '';
  const announcement = currentPhase
    ? `${stepLabel}. ${phaseOutcomeLabel(currentPhase.status)}.${currentFindingAnnouncement}${currentPhase.reason ? ` ${currentPhase.reason}.` : ''}`
    : progressText;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>

      <div className="border p-5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="w-2 h-2 rounded-full animate-pulse-glow shrink-0" style={{ background: 'var(--accent)' }} />
          <span className="font-mono text-sm text-white truncate">{label}</span>
          <span className="ml-auto font-mono text-xs" style={{ color: 'var(--faint)' }}>
            {resolvedChecks.length} of {checkPhases.length || '...'} modules reported · {elapsedSeconds}s wall time · {findingCount} finding{findingCount === 1 ? '' : 's'} so far
          </span>
        </div>
        <div>
          <p className="font-mono text-xs mb-1.5" style={{ color: 'var(--accent)' }}>{stepLabel}</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {currentPhase?.phase.detail ?? 'The progress bar will begin when the scanner sends its phase list.'}
          </p>
          {currentPhase && (
            <p className="font-mono text-[11px] mt-2" style={{
              color: currentPhase.findingCount > 0
                ? 'var(--high)'
                : currentPhase.status === 'incomplete'
                  ? 'var(--med)'
                  : currentPhase.status === 'not_applicable'
                    ? 'var(--faint)'
                    : currentPhase.status === 'complete'
                      ? 'var(--ok)'
                      : 'var(--accent)',
            }}>
              {phaseOutcomeLabel(currentPhase.status)}
              {currentMeta.length > 0 ? ` · ${currentMeta.join(' · ')}` : ''}
              {currentPhase.reason ? ` · ${currentPhase.reason}` : ''}
            </p>
          )}
        </div>
        <p className="text-xs" style={{ color: 'var(--ghost)' }}>
          Every change below comes from the scanner itself. Some modules analyse data already downloaded, while target requests are sent one at a time. Fast, skipped, blocked and inconclusive steps remain visible.
        </p>
        {(incompleteCount > 0 || skippedCount > 0) && (
          <p className="font-mono text-[11px]" style={{ color: 'var(--faint)' }}>
            {incompleteCount > 0 ? `${incompleteCount} inconclusive` : ''}
            {incompleteCount > 0 && skippedCount > 0 ? ' · ' : ''}
            {skippedCount > 0 ? `${skippedCount} not applicable` : ''}
          </p>
        )}
      </div>

      {/* Technical log */}
      <details className="border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
        <summary className="label cursor-pointer px-5 py-3.5">Show technical log</summary>
        <div ref={logRef} className="h-48 overflow-y-auto px-5 py-4 space-y-1">
          {log.map((line, i) => {
            const colour =
              line.startsWith('[!]') ? 'var(--high)'
              : line.startsWith('[?]') ? 'var(--med)'
              : line.startsWith('[\u2713]') ? 'var(--ok)'
              : line.startsWith('[>]') ? 'var(--accent)'
              : line.startsWith('$') ? 'var(--text)'
              : 'var(--faint)';
            return (
              <div key={i} className="font-mono text-[12px] leading-5 break-all" style={{ color: colour }}>
                {line}
              </div>
            );
          })}
          <span className="inline-block w-1.5 h-3.5 align-middle animate-pulse-glow" style={{ background: 'var(--ghost)' }} />
        </div>
      </details>

      {/* Progress */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-4">
          <span className="font-mono text-xs truncate" style={{ color: 'var(--faint)' }}>{progressText}</span>
          <span className="font-mono text-xs shrink-0 text-white/70">{progress === null ? 'waiting' : `${progress}%`}</span>
        </div>
        <div
          className="h-2 w-full"
          style={{ background: 'var(--border)', borderRadius: 999 }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress ?? undefined}
          aria-valuetext={progressText}
          aria-label="Server-reported scan progress"
        >
          <div
            className="h-2"
            style={{ width: `${progress ?? 0}%`, background: 'var(--accent)', borderRadius: 999 }}
          />
        </div>
      </div>

      {/* Phase grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 grid-hairline" role="list" aria-label="Scan steps">
        {phases.map(({ phase, status, findingCount, coverage, durationMs, reason }) => {
          const outcomeColour =
            status === 'complete' ? 'var(--ok)'
            : status === 'incomplete' ? 'var(--med)'
            : status === 'running' ? 'var(--accent)'
            : 'var(--ghost)';
          const indicatorColour = findingCount > 0 ? 'var(--high)' : outcomeColour;
          const requestParts = coverageParts(coverage);
          const duration = formatDuration(durationMs);
          const meta = [...requestParts, ...(duration ? [duration] : [])];
          return (
            <div
              key={phase.id}
              className="flex items-start gap-3 px-4 py-3.5 min-w-0"
              role="listitem"
              aria-current={status === 'running' ? 'step' : undefined}
              style={{ background: status === 'running' ? 'var(--accent-dim)' : undefined }}
            >
              <span className="font-mono text-[11px] w-3 shrink-0 text-center mt-0.5" style={{ color: indicatorColour }} aria-hidden="true">
                {findingCount > 0
                  ? '!'
                  : status === 'running'
                    ? '\u2022'
                    : status === 'complete'
                      ? '\u2713'
                      : status === 'incomplete'
                        ? '?'
                        : status === 'not_applicable'
                          ? '\u2212'
                          : '\u25cb'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <span className="font-mono text-[12px] leading-5 truncate" style={{ color: status === 'pending' ? 'var(--ghost)' : 'var(--muted)' }}>
                    {phase.label}
                  </span>
                  {findingCount > 0 && (
                    <span className="ml-auto font-mono text-[9px] leading-4 px-1.5 border shrink-0" style={{ color: 'var(--high)', borderColor: 'currentColor', borderRadius: 3 }}>
                      {findingCount} finding{findingCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <p className="font-mono text-[10px] leading-4" style={{ color: outcomeColour }}>
                  {phaseOutcomeLabel(status)}{meta.length > 0 ? ` · ${meta.join(' · ')}` : ''}
                </p>
                {reason && (status === 'incomplete' || status === 'not_applicable') && (
                  <p className="text-[11px] leading-4 mt-1" style={{ color: 'var(--faint)' }}>{reason}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
