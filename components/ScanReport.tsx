'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { generateRoasts } from '@/lib/roast';
import { LANE_CHECK_COUNTS, DEEP_ONLY_PHASE_IDS } from '@/lib/scan-lanes';
import type { ScanDiff } from '@/lib/scan-diff';
import { moduleExecutionSummary, summarizeScanReceipt } from '@/lib/scan-receipt';
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
  afterSummary?: ReactNode;
}

const SEVERITY_ORDER: DeepFindingSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY: Record<DeepFindingSeverity, { colour: string; label: string; chip: string }> = {
  critical: { colour: 'var(--crit)', label: 'Critical', chip: 'critical' },
  high:     { colour: 'var(--high)', label: 'High',     chip: 'high' },
  medium:   { colour: 'var(--med)',  label: 'Medium',   chip: 'medium' },
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
  if (result.scope?.fullInventory === false) return { headline: 'Scoped result', tone: 'var(--accent)' };
  if (result.summary.score === null) return { headline: 'Partial result', tone: 'var(--med)' };
  if (critical > 0 || high > 0) return { headline: 'Not ironclad', tone: 'var(--crit)' };
  if (medium > 0 || low > 0) return { headline: 'Nearly ironclad', tone: 'var(--med)' };
  if (
    (result.lane ?? 'deep') === 'deep'
    && (result.coverage?.complete === false || result.coverage?.checks?.some(check => check.applicable === false))
  ) {
    return { headline: 'No confirmed issues in the tested surface', tone: 'var(--ok)' };
  }
  return { headline: 'Ironclad', tone: 'var(--ok)' };
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

type CoverageLimit = {
  title: string;
  explanation: string;
  checks: string[];
};

function coverageLimits(result: AnyScanResult): CoverageLimit[] {
  const grouped = new Map<string, CoverageLimit>();
  for (const check of result.coverage?.checks ?? []) {
    if (check.complete || check.applicable === false) continue;
    const item = result.checked.find(candidate => candidate.id === check.phaseId);
    const reason = check.reason ?? '';
    const key = check.requestsBlocked > 0
      ? 'rejected'
      : /login POST form|forms? that may change state|failed-login|upload and state-changing/i.test(reason)
        ? 'interactive'
      : /control request|control response/i.test(reason)
        ? 'comparison'
        : /timed out|failed|read within|malformed|unexpected/i.test(reason)
          ? 'response'
          : 'other';
    const definition: Omit<CoverageLimit, 'checks'> = key === 'rejected'
      ? {
          title: 'The site did not accept some automated requests',
          explanation: 'Those modules received a denial, rate limit, or bot challenge. Nothing here says the site is vulnerable; it means Ironclad could not inspect that response reliably. If you control the firewall, allow the Ironclad-Deep/2.0 user agent for the verified host and rerun the scan.',
        }
      : key === 'interactive'
        ? {
            title: 'Interactive forms were mapped but not submitted',
            explanation: 'Ironclad found a login, upload, or other POST flow. It did not guess credentials or submit a form that could create data, send messages, or lock an account. Those flows need an authenticated test setup with safe test credentials.',
          }
      : key === 'comparison'
        ? {
            title: 'A safe before-and-after comparison was unavailable',
            explanation: 'These modules only make a claim when a normal value works and a crafted value produces a meaningful difference. The normal comparison failed, so Ironclad correctly made no vulnerability claim.',
          }
        : key === 'response'
          ? {
              title: 'Some responses could not be read reliably',
              explanation: 'A request timed out, exceeded a safety limit, or returned data that did not match the advertised format. The affected modules were left unanswered.',
            }
          : {
              title: 'Some modules need more evidence',
              explanation: 'The automated scan did not collect enough evidence to reach a reliable conclusion for these modules.',
            };
    const group = grouped.get(key) ?? { ...definition, checks: [] };
    group.checks.push(item?.label ?? check.phaseId);
    grouped.set(key, group);
  }
  return [...grouped.values()];
}

export function ScanReport({ result, diff, onReset, afterSummary }: Props) {
  const [roastMode, setRoastMode] = useState(false);
  const redacted = result.redacted === true;
  const lane = result.lane ?? 'deep';
  const scoped = result.scope?.fullInventory === false;
  const { headline, tone } = verdict(result);

  const roasts = useMemo(
    () => (roastMode ? generateRoasts(result as DeepScanResult) : []),
    [roastMode, result],
  );

  const coverageChecks = result.coverage?.checks ?? [];
  const receipt = summarizeScanReceipt(coverageChecks);
  const coverageByPhase = new Map(coverageChecks.map(check => [check.phaseId, check]));
  const blocked = coverageChecks.filter(check => !check.complete);
  const notApplicableCount = coverageChecks.filter(check => check.applicable === false).length;
  const limits = coverageLimits(result);
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
            {lane} · {result.checked.length} module{result.checked.length === 1 ? '' : 's'}
            {' · '}{result.coverage?.requestsAttempted ?? 0} HTTP attempts
            {' · '}{(result.duration / 1_000).toFixed(1)}s
            {' · '}{formatDate(result.scannedAt)}
          </span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-6 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="px-5 py-4" style={{ borderRight: '1px solid var(--border)' }}>
            <p className="label mb-1.5">{scoped ? 'overall grade' : lane === 'deep' && (notApplicableCount > 0 || result.coverage?.complete === false) ? 'tested grade' : 'grade'}</p>
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

        {scoped && (
          <p className="px-6 py-4 text-sm leading-relaxed border-b" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}>
            This run intentionally selected {result.checked.length} of {LANE_CHECK_COUNTS.deep} modules. Confirmed findings and coverage remain useful, but Ironclad does not calculate an overall grade from a narrower scope because omitted modules cannot be assumed to pass.
          </p>
        )}

        {result.summary.score === null && !scoped && (
          <p className="px-6 py-4 text-sm leading-relaxed border-b" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}>
            Ironclad kept the confirmed findings below, but {blocked.length} module{blocked.length === 1 ? '' : 's'} did not have enough evidence for a reliable answer.
            No grade is shown because filling those gaps with assumed passes would be misleading.
          </p>
        )}

        {clean && result.summary.score !== null && lane === 'surface' && (
          <p className="px-6 py-4 text-sm leading-relaxed border-b" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}>
            No issues found in {LANE_CHECK_COUNTS.surface} surface assessment modules.{' '}
            {DEEP_ONLY_PHASE_IDS.length} active modules require domain verification.
          </p>
        )}

      </section>

      {afterSummary}

      {coverageChecks.length > 0 && (
        <section className="border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
          <h3 className="text-sm font-semibold text-white mb-2">Execution receipt</h3>
          <p className="text-sm leading-relaxed max-w-3xl" style={{ color: 'var(--muted)' }}>
            The {receipt.modules} modules are an accounting list, not {receipt.modules} separate penetration tests. Some inspect HTML, headers, cookies, or scripts already downloaded; independent URL probes can run concurrently. These numbers are recorded by the server, not animated by the progress bar.
          </p>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-px mt-4 border" style={{ borderColor: 'var(--border)', background: 'var(--border)' }}>
            {[
              ['modules accounted for', receipt.modules],
              ['modules that sent HTTP', receipt.networkModules],
              ['local analysis modules', receipt.localModules],
              ['modules not applicable', receipt.notApplicableModules],
              ['total HTTP attempts', result.coverage?.requestsAttempted ?? 0],
              ['wall time', `${(result.duration / 1_000).toFixed(1)} s`],
            ].map(([label, value]) => (
              <div key={label} className="p-3.5 flex flex-col" style={{ background: 'var(--surface)' }}>
                <dt className="text-[11px] mt-1 order-2" style={{ color: 'var(--ghost)' }}>{label}</dt>
                <dd className="font-mono text-base text-white/80 order-1">{value}</dd>
              </div>
            ))}
          </dl>
          {receipt.incompleteModules > 0 && (
            <p className="text-xs leading-relaxed mt-3" style={{ color: 'var(--med)' }}>
              {receipt.incompleteModules} module{receipt.incompleteModules === 1 ? '' : 's'} returned an inconclusive result. They remain visible below and are not counted as clean passes.
            </p>
          )}
        </section>
      )}

      {lane === 'deep' && result.application && (
        <section className="border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
          <h3 className="text-sm font-semibold text-white mb-2">What this scan actually tested</h3>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
            Ironclad started at <span className="font-mono text-white/70 break-all">{result.application.pageUrl}</span>, then inspected browser-delivered HTML and scripts.
            It discovered {result.application.formsDiscovered} form{result.application.formsDiscovered === 1 ? '' : 's'}, {result.application.publicGetParametersDiscovered} public GET parameter{result.application.publicGetParametersDiscovered === 1 ? '' : 's'}, and {result.application.applicationRoutesDiscovered} application route{result.application.applicationRoutesDiscovered === 1 ? '' : 's'}.
          </p>
          {result.application.testedParameterNames.length > 0 ? (
            <p className="text-xs leading-relaxed mt-3" style={{ color: 'var(--faint)' }}>
              Active input probes used discovered parameter names: <span className="font-mono text-white/60">{result.application.testedParameterNames.join(', ')}</span>.
            </p>
          ) : (
            <p className="text-xs leading-relaxed mt-3" style={{ color: 'var(--faint)' }}>
              No suitable public GET input was discovered, so input-specific modules were marked not tested instead of firing guessed payloads at the landing page.
            </p>
          )}
          {result.application.loginFormsDiscovered > 0 && (
            <p className="text-xs leading-relaxed mt-3 border-l-2 pl-3" style={{ color: 'var(--muted)', borderColor: 'var(--med)' }}>
              {result.application.loginFormsDiscovered} login form{result.application.loginFormsDiscovered === 1 ? ' was' : 's were'} identified, but not submitted. Ironclad does not guess credentials or create failed-login attempts that could lock accounts. SQL and NoSQL conclusions therefore do not cover that login POST flow without a separate authenticated test setup.
            </p>
          )}
        </section>
      )}

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

      {lane === 'surface' && (
        <section className="border p-7" style={{ borderColor: 'var(--accent-line)', borderRadius: 6 }}>
          <h3 className="text-base font-semibold text-white mb-2.5">
            Verify {result.domain} for {DEEP_ONLY_PHASE_IDS.length} active modules
          </h3>
          <p className="text-sm leading-relaxed max-w-2xl mb-6" style={{ color: 'var(--muted)' }}>
            Injection, access-control and provider-rule modules send bounded test inputs. They run only after a current domain-control proof and explicit authorisation.
          </p>
          <Link
            href={`/dashboard?domain=${encodeURIComponent(result.domain)}&intent=verify`}
            className="inline-block px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)', borderRadius: 4 }}
          >
            Verify this domain
          </Link>
        </section>
      )}

      {/* Coverage banner */}
      {limits.length > 0 && (
        <section className="border p-5" style={{ borderColor: 'rgba(245,158,11,0.25)', borderRadius: 4 }}>
          <h3 className="text-sm font-semibold mb-1.5" style={{ color: 'var(--high)' }}>
            What limited this scan
          </h3>
          <p className="text-xs leading-relaxed mb-3.5" style={{ color: 'var(--muted)' }}>
            These are limits in the assessment, not security findings. Ironclad grouped them so you can see the cause without reading the same technical message repeatedly.
          </p>
          <div className="space-y-3">
            {limits.map(limit => (
              <div key={limit.title} className="border-l-2 pl-3" style={{ borderColor: 'rgba(245,158,11,0.35)' }}>
                <p className="text-sm text-white/75">{limit.title} <span className="font-mono text-xs" style={{ color: 'var(--faint)' }}>({limit.checks.length})</span></p>
                <p className="text-xs leading-relaxed mt-1" style={{ color: 'var(--faint)' }}>{limit.explanation}</p>
                <details className="mt-1.5">
                  <summary className="font-mono text-[11px] cursor-pointer" style={{ color: 'var(--ghost)' }}>show affected modules</summary>
                  <p className="font-mono text-[11px] leading-relaxed mt-1" style={{ color: 'var(--ghost)' }}>{limit.checks.join(' · ')}</p>
                </details>
              </div>
            ))}
          </div>
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
      <details className="border" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
        <summary className="label px-5 py-3.5 cursor-pointer" style={{ borderColor: 'var(--border)' }}>
          {result.checked.length} assessment modules and execution details
        </summary>
        <ul>
          {result.checked.map((item, i) => {
            const execution = coverageByPhase.get(item.id);
            return (
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
                    : item.status === 'observe' ? 'var(--accent)'
                    : 'var(--ghost)',
                }}
              >
                {item.status === 'pass' ? '✓' : item.status === 'warn' ? '!' : item.status === 'fail' ? '✕' : item.status === 'observe' ? 'i' : '○'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[13px]" style={{ color: item.status === 'skip' ? 'var(--ghost)' : 'var(--muted)' }}>
                  {item.label}
                </p>
                {execution && (
                  <p className="font-mono text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
                    {moduleExecutionSummary(execution)}
                  </p>
                )}
                {'detail' in item && item.detail && (
                  <p className="text-xs leading-relaxed mt-1" style={{ color: 'var(--ghost)' }}>{item.detail}</p>
                )}
              </div>
            </li>
            );
          })}
        </ul>
      </details>

      {/* Provenance */}
      {result.provenance?.builder && (
        <section className="border px-5 py-4" style={{ borderColor: 'var(--border)', borderRadius: 4 }}>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            <span className="text-white/80 font-medium">Built with {result.provenance.builder}</span>, detected
            from public page metadata. Context, not a finding, and it carries no weight in the grade.
          </p>
        </section>
      )}

      <details className="border px-5 py-4" style={{ borderColor: 'var(--border)', borderRadius: 4 }}>
        <summary className="font-mono text-xs cursor-pointer" style={{ color: 'var(--faint)' }}>Optional: roast mode</summary>
        <button
          onClick={() => setRoastMode(r => !r)}
          className="font-mono text-xs px-3 py-1.5 border mt-3"
          style={{ borderColor: 'var(--border-2)', color: 'var(--faint)', borderRadius: 3 }}
        >
          {roastMode ? 'Hide roast' : 'Generate roast'}
        </button>
        {roastMode && (
          <ul className="mt-3 space-y-2">
            {roasts.map(line => <li key={line} className="text-sm" style={{ color: 'var(--high)' }}>{line}</li>)}
          </ul>
        )}
      </details>

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
            <details>
              <summary className="label mb-2 cursor-pointer">observed evidence</summary>
              <pre
                className="font-mono text-xs p-3.5 overflow-x-auto whitespace-pre-wrap break-all"
                style={{ background: 'var(--bg)', color: 'var(--muted)', borderRadius: 4 }}
              >{full.evidence}</pre>
            </details>
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
