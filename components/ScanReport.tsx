'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ScoreRing } from '@/components/ScoreRing';
import { generateRoasts } from '@/lib/roast';
import { LANE_CHECK_COUNTS, SURFACE_PHASE_IDS, DEEP_ONLY_PHASE_IDS } from '@/lib/scan-lanes';
import type { ScanDiff } from '@/lib/scan-diff';
import type { DeepScanResult, DeepFinding, DeepFindingSeverity } from '@/types/deep-scan';
import type { PublicScanResult } from '@/lib/scan-redaction';

/**
 * Renders one scan at either fidelity.
 *
 * A redacted result is the same report with the persuasive parts missing, not
 * a different screen: the reader must be able to see that three critical
 * findings exist before deciding whether an account is worth it.
 */

type AnyScanResult = (DeepScanResult | PublicScanResult) & { redacted?: boolean };

interface Props {
  result: AnyScanResult;
  diff?: ScanDiff;
  onReset?: () => void;
}

const SEVERITY_ORDER: DeepFindingSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY_STYLE: Record<DeepFindingSeverity, { color: string; label: string }> = {
  critical: { color: '#ef4444', label: 'Critical' },
  high:     { color: '#f97316', label: 'High' },
  medium:   { color: '#eab308', label: 'Medium' },
  low:      { color: '#38bdf8', label: 'Low' },
  info:     { color: '#a1a1aa', label: 'Info' },
};

function gradeFor(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 50) return 'C';
  if (score >= 25) return 'D';
  return 'F';
}

function gradeColor(score: number): string {
  if (score >= 90) return '#22c55e';
  if (score >= 75) return '#84cc16';
  if (score >= 50) return '#eab308';
  if (score >= 25) return '#f97316';
  return '#ef4444';
}

/**
 * The verdict. "Ironclad" is reserved for a clean scan with complete
 * coverage, because a grade produced from checks that could not run is not
 * a pass, it is an absence of evidence.
 */
