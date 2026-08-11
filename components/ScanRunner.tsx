'use client';

import { useState, useEffect, useRef } from 'react';
import type { DeepScanResult, DeepFinding } from '@/types/deep-scan';
import type { ScanPhase } from '@/lib/scan-phases';
import { apiPath } from '@/lib/site';

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
}

type PhaseState = {
  phase: ScanPhase;
  status: 'pending' | 'running' | 'done' | 'found';
  findingCount: number;
};

export function ScanRunner({ endpoint, body, label, onResult, onError }: Props) {
  const [phases, setPhases] = useState<PhaseState[]>([]);
  const [currentDetail, setCurrentDetail] = useState('Initialising scanner…');
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // The parent usually passes inline literals for these. Holding them in refs
  // keeps a re-render from aborting and restarting a scan in flight. They are
  // written in an effect rather than during render, so a discarded render
  // cannot leave a ref pointing at a callback that was never committed.
  const bodyRef = useRef(body);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    bodyRef.current = body;
    onResultRef.current = onResult;
    onErrorRef.current = onError;
  }, [body, onResult, onError]);

  useEffect(() => {
    const ctrl = new AbortController();
    const addLog = (line: string) => setLog(prev => [...prev.slice(-60), line]);

    (async () => {
      addLog(`$ ironclad --target ${label}`);
      addLog('Starting scan…');

      const res = await fetch(apiPath(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
              setPhases((data as ScanPhase[]).map(p => ({ phase: p, status: 'pending', findingCount: 0 })));
            }

            if (event === 'phase') {
              const { id, label: phaseLabel, detail, findings, status } =
                data as ScanPhase & { findings: DeepFinding[]; status: 'start' | 'complete' };

              setCurrentDetail(detail);

              if (status === 'start') {
                addLog(`[>] ${phaseLabel}: ${detail}`);
                setPhases(prev => prev.map(p => (p.phase.id === id ? { ...p, status: 'running' } : p)));
              } else {
                const count = findings.length;
                if (count > 0) {
                  addLog(`[!] ${phaseLabel}: ${count} finding${count > 1 ? 's' : ''}, ${findings.map(f => f.severity.toUpperCase()).join(', ')}`);
                } else {
                  addLog(`[✓] ${phaseLabel}: no matching finding`);
                }
                setPhases(prev => prev.map(p =>
                  p.phase.id === id ? { ...p, status: count > 0 ? 'found' : 'done', findingCount: count } : p
                ));
              }
            }

            if (event === 'result') {
              terminalEventReceived = true;
              const completed = data as CompletedScan;
              addLog(`[✓] Scan complete: ${completed.findings.length} findings, ${
                completed.summary.score === null
                  ? 'grade withheld because coverage was incomplete'
                  : `grade ${completed.summary.score}/100`
              }`);
              onResultRef.current(completed);
            }

            if (event === 'error') {
              terminalEventReceived = true;
              onErrorRef.current(data.error ?? 'Scan failed', {});
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
    })();

    return () => ctrl.abort();
  }, [endpoint, label]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [log]);

  const doneCount = phases.filter(p => p.status === 'done' || p.status === 'found').length;
  const progress = phases.length ? Math.round((doneCount / phases.length) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Terminal */}
      <div className="border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
        <div className="flex items-center gap-3 px-5 py-3.5 border-b" style={{ borderColor: 'var(--border)' }}>
          <span className="w-2 h-2 rounded-full animate-pulse-glow shrink-0" style={{ background: 'var(--accent)' }} />
          <span className="font-mono text-sm text-white truncate">{label}</span>
          <span className="ml-auto label shrink-0">live</span>
        </div>

        <div ref={logRef} className="h-48 overflow-y-auto px-5 py-4 space-y-1">
          {log.map((line, i) => {
            const colour =
              line.startsWith('[!]') ? 'var(--high)'
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
      </div>

      {/* Progress */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-4">
          <span className="font-mono text-xs truncate" style={{ color: 'var(--faint)' }}>{currentDetail}</span>
          <span className="font-mono text-xs shrink-0 text-white/70">{progress}%</span>
        </div>
        <div className="h-px w-full" style={{ background: 'var(--border)' }}>
          <div
            className="h-px transition-all duration-700"
            style={{ width: `${progress}%`, background: 'var(--accent)' }}
          />
        </div>
      </div>

      {/* Phase grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 grid-hairline">
        {phases.map(({ phase, status, findingCount }) => {
          const colour =
            status === 'found' ? 'var(--high)'
            : status === 'done' ? 'var(--ok)'
            : status === 'running' ? 'var(--accent)'
            : 'var(--ghost)';
          return (
            <div key={phase.id} className="flex items-center gap-2.5 px-4 py-3 min-w-0">
              <span className="font-mono text-[10px] w-3 shrink-0 text-center" style={{ color: colour }}>
                {status === 'running' ? '\u2022' : status === 'done' ? '\u2713' : status === 'found' ? '!' : '\u25cb'}
              </span>
              <span className="font-mono text-[12px] truncate" style={{ color: status === 'pending' ? 'var(--ghost)' : 'var(--muted)' }}>
                {phase.label}
              </span>
              {status === 'found' && findingCount > 0 && (
                <span className="ml-auto font-mono text-[10px] shrink-0" style={{ color: 'var(--high)' }}>
                  {findingCount}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
