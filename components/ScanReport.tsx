'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { generateRoasts } from '@/lib/roast';
import { LANE_CHECK_COUNTS, DEEP_ONLY_PHASE_IDS } from '@/lib/scan-lanes';
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

const SEVERITY: Record<DeepFindingSeverity, { colour: string; label: string; chip: string }> = {
  critical: { colour: 'var(--crit)', label: 'Critical', chip: 'crit' },
  high:     { colour: 'var(--high)', label: 'High',     chip: 'high' },
  medium:   { colour: 'var(--med)',  label: 'Medium',   chip: 'med' },
  low:      { colour: 'var(--low)',  label: 'Low',      chip: 'low' },
  info:     { colour: 'var(--faint)', label: 'Info',    chip: 'info' },
};

function gradeFor(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 50) return 'C';
  if (score >= 25) return 'D';
  return 'F';
}

function gradeColour(score: number): string {
  if (score >= 90) return 'var(--ok)';
  if (score >= 75) return '#84cc16';
  if (score >= 50) return 'var(--med)';
  if (score >= 25) return 'var(--high)';
  return 'var(--crit)';
}

/**
 * "Ironclad" is reserved for a clean scan with complete coverage. A grade
 * built from checks that could not run is an absence of evidence, not a pass.
 */
function verdict(result: AnyScanResult): { headline: string; tone: string } {
  const { critical, high, medium, low } = result.summary;
  if (result.summary.score === null) return { headline: 'Coverage incomplete', tone: 'var(--faint)' };
  if (critical > 0 || high > 0) return { headline: 'Not ironclad', tone: 'var(--crit)' };
  if (medium > 0 || low > 0) return { headline: 'Nearly ironclad', tone: 'var(--med)' };
  return { headline: 'Ironclad', tone: 'var(--ok)' };
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

export function ScanReport({ result, diff, onReset }: Props) {
  const [roastMode, setRoastMode] = useState(false);
  const redacted = result.redacted === true;
  const lane = result.lane ?? 'deep';
  const { headline, tone } = verdict(result);

  const roasts = useMemo(
    () => (roastMode ? generateRoasts(result as DeepScanResult) : []),
    [roastMode, result],
  );

  const blocked = (result.coverage?.checks ?? []).filter(check => !check.complete);
  const groups = SEVERITY_ORDER
    .map(severity => ({ severity, items: result.findings.filter(f => f.severity === severity) }))
    .filter(group => group.items.length > 0);

  const clean = result.findings.length === 0;

  return (
    <div className="max-w-4xl mx-auto space-y-5">

      {/* Verdict */}
      <section className="border" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 px-6 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="display text-2xl" style={{ color: tone }}>{headline}</h2>
          <span className="font-mono text-sm text-white/60 truncate">{result.domain}</span>
          <span className="ml-auto font-mono text-xs" style={{ color: 'var(--ghost)' }}>
            {lane === 'surface' ? `surface · ${LANE_CHECK_COUNTS.surface} checks` : `deep · ${LANE_CHECK_COUNTS.deep} checks`}
            {' · '}{formatDate(result.scannedAt)}
          </span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-6 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="px-5 py-4" style={{ borderRight: '1px solid var(--border)' }}>
            <p className="label mb-1.5">grade</p>
            {result.summary.score === null ? (
              <p className="font-mono text-lg" style={{ color: 'var(--faint)' }}>n/a</p>
            ) : (
              <p className="font-mono text-lg" style={{ color: gradeColour(result.summary.score) }}>
                {gradeFor(result.summary.score)}
                <span className="text-xs ml-1.5" style={{ color: 'var(--ghost)' }}>{result.summary.score}</span>
              </p>
            )}
          </div>
          {SEVERITY_ORDER.map((severity, i) => (
            <div
              key={severity}
              className="px-5 py-4"
              style={{ borderRight: i < SEVERITY_ORDER.length - 1 ? '1px solid var(--border)' : undefined }}
            >
              <p className="label mb-1.5">{severity}</p>
              <p
                className="font-mono text-lg"
                style={{ color: result.summary[severity] > 0 ? SEVERITY[severity].colour : 'var(--ghost)' }}
              >
                {result.summary[severity]}
              </p>
            </div>
          ))}
        </div>

        {result.summary.score === null && (
          <p className="px-6 py-4 text-sm leading-relaxed border-b" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}>
            {blocked.length} check{blocked.length === 1 ? '' : 's'} could not complete, so no grade is shown.
            A number built from checks that did not run would flatter the site rather than describe it.
          </p>
        )}

        {clean && result.summary.score !== null && lane === 'surface' && (
          <p className="px-6 py-4 text-sm leading-relaxed border-b" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}>
            No issues found in {LANE_CHECK_COUNTS.surface} surface checks.{' '}
            {DEEP_ONLY_PHASE_IDS.length} deeper checks require domain verification.
          </p>
        )}

        <div className="px-6 py-4">
          <button
            onClick={() => setRoastMode(r => !r)}
            className="font-mono text-xs px-3 py-1.5 border transition-colors"
            style={{
              borderRadius: 3,
              borderColor: roastMode ? 'rgba(245,158,11,0.35)' : 'var(--border-2)',
              color: roastMode ? 'var(--high)' : 'var(--faint)',
            }}
          >
            roast mode {roastMode ? 'on' : 'off'}
          </button>
          {roastMode && (
            <ul className="mt-3.5 space-y-2">
              {roasts.map(line => (
                <li key={line} className="text-sm leading-relaxed" style={{ color: 'var(--high)' }}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Rescan diff */}
      {diff?.comparable && (diff.resolved.length > 0 || diff.added.length > 0) && (
        <section
          className="border px-5 py-3.5 flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs"
          style={{ borderColor: 'var(--border)', borderRadius: 4 }}
        >
          <span style={{ color: 'var(--ok)' }}>{diff.resolved.length} resolved</span>
          <span style={{ color: 'var(--high)' }}>{diff.added.length} new</span>
          <span style={{ color: 'var(--faint)' }}>{diff.stillOpen.length} still open</span>
          <span className="ml-auto" style={{ color: 'var(--ghost)' }}>since your last scan</span>
        </section>
      )}

      {/* Coverage banner */}
      {blocked.length > 0 && (
        <section className="border p-5" style={{ borderColor: 'rgba(245,158,11,0.25)', borderRadius: 4 }}>
          <h3 className="text-sm font-semibold mb-1.5" style={{ color: 'var(--high)' }}>
            {blocked.length} check{blocked.length === 1 ? '' : 's'} could not complete
          </h3>
          <p className="text-xs leading-relaxed mb-3.5" style={{ color: 'var(--muted)' }}>
            A gap in what was observed, not a clean result. Sites behind a firewall or bot filter often
            block scanners.
          </p>
          <ul className="space-y-1.5">
            {blocked.map(check => {
              const item = result.checked.find(c => c.id === check.phaseId);
              return (
                <li key={check.phaseId} className="font-mono text-xs flex gap-2.5" style={{ color: 'var(--faint)' }}>
                  <span style={{ color: 'rgba(245,158,11,0.5)' }}>›</span>
                  <span><span className="text-white/60">{item?.label ?? check.phaseId}</span>: {check.reason}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Findings */}
      {groups.length > 0 && (
        <section className="space-y-5">
          {groups.map(({ severity, items }) => (
            <div key={severity}>
              <p className="label mb-2.5" style={{ color: SEVERITY[severity].colour }}>
                {SEVERITY[severity].label} · {items.length}
              </p>
              <div className="space-y-2">
                {items.map(finding => (
                  <FindingCard
                    key={`${finding.id}:${'url' in finding ? finding.url ?? '' : ''}`}
                    finding={finding}
                    redacted={redacted}
                  />
                ))}
              </div>
            </div>
          ))}

          {redacted && (
            <div
              className="border p-7 text-center"
              style={{ borderColor: 'var(--accent-line)', background: 'rgba(59,130,246,0.04)', borderRadius: 6 }}
            >
              <p className="text-base font-semibold text-white mb-2">
                {result.findings.length} finding{result.findings.length === 1 ? '' : 's'}, details withheld
              </p>
              <p className="text-sm mb-6 max-w-md mx-auto leading-relaxed" style={{ color: 'var(--muted)' }}>
                Create a free account to see where each one is, what the evidence was, and how to fix it.
                Three full scans, no card.
              </p>
              <Link
                href="/signup"
                className="inline-block px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent)', borderRadius: 4 }}
              >
                See the full report
              </Link>
            </div>
          )}
        </section>
      )}

      {/* Checked list */}
      <section className="border" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
        <p className="label px-5 py-3.5 border-b" style={{ borderColor: 'var(--border)' }}>every check that ran</p>
        <ul>
          {result.checked.map((item, i) => (
            <li
              key={item.id}
              className="flex items-start gap-3.5 px-5 py-3"
              style={{ borderBottom: i < result.checked.length - 1 ? '1px solid var(--border)' : undefined }}
            >
              <span
                className="font-mono text-[11px] w-3 shrink-0 text-center mt-0.5"
                style={{
                  color:
                    item.status === 'pass' ? 'var(--ok)'
                    : item.status === 'warn' ? 'var(--med)'
                    : item.status === 'fail' ? 'var(--crit)'
                    : 'var(--ghost)',
                }}
              >
                {item.status === 'pass' ? '✓' : item.status === 'warn' ? '!' : item.status === 'fail' ? '✕' : '○'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[13px]" style={{ color: item.status === 'skip' ? 'var(--ghost)' : 'var(--muted)' }}>
                  {item.label}
                </p>
                {'detail' in item && item.detail && (
                  <p className="text-xs leading-relaxed mt-1" style={{ color: 'var(--ghost)' }}>{item.detail}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Deep lane upsell */}
      {lane === 'surface' && (
        <section className="border p-7" style={{ borderColor: 'var(--border)', borderRadius: 6 }}>
          <h3 className="text-base font-semibold text-white mb-2.5">
            {DEEP_ONLY_PHASE_IDS.length} more checks need your permission
          </h3>
          <p className="text-sm leading-relaxed max-w-2xl mb-6" style={{ color: 'var(--muted)' }}>
            SQL injection, cross-site scripting, path traversal, SSRF, access control and brute-force
            resistance all send test payloads at a server. We only do that against a domain you have proved
            you control. It is a legal boundary, not a paywall, so verifying unlocks them on the free plan too.
          </p>
          <Link
            href="/dashboard"
            className="inline-block px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)', borderRadius: 4 }}
          >
            Verify a domain
          </Link>
        </section>
      )}

      {/* Provenance */}
      {result.provenance?.builder && (
        <section className="border px-5 py-4" style={{ borderColor: 'var(--border)', borderRadius: 4 }}>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            <span className="text-white/80 font-medium">Built with {result.provenance.builder}</span>, detected
            from public page metadata. Context, not a finding, and it carries no weight in the grade.
          </p>
        </section>
      )}

      {onReset && (
        <div className="flex justify-center pt-2 pb-4">
          <button
            onClick={onReset}
            className="font-mono text-sm px-5 py-2.5 border transition-colors hover:bg-white/4"
            style={{ borderColor: 'var(--border-2)', color: 'var(--faint)', borderRadius: 4 }}
          >
            scan another site
          </button>
        </div>
      )}
    </div>
  );
}

function FindingCard({
  finding,
  redacted,
}: {
  finding: DeepFinding | Pick<DeepFinding, 'id' | 'category' | 'severity' | 'title'>;
  redacted: boolean;
}) {
  const { colour, chip } = SEVERITY[finding.severity];
  const full = finding as DeepFinding;

  return (
    <article className="border" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 5 }}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5" style={{ borderBottom: redacted ? undefined : '1px solid var(--border)' }}>
        <span className="chip shrink-0" style={{ color: colour }}>{chip}</span>
        <h4 className="text-sm font-semibold text-white/90">{finding.title}</h4>
        <span className="ml-auto font-mono text-[11px] shrink-0" style={{ color: 'var(--ghost)' }}>
          {finding.category}
        </span>
      </div>

      {redacted ? (
        <div className="px-5 pb-4 space-y-1.5" aria-hidden="true">
          <div className="h-2" style={{ background: 'rgba(255,255,255,0.05)', width: '82%', borderRadius: 2 }} />
          <div className="h-2" style={{ background: 'rgba(255,255,255,0.05)', width: '54%', borderRadius: 2 }} />
        </div>
      ) : (
        <div className="px-5 py-4 space-y-3.5">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{full.description}</p>

          {full.url && (
            <p className="font-mono text-xs break-all" style={{ color: 'var(--faint)' }}>{full.url}</p>
          )}

          {full.evidence && (
            <div>
              <p className="label mb-2">observed</p>
              <pre
                className="font-mono text-xs p-3.5 overflow-x-auto whitespace-pre-wrap break-all"
                style={{ background: 'var(--bg)', color: 'var(--muted)', borderRadius: 4 }}
              >{full.evidence}</pre>
            </div>
          )}

          {full.remediation && (
            <div>
              <p className="label mb-2">fix</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{full.remediation}</p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