function verdict(result: AnyScanResult): { headline: string; tone: string } {
  const { critical, high, medium, low } = result.summary;
  if (result.summary.score === null) {
    return { headline: 'Coverage incomplete', tone: '#a1a1aa' };
  }
  if (critical > 0 || high > 0) return { headline: 'Not ironclad', tone: '#ef4444' };
  if (medium > 0 || low > 0) return { headline: 'Nearly ironclad', tone: '#eab308' };
  return { headline: 'Ironclad', tone: '#22c55e' };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

export function ScanReport({ result, diff, onReset }: Props) {
  const [roastMode, setRoastMode] = useState(false);
  const redacted = result.redacted === true;
  const lane = result.lane ?? 'deep';
  const { headline, tone } = verdict(result);

  const roasts = useMemo(
    () => (roastMode ? generateRoasts(result as DeepScanResult) : []),
    [roastMode, result],
  );

  const skipped = result.checked.filter(item => item.status === 'skip');
  const blocked = (result.coverage?.checks ?? []).filter(check => !check.complete);
  const findingsBySeverity = SEVERITY_ORDER
    .map(severity => ({ severity, items: result.findings.filter(f => f.severity === severity) }))
    .filter(group => group.items.length > 0);

  const clean = result.findings.length === 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Verdict */}
      <section className="rounded-2xl border border-white/8 bg-white/2 p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row items-center gap-8">
          {result.summary.score === null ? (
            <div className="flex flex-col items-center gap-2 shrink-0" style={{ width: 140 }}>
              <div
                className="rounded-full flex flex-col items-center justify-center"
                style={{ width: 140, height: 140, border: '10px solid rgba(255,255,255,0.06)' }}
              >
                <span className="text-2xl font-bold text-white/40">?</span>
                <span className="text-[10px] text-white/25 mt-1">no grade</span>
              </div>
            </div>
          ) : (
            <ScoreRing
              score={result.summary.score}
              color={gradeColor(result.summary.score)}
              label={gradeFor(result.summary.score)}
              sublabel={`${result.summary.score}/100`}
              caption=""
            />
          )}

          <div className="flex-1 min-w-0 text-center sm:text-left">
            <h2 className="text-2xl font-bold mb-1" style={{ color: tone }}>{headline}</h2>
            <p className="text-sm text-white/45 font-mono truncate">{result.domain}</p>

            {result.summary.score === null && (
              <p className="text-xs text-white/35 mt-3 leading-relaxed">
                {skipped.length} check{skipped.length === 1 ? '' : 's'} could not complete, so no grade is shown.
                A number built from checks that did not run would flatter the site rather than describe it.
              </p>
            )}

            {clean && result.summary.score !== null && lane === 'surface' && (
              <p className="text-sm text-white/45 mt-3 leading-relaxed">
                No issues found in {LANE_CHECK_COUNTS.surface} surface checks.{' '}
                {DEEP_ONLY_PHASE_IDS.length} deeper checks require domain verification.
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2 justify-center sm:justify-start">
              <span className="text-[10px] uppercase tracking-widest text-white/25 px-2 py-1 rounded border border-white/8">
                {lane === 'surface'
                  ? `Surface scan, ${LANE_CHECK_COUNTS.surface} checks`
                  : `Deep scan, ${LANE_CHECK_COUNTS.deep} checks`}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-white/25 px-2 py-1 rounded border border-white/8">
                {formatDate(result.scannedAt)}
              </span>
            </div>
          </div>
        </div>

        {/* Roast Mode */}
        <div className="mt-6 pt-5 border-t border-white/5">
          <button
            onClick={() => setRoastMode(r => !r)}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-medium transition-all ${
              roastMode
                ? 'bg-orange-500/15 border-orange-500/35 text-orange-400'
                : 'border-white/10 text-white/35 hover:border-white/20 hover:text-white/55'
            }`}
          >
            <span>🔥</span>
            {roastMode ? 'Roast Mode on' : 'Roast Mode'}
          </button>
          {roastMode && (
            <ul className="mt-3 space-y-1.5">
              {roasts.map(line => (
                <li key={line} className="text-sm text-orange-300/75 leading-relaxed">{line}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Rescan comparison */}
      {diff?.comparable && (diff.resolved.length > 0 || diff.added.length > 0) && (
        <section className="rounded-xl border border-white/8 bg-white/2 px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span className="text-emerald-400">{diff.resolved.length} resolved</span>
          <span className="text-orange-400">{diff.added.length} new</span>
          <span className="text-white/35">{diff.stillOpen.length} still open</span>
          <span className="text-white/25 text-xs ml-auto">since your last scan</span>
        </section>
      )}

      {/* Coverage banner */}
      {blocked.length > 0 && (
        <section className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
          <h3 className="text-sm font-semibold text-amber-300/90 mb-1">
            {blocked.length} check{blocked.length === 1 ? '' : 's'} could not complete
          </h3>
          <p className="text-xs text-white/40 mb-3 leading-relaxed">
            This is a gap in what was observed, not a clean result. Sites behind a firewall or a bot filter
            often block scanners.
          </p>
          <ul className="space-y-1">
            {blocked.map(check => {
              const item = result.checked.find(c => c.id === check.phaseId);
              return (
                <li key={check.phaseId} className="text-xs text-white/45 flex gap-2">
                  <span className="text-amber-400/50 shrink-0">›</span>
                  <span><span className="text-white/60">{item?.label ?? check.phaseId}</span>: {check.reason}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Severity counts */}
      <section className="grid grid-cols-5 gap-2">
        {SEVERITY_ORDER.map(severity => {
          const count = result.summary[severity];
          const { color, label } = SEVERITY_STYLE[severity];
          return (
            <div
              key={severity}
              className="rounded-xl border p-3 text-center"
              style={{
                borderColor: count > 0 ? `${color}33` : 'rgba(255,255,255,0.06)',
                background: count > 0 ? `${color}0d` : 'rgba(255,255,255,0.02)',
              }}
            >
              <div className="text-xl font-bold" style={{ color: count > 0 ? color : 'rgba(255,255,255,0.2)' }}>
                {count}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-white/30 mt-0.5">{label}</div>
            </div>
          );
        })}
      </section>

      {/* Findings */}
      {findingsBySeverity.length > 0 && (
        <section className="space-y-5">
          {findingsBySeverity.map(({ severity, items }) => (
            <div key={severity}>
              <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: SEVERITY_STYLE[severity].color }}>
                {SEVERITY_STYLE[severity].label} ({items.length})
              </h3>
              <div className="space-y-2">
                {items.map(finding => (
                  <FindingCard key={`${finding.id}:${'url' in finding ? finding.url ?? '' : ''}`} finding={finding} redacted={redacted} />
                ))}
              </div>
            </div>
          ))}

          {redacted && (
            <div
              className="rounded-xl border border-violet-500/20 p-6 text-center"
              style={{ background: 'rgba(139,92,246,0.06)' }}
            >
              <p className="text-sm font-semibold text-white/75 mb-1">
                {result.findings.length} finding{result.findings.length === 1 ? '' : 's'} found, details withheld
              </p>
              <p className="text-xs text-white/40 mb-4 max-w-md mx-auto leading-relaxed">
                Create a free account to see where each one is, what the evidence was, and how to fix it.
                Three full scans, no card.
              </p>
              <Link
                href="/signup"
                className="inline-flex px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
              >
                See the full report
              </Link>
            </div>
          )}
        </section>
      )}

      {/* Checked list */}
      <section className="rounded-2xl border border-white/8 bg-white/2 p-6">
        <h3 className="text-sm font-semibold text-white/70 mb-4">Every check that ran</h3>
        <div className="space-y-1.5">
          {result.checked.map(item => (
            <div key={item.id} className="flex items-start gap-3 py-1.5">
              <span className="shrink-0 mt-0.5 text-[11px] w-4 text-center">
                {item.status === 'pass' && <span className="text-emerald-400">✓</span>}
                {item.status === 'warn' && <span className="text-yellow-400">!</span>}
                {item.status === 'fail' && <span className="text-red-400">✕</span>}
                {item.status === 'skip' && <span className="text-white/20">○</span>}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-medium ${item.status === 'skip' ? 'text-white/35' : 'text-white/70'}`}>
                  {item.label}
                </p>
                {'detail' in item && item.detail && (
                  <p className="text-[11px] text-white/30 leading-relaxed mt-0.5">{item.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Deep lane upsell */}
      {lane === 'surface' && (
        <section
          className="rounded-2xl border border-red-500/15 p-6"
          style={{ background: 'rgba(239,68,68,0.04)' }}
        >
          <h3 className="text-sm font-bold text-white/80 mb-1">
            {DEEP_ONLY_PHASE_IDS.length} more checks need your permission
          </h3>
          <p className="text-xs text-white/40 leading-relaxed max-w-2xl">
            SQL injection, cross-site scripting, path traversal, SSRF, access control, and brute-force
            resistance all send test payloads at a server. We only do that against a domain you have proved
            you control, which is a legal boundary rather than a paywall. Verify your domain to unlock them.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex mt-4 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}
          >
            Verify a domain
          </Link>
        </section>
      )}

      {/* Provenance */}
      {result.provenance?.builder && (
        <section className="rounded-xl border border-white/8 bg-white/2 px-5 py-4">
          <p className="text-xs text-white/45">
            <span className="text-white/70 font-medium">Built with {result.provenance.builder}</span>, detected
            from public page metadata. This is context, not a finding, and it carries no weight in the grade.
          </p>
        </section>
      )}

      {onReset && (
        <div className="flex justify-center pb-4">
          <button
            onClick={onReset}
            className="px-5 py-2.5 rounded-xl text-sm text-white/45 border border-white/8 hover:bg-white/5 transition-colors"
          >
            Scan another site
          </button>
        </div>
      )}
    </div>
  );
}

function FindingCard({ finding, redacted }: { finding: DeepFinding | Pick<DeepFinding, 'id' | 'category' | 'severity' | 'title'>; redacted: boolean }) {
  const { color } = SEVERITY_STYLE[finding.severity];
  const full = finding as DeepFinding;

  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: `${color}26`, background: `${color}08` }}
    >
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-1 self-stretch rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-white/85">{finding.title}</h4>

          {redacted ? (
            <div className="mt-2 space-y-1.5" aria-hidden="true">
              <div className="h-2 rounded bg-white/6" style={{ width: '85%' }} />
              <div className="h-2 rounded bg-white/6" style={{ width: '60%' }} />
            </div>
          ) : (
            <>
              <p className="text-xs text-white/45 mt-1 leading-relaxed">{full.description}</p>
              {full.url && (
                <p className="text-[11px] font-mono text-white/30 mt-2 break-all">{full.url}</p>
              )}
              {full.evidence && (
                <pre className="text-[11px] font-mono text-white/40 mt-2 p-2.5 rounded-lg bg-black/30 overflow-x-auto whitespace-pre-wrap break-all">
                  {full.evidence}
                </pre>
              )}
              {full.remediation && (
                <p className="text-xs text-white/55 mt-2.5 leading-relaxed">
                  <span className="text-white/30">Fix: </span>{full.remediation}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The two lanes, for marketing surfaces that list what runs where. */
export const LANE_SUMMARY = {
  surfaceCount: SURFACE_PHASE_IDS.length,
  deepOnlyCount: DEEP_ONLY_PHASE_IDS.length,
  totalCount: LANE_CHECK_COUNTS.deep,
};
