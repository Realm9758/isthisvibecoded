'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DeepFinding, ScanPhaseProgress } from '@/types/deep-scan';
import type { ScanPhase } from '@/lib/scan-phases';
import type { ScanAccessDiagnostic, ScanJobStatus, ScanProbeEvent } from '@/types/scan-job';
import type { CompletedScan, ScanErrorMeta } from '@/components/ScanRunner';
import { apiPath } from '@/lib/site';
import { MUTATION_GUARD_HEADER, MUTATION_GUARD_VALUE } from '@/lib/request-security-constants';
import { explainPhaseReason, formatTerminalPhaseLog } from '@/lib/scan-progress-presentation';

interface Props {
  body: Record<string, unknown>;
  label: string;
  existingJobId?: string | null;
  onResult: (result: CompletedScan) => void;
  onError: (message: string, meta: ScanErrorMeta) => void;
}

type PhaseState = {
  phase: ScanPhase;
  status: 'pending' | 'running' | 'complete' | 'incomplete' | 'not_applicable';
  findingCount: number;
  coverage: ScanPhaseProgress['coverage'] | null;
  reason: string | null;
  durationMs: number | null;
  completedProbes: number;
  plannedProbes: number | null;
};

type JobStatePayload = {
  state: ScanJobStatus;
  message: string;
  diagnostic?: ScanAccessDiagnostic;
  guide?: { title: string; steps: string[] };
  creditUsed?: boolean;
};

const TERMINAL_PHASES = new Set(['complete', 'incomplete', 'not_applicable']);
const TERMINAL_JOBS = new Set<ScanJobStatus>(['complete', 'failed', 'cancelled']);

function phaseState(phase: ScanPhase): PhaseState {
  return {
    phase, status: 'pending', findingCount: 0, coverage: null, reason: null,
    durationMs: null, completedProbes: 0, plannedProbes: null,
  };
}

function probeLine(probe: ScanProbeEvent): string {
  const prefix = probe.stage === 'retry_wait' ? '[?]' : probe.classification === 'bot_challenge' || probe.classification === 'rate_limited' ? '[!]' : '[·]';
  const position = probe.moduleIndex > 0 ? `Module ${probe.moduleIndex}/${probe.moduleCount}` : 'Firewall check';
  const probeCount = probe.plannedProbes ? ` · request ${probe.probeIndex}/${probe.plannedProbes}` : ` · request ${probe.probeIndex}`;
  const status = probe.status ? ` · HTTP ${probe.status}` : '';
  const duration = probe.durationMs !== undefined ? ` · ${probe.durationMs} ms` : '';
  return `${prefix} ${position}${probeCount} · ${probe.method} ${probe.path}${status}${duration} — ${probe.message}`;
}

function parseSseBlocks(source: string): Array<{ id: number | null; event: string; data: unknown }> {
  return source.split('\n\n').flatMap(block => {
    const lines = block.split('\n');
    const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
    const dataLines = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart());
    if (!event || dataLines.length === 0) return [];
    const idValue = Number(lines.find(line => line.startsWith('id:'))?.slice(3).trim());
    try {
      return [{ id: Number.isSafeInteger(idValue) ? idValue : null, event, data: JSON.parse(dataLines.join('\n')) as unknown }];
    } catch {
      return [];
    }
  });
}

