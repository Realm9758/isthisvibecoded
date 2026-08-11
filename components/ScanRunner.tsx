'use client';

import { useState, useEffect, useRef } from 'react';
import type { DeepScanResult, DeepFinding } from '@/types/deep-scan';
import type { ScanPhase } from '@/lib/scan-phases';

/**
 * Consumes a scan's SSE stream and renders live progress.
 *
 * Both the landing page and the dashboard run scans, so this lives in one
 * place rather than being duplicated. It knows nothing about lanes: the
 * endpoint and body decide which lane runs, and the phase list arrives from
 * the server, so the surface lane simply streams fewer rows.
 */

export type CompletedScan = DeepScanResult & {
  scanId: string;
  claimToken?: string | null;
  redacted?: boolean;
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
  // keeps a re-render from aborting and restarting a scan in flight.
  const bodyRef = useRef(body);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  bodyRef.current = body;
  onResultRef.current = onResult;
  onErrorRef.current = onError;

  useEffect(() => {
    const ctrl = new AbortController();
    const addLog = (line: string) => setLog(prev => [...prev.slice(-60), line]);

    (async () => {
      addLog(`$ ironclad --target ${label}`);
      addLog('Starting scan…');

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyRef.current),
        signal: ctrl.signal,
      }).catch(() => null);

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
    <div className="space-y-4">
      <div className="rounded-xl border border-white/8 bg-black/60 overflow-hidden font-mono">
        <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-white/5 bg-white/2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          <span className="ml-2 text-[10px] text-white/25 truncate">ironclad: {label}</span>
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[9px] text-red-400/70 uppercase tracking-wider">Live</span>
          </div>
        </div>

        <div ref={logRef} className="h-40 overflow-y-auto p-3 space-y-0.5">
          {log.map((line, i) => {
            const isFound = line.startsWith('[!]');
            const isClean = line.startsWith('[✓]');
            const isRunning = line.startsWith('[>]');
            const isCmd = line.startsWith('$');
            return (
              <div
                key={i}
                className="text-[11px] leading-5 break-all"
                style={{
                  color: isFound ? '#f97316' : isClean ? '#4ade80' : isRunning ? '#38bdf8' : isCmd ? '#a78bfa' : 'rgba(255,255,255,0.4)',
                }}
              >
                {line}
              </div>
            );
          })}
          <div className="text-[11px] text-white/30">
            <span className="inline-block w-1.5 h-3 bg-white/30 animate-pulse align-middle" />
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-white/40 truncate max-w-xs">{currentDetail}</span>
          <span className="text-xs font-bold text-white/50 shrink-0 ml-2">{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #dc2626, #f97316)',
              boxShadow: '0 0 8px rgba(220,38,38,0.5)',
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {phases.map(({ phase, status, findingCount }) => (
          <div
            key={phase.id}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all"
            style={{
              background: status === 'found' ? 'rgba(249,115,22,0.08)' : status === 'done' ? 'rgba(34,197,94,0.06)' : status === 'running' ? 'rgba(56,189,248,0.08)' : 'rgba(255,255,255,0.02)',
              borderColor: status === 'found' ? 'rgba(249,115,22,0.25)' : status === 'done' ? 'rgba(34,197,94,0.2)' : status === 'running' ? 'rgba(56,189,248,0.3)' : 'rgba(255,255,255,0.06)',
            }}
          >
            {status === 'running' && (
              <div className="w-3 h-3 rounded-full border border-sky-400/60 border-t-sky-400 animate-spin shrink-0" />
            )}
            {status === 'done' && <span className="text-emerald-400 shrink-0 text-[10px]">✓</span>}
            {status === 'found' && <span className="text-orange-400 shrink-0 text-[10px]">!</span>}
            {status === 'pending' && <span className="text-white/15 shrink-0 text-[10px]">○</span>}
            <span
              className="truncate"
              style={{ color: status === 'found' ? '#fb923c' : status === 'done' ? '#4ade80' : status === 'running' ? '#38bdf8' : 'rgba(255,255,255,0.3)' }}
            >
              {phase.label}
            </span>
            {status === 'found' && findingCount > 0 && (
              <span className="ml-auto shrink-0 text-[9px] font-bold text-orange-400/80">{findingCount}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