export function DurableDeepScanRunner({ body, label, existingJobId, onResult, onError }: Props) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<ScanJobStatus>('queued');
  const [stateMessage, setStateMessage] = useState('Creating a durable scan job…');
  const [phases, setPhases] = useState<PhaseState[]>([]);
  const [currentProbe, setCurrentProbe] = useState<ScanProbeEvent | null>(null);
  const [access, setAccess] = useState<JobStatePayload | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef(body);
  const callbacksRef = useRef({ onResult, onError });

  useEffect(() => { bodyRef.current = body; callbacksRef.current = { onResult, onError }; }, [body, onResult, onError]);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - started) / 1_000)), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (autoScroll) logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [autoScroll, log]);

  useEffect(() => {
    const controller = new AbortController();
    const addLog = (line: string) => setLog(previous => [...previous, line].slice(-1_000));

    async function run() {
      addLog(`$ ironclad deep --target ${label}`);
      let creation: { jobId: string; state: ScanJobStatus; eventsUrl: string };
      if (existingJobId) {
        addLog('[·] Reconnecting to your saved scan from its last recorded event.');
        const statusResponse = await fetch(apiPath(`/api/deep-scan/jobs/${existingJobId}`), {
          signal: controller.signal, cache: 'no-store',
        }).catch(() => null);
        const saved = statusResponse?.ok ? await statusResponse.json().catch(() => null) : null;
        if (!saved || typeof saved.id !== 'string' || typeof saved.eventsUrl !== 'string') {
          callbacksRef.current.onError('The saved scan could not be reopened. Start a new scan from the dashboard.', {});
          return;
        }
        creation = { jobId: saved.id, state: saved.status, eventsUrl: saved.eventsUrl };
      } else {
        addLog('[·] Creating a resumable scan. No scan credit is used during the firewall check.');
        const created = await fetch(apiPath('/api/deep-scan'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [MUTATION_GUARD_HEADER]: MUTATION_GUARD_VALUE },
          body: JSON.stringify(bodyRef.current),
          signal: controller.signal,
        }).catch(() => null);
        if (controller.signal.aborted) return;
        const createdPayload = created ? await created.json().catch(() => ({})) : {};
        if (!created || created.status !== 202 || typeof createdPayload.jobId !== 'string' || typeof createdPayload.eventsUrl !== 'string') {
          callbacksRef.current.onError(createdPayload.error ?? 'Ironclad could not create the scan job.', {
            upgradeRequired: createdPayload.upgradeRequired === true,
          });
          return;
        }
        creation = createdPayload as typeof creation;
      }
      setJobId(creation.jobId);
      setJobState(creation.state);

      let lastEventId = 0;
      let finished = false;
      while (!finished && !controller.signal.aborted) {
        const response = await fetch(`${apiPath(creation.eventsUrl)}?after=${lastEventId}`, {
          headers: lastEventId > 0 ? { 'Last-Event-ID': String(lastEventId) } : {},
          signal: controller.signal,
          cache: 'no-store',
        }).catch(() => null);
        if (!response?.ok || !response.body) {
          await new Promise(resolve => window.setTimeout(resolve, 1_000));
          continue;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!controller.signal.aborted) {
          const chunk = await reader.read().catch(() => ({ done: true, value: undefined }));
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const boundary = buffer.lastIndexOf('\n\n');
          if (boundary < 0) continue;
          const complete = buffer.slice(0, boundary + 2);
          buffer = buffer.slice(boundary + 2);
          for (const item of parseSseBlocks(complete)) {
            if (item.id !== null) lastEventId = Math.max(lastEventId, item.id);
            if (item.event === 'manifest') {
              const manifest = item.data as { phases?: ScanPhase[]; moduleCount?: number; explanation?: string };
              setPhases(Array.isArray(manifest.phases) ? manifest.phases.map(phaseState) : []);
              if (manifest.explanation) addLog(`[·] ${manifest.explanation}`);
            }
            if (item.event === 'job_state') {
              const state = item.data as JobStatePayload;
              setJobState(state.state);
              setStateMessage(state.message);
              addLog(`${state.state === 'waiting_for_access' ? '[!]' : '[>]'} ${state.message}`);
              if (state.state === 'waiting_for_access') setAccess(state);
              if (state.state === 'cancelled') {
                finished = true;
                callbacksRef.current.onError('The scan was cancelled. No further requests were sent.', {});
              }
            }
            if (item.event === 'perimeter') {
              const perimeter = item.data as { accessReady?: boolean };
              addLog(perimeter.accessReady
                ? '[✓] Firewall access check passed. Ironclad can now inspect application responses.'
                : '[!] The firewall stopped at least one access check.');
            }
            if (item.event === 'probe') {
              const probe = item.data as ScanProbeEvent;
              setCurrentProbe(probe);
              if (probe.stage === 'requesting' || probe.stage === 'retry_wait' || probe.stage === 'complete') {
                addLog(probeLine(probe));
              }
            }
            if (item.event === 'phase') {
              const phase = item.data as ScanPhase & ScanPhaseProgress & { findings?: DeepFinding[] };
              const status = phase.status === 'start' || phase.status === 'progress' ? 'running' : phase.status;
              const findings = Array.isArray(phase.findings) ? phase.findings : [];
              setPhases(previous => previous.map(entry => entry.phase.id === phase.id ? {
                ...entry,
                status,
                findingCount: TERMINAL_PHASES.has(status) ? findings.length : entry.findingCount,
                coverage: phase.coverage ?? entry.coverage,
                reason: explainPhaseReason(phase.reason ?? null),
                durationMs: phase.durationMs ?? entry.durationMs,
                completedProbes: phase.completedProbes ?? entry.completedProbes,
                plannedProbes: phase.plannedProbes ?? entry.plannedProbes,
              } : entry));
              if (phase.status === 'start') addLog(`[>] Module started: ${phase.label} — ${phase.detail}`);
              if (TERMINAL_PHASES.has(phase.status)) addLog(formatTerminalPhaseLog({
                label: phase.label, status: phase.status as 'complete' | 'incomplete' | 'not_applicable',
                findingCount: findings.length, findingSeverities: findings.map(finding => finding.severity),
                reason: explainPhaseReason(phase.reason ?? null),
              }));
            }
            if (item.event === 'result') {
              const saved = item.data as { resultUrl?: string };
              const reportResponse = saved.resultUrl
                ? await fetch(apiPath(saved.resultUrl), { signal: controller.signal, cache: 'no-store' })
                : null;
              const report = reportResponse?.ok ? await reportResponse.json().catch(() => null) : null;
              if (!report) {
                finished = true;
                callbacksRef.current.onError('The scan finished, but the saved report could not be opened.', {});
              } else {
                finished = true;
                setJobState('complete');
                addLog('[✓] Report saved. Every selected module has a recorded outcome.');
                callbacksRef.current.onResult(report as CompletedScan);
              }
            }
            if (item.event === 'error') {
              finished = true;
              setJobState('failed');
              const error = item.data as { error?: string };
              callbacksRef.current.onError(error.error ?? 'The scan worker stopped safely before producing a report.', {});
            }
            if (item.event === 'stream_notice') {
              const notice = item.data as { message?: string };
              addLog(`[?] ${notice.message ?? 'The live connection was interrupted. Reconnecting from the last saved step.'}`);
            }
          }
        }
        if (!finished && !controller.signal.aborted) {
          const statusResponse = await fetch(apiPath(`/api/deep-scan/jobs/${creation.jobId}`), {
            signal: controller.signal,
            cache: 'no-store',
          }).catch(() => null);
          const status = statusResponse?.ok ? await statusResponse.json().catch(() => null) : null;
          if (status?.status === 'complete') {
            const reportResponse = await fetch(apiPath(`/api/deep-scan/jobs/${creation.jobId}/result`), {
              signal: controller.signal,
              cache: 'no-store',
            }).catch(() => null);
            const report = reportResponse?.ok ? await reportResponse.json().catch(() => null) : null;
            if (report) {
              finished = true;
              setJobState('complete');
              addLog('[✓] Reconnected to the saved report. Every selected module has a recorded outcome.');
              callbacksRef.current.onResult(report as CompletedScan);
            }
          } else if (status?.status === 'failed' || status?.status === 'cancelled') {
            finished = true;
            setJobState(status.status);
            callbacksRef.current.onError(
              status.failureMessage
                ?? (status.status === 'cancelled' ? 'The scan was cancelled.' : 'The saved scan stopped safely before a report was produced.'),
              {},
            );
          }
        }
        if (!finished && !controller.signal.aborted) await new Promise(resolve => window.setTimeout(resolve, 500));
      }
    }

    const start = window.setTimeout(() => { void run(); }, 0);
    return () => { window.clearTimeout(start); controller.abort(); };
  }, [existingJobId, label]);

  const modules = phases.filter(item => item.phase.id !== 'init' && item.phase.id !== 'done');
  const completedModules = modules.filter(item => TERMINAL_PHASES.has(item.status)).length;
  const currentModule = currentProbe?.moduleIndex
    ? modules[currentProbe.moduleIndex - 1]
    : phases.find(item => item.status === 'running');
  const progress = modules.length > 0 ? Math.round(completedModules / modules.length * 100) : 0;
  const receipt = useMemo(() => log.join('\n'), [log]);

  async function jobAction(action: 'recheck' | 'cancel') {
    if (!jobId) return;
    const response = await fetch(apiPath(`/api/deep-scan/jobs/${jobId}/${action}`), {
      method: 'POST',
      headers: { [MUTATION_GUARD_HEADER]: MUTATION_GUARD_VALUE },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) callbacksRef.current.onError(data.error ?? `Could not ${action} this scan.`, {});
    if (action === 'recheck' && response.ok) {
      setAccess(null);
      setJobState('queued');
      setStateMessage('Access recheck queued. The terminal will continue automatically.');
    }
  }

  function downloadReceipt() {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([receipt], { type: 'text/plain;charset=utf-8' }));
    link.download = `ironclad-${label.replace(/[^a-z0-9.-]+/gi, '-')}-execution.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <section className="border p-5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
        <div className="flex flex-wrap gap-3 items-baseline">
          <span className="w-2 h-2 rounded-full animate-pulse-glow" style={{ background: jobState === 'waiting_for_access' ? 'var(--med)' : 'var(--accent)' }} />
          <span className="font-mono text-sm text-white">{label}</span>
          <span className="ml-auto font-mono text-xs" style={{ color: 'var(--faint)' }}>{completedModules}/{modules.length || '…'} modules · {elapsedSeconds}s</span>
        </div>
        <p className="text-sm text-white/80">{stateMessage}</p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          {jobState === 'perimeter_running'
            ? 'First, Ironclad is checking whether your public firewall allows safe scanner traffic. This does not use a scan credit.'
            : jobState === 'application_running'
              ? 'The application review is active. Modules and target requests run one at a time, so you can follow every check below.'
              : jobState === 'waiting_for_access'
                ? 'Your report is saved in place. Ironclad has stopped sending requests until you allow access and choose Recheck access.'
                : 'This scan is stored as a job, so reconnecting or closing this page does not lose completed work.'}
        </p>
        {currentProbe && jobState !== 'waiting_for_access' && (
          <div className="border-l-2 pl-3" style={{ borderColor: 'var(--accent-line)' }}>
            <p className="font-mono text-xs" style={{ color: 'var(--accent)' }}>
              {currentProbe.moduleIndex > 0 ? `Module ${currentProbe.moduleIndex} of ${currentProbe.moduleCount}` : 'Firewall access check'}
              {' · '}Request {currentProbe.probeIndex}{currentProbe.plannedProbes ? ` of ${currentProbe.plannedProbes}` : ''}
            </p>
            <p className="text-sm mt-1 text-white/75">{currentProbe.message}</p>
            <details className="mt-1">
              <summary className="font-mono text-[11px] cursor-pointer" style={{ color: 'var(--ghost)' }}>technical request details</summary>
              <p className="font-mono text-[11px] mt-1" style={{ color: 'var(--faint)' }}>{currentProbe.method} {currentProbe.path}{currentProbe.status ? ` · HTTP ${currentProbe.status}` : ''}</p>
            </details>
          </div>
        )}
      </section>

      {access?.guide && (
        <section className="border p-5" style={{ borderColor: 'rgba(245,158,11,0.35)', borderRadius: 6 }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--high)' }}>{access.guide.title}</h3>
          <p className="text-sm leading-relaxed mt-2" style={{ color: 'var(--muted)' }}>
            Your firewall stopped Ironclad before it could reliably inspect the application. This is not a vulnerability and it is not a clean result.
          </p>
          <ol className="mt-4 space-y-2 list-decimal pl-5 text-sm text-white/75">
            {access.guide.steps.map(step => <li key={step}>{step}</li>)}
          </ol>
          <p className="font-mono text-[11px] mt-3" style={{ color: 'var(--faint)' }}>
            {access.creditUsed ? 'Your existing scan credit remains attached; resuming does not charge again.' : 'No scan credit has been used yet.'}
          </p>
          <div className="flex flex-wrap gap-3 mt-4">
            <button onClick={() => void jobAction('recheck')} className="px-5 py-2.5 text-sm font-semibold text-white" style={{ background: 'var(--accent)', borderRadius: 4 }}>Recheck access</button>
            <button onClick={() => void jobAction('cancel')} className="px-5 py-2.5 text-sm border" style={{ borderColor: 'var(--border-2)', color: 'var(--faint)', borderRadius: 4 }}>Cancel scan</button>
          </div>
        </section>
      )}

      <div>
        <div className="flex justify-between font-mono text-xs mb-2" style={{ color: 'var(--faint)' }}>
          <span>{currentModule ? currentModule.phase.label : 'Preparing scanner'}</span><span>{progress}%</span>
        </div>
        <div className="h-2" role="progressbar" aria-label="Completed scan modules" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} style={{ background: 'var(--border)', borderRadius: 999 }}>
          <div className="h-2" style={{ width: `${progress}%`, background: 'var(--accent)', borderRadius: 999 }} />
        </div>
      </div>

      <details open className="border overflow-hidden" style={{ borderColor: 'var(--border)', borderRadius: 6 }}>
        <summary className="px-5 py-3.5 cursor-pointer flex gap-3 items-center">
          <span className="label">Live scan activity</span>
          <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--ghost)' }}>every saved step</span>
        </summary>
        <div className="border-t flex gap-4 px-5 py-2" style={{ borderColor: 'var(--border)' }}>
          <label className="font-mono text-[10px] flex items-center gap-2" style={{ color: 'var(--faint)' }}><input type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.target.checked)} /> follow latest</label>
          <button onClick={downloadReceipt} className="font-mono text-[10px] hover:text-white" style={{ color: 'var(--faint)' }}>download execution receipt</button>
        </div>
        <div ref={logRef} className="h-72 overflow-y-auto px-5 py-4 space-y-1">
          {log.map((line, index) => <div key={`${index}:${line}`} className="font-mono text-[11px] leading-5 break-all" style={{ color: line.startsWith('[!]') ? 'var(--high)' : line.startsWith('[✓]') ? 'var(--ok)' : line.startsWith('[>]') ? 'var(--accent)' : 'var(--faint)' }}>{line}</div>)}
        </div>
      </details>

      <div className="grid sm:grid-cols-2 grid-hairline" role="list" aria-label="Selected scan modules">
        {modules.map((module, index) => <div key={module.phase.id} role="listitem" className="px-4 py-3 flex gap-3">
          <span className="font-mono text-[11px] w-5" style={{ color: module.status === 'complete' ? 'var(--ok)' : module.status === 'running' ? 'var(--accent)' : module.status === 'incomplete' ? 'var(--med)' : 'var(--ghost)' }}>{String(index + 1).padStart(2, '0')}</span>
          <div><p className="text-xs text-white/80">{module.phase.label}</p><p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>{module.status === 'pending' ? 'Waiting' : module.status === 'running' ? 'Testing now' : module.status === 'not_applicable' ? 'Not needed for this site' : module.status === 'incomplete' ? 'Needs more evidence' : module.findingCount > 0 ? `${module.findingCount} finding${module.findingCount === 1 ? '' : 's'}` : 'Completed'}</p>{module.reason && <p className="text-[10px] mt-1" style={{ color: 'var(--ghost)' }}>{module.reason}</p>}</div>
        </div>)}
      </div>

      {jobId && !TERMINAL_JOBS.has(jobState) && jobState !== 'waiting_for_access' && <button onClick={() => void jobAction('cancel')} className="font-mono text-xs" style={{ color: 'var(--ghost)' }}>Cancel scan</button>}
    </div>
  );
}
