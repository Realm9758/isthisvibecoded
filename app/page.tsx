'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ScanRunner, type CompletedScan, type ScanErrorMeta } from '@/components/ScanRunner';
import { ScanReport } from '@/components/ScanReport';
import { IroncladMark } from '@/components/Navbar';
import { useAuth } from '@/contexts/AuthContext';
import { DEEP_ONLY_PHASE_IDS, LANE_CHECK_COUNTS } from '@/lib/scan-lanes';
import { FREE_LIFETIME_LIMIT } from '@/lib/scan-quota';
import { holdClaim } from '@/lib/claim-scan';
import { HeroScanDemo } from '@/components/landing/HeroScanDemo';
import { CoverageLanes } from '@/components/landing/CoverageLanes';
import { ScanField } from '@/components/landing/ScanField';
import { CountUp, DrawRule, Reveal } from '@/components/landing/Reveal';
import { prefersReducedMotion, useRevealWith } from '@/components/landing/useReveal';

const SURFACE = LANE_CHECK_COUNTS.surface;
const DEEP_ONLY = DEEP_ONLY_PHASE_IDS.length;
const TOTAL = LANE_CHECK_COUNTS.deep;

const STEPS = [
  {
    n: '01',
    title: 'Scan any URL, free',
    body: `Type a domain. ${SURFACE} read-only assessment modules run immediately, no account: leaked keys in your bundle, a public .env, an exposed source map, headers you never set.`,
  },
  {
    n: '02',
    title: 'Prove you control the domain',
    body: 'Connect Vercel or Netlify, or use a TXT record, meta tag, or file. The live proof is checked again before active requests begin.',
  },
  {
    n: '03',
    title: 'Fix it with the evidence',
    body: 'Every finding ships with what we requested, what came back, and what to change. No finding is reported without the observation behind it.',
  },
];

const FAQ = [
  {
    q: `Why can I only run ${SURFACE} modules on someone else's site?`,
    a: `Because the other ${DEEP_ONLY} may send attack payloads when a suitable input is discovered. Firing those at a server you do not control is unauthorised access in a lot of places, and a checkbox saying you had permission is not a defence. The ${SURFACE} open modules use read-only requests of the kind any browser or search crawler already makes, so they are safe on any target.`,
  },
  {
    q: 'Does paying unlock more modules?',
    a: `No. Permission decides which modules run; payment decides how many scans you get. Verifying a domain unlocks all ${TOTAL} on the free plan too.`,
  },
  {
    q: 'What if my firewall blocks the scanner?',
    a: 'The blocked check is reported as inconclusive with the reason stated, and the rest of the report still renders. A blocked check never becomes a passing one, so blocking us costs you the report rather than hiding a problem.',
  },
  {
    q: 'Is this a penetration test?',
    a: 'No. Ironclad looks from the outside at one moment in time with bounded, automated probes. It cannot read your source, review your access control, or reason about your business logic. A clean result means the applicable modules observed nothing, not that your site is secure.',
  },
];

const BOUNDARIES = [
  ['Not a penetration test', 'Automated, bounded probes from outside, at one moment in time. No source review, no business logic, no chained exploitation.'],
  ['A clean result is not a clearance', 'It means the applicable modules observed nothing. It is evidence of absence only for what was actually tested.'],
  ['Blocked is not passed', 'If your firewall stops a module, the report says so rather than quietly scoring it as fine.'],
];

/** The two panes of the worked evidence example, typed in on reveal. */
const REQUEST_LINES = ['GET /.env HTTP/1.1', 'Host: acme-store.example', 'User-Agent: Ironclad-Surface/2.0'];
const RESPONSE_LINES = ['HTTP/1.1 200 OK', 'Content-Type: text/plain', '', '→ 6 assignments, one a non-placeholder secret'];
const CURL = 'curl -i https://acme-store.example/.env';

function isValidUrl(value: string) {
  try {
    new URL(value.startsWith('http') ? value : `https://${value}`);
    return true;
  } catch {
    return false;
  }
}

/* ── Small presentational pieces ────────────────────── */

/**
 * A code pane that reveals itself a line at a time.
 *
 * Line by line rather than character by character: a per-character typewriter
 * on four lines of HTTP is a novelty the first time and an obstacle every time
 * after, and the reader is here to read the evidence, not watch it arrive.
 */
function TypedLines({ lines, render }: { lines: string[]; render: (line: string, i: number) => React.ReactNode }) {
  // Zero on the server and on the first client render alike; the reveal
  // callback below fills it in, immediately when motion is reduced.
  const [shown, setShown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const ref = useRevealWith(() => {
    if (prefersReducedMotion()) {
      setShown(lines.length);
      return;
    }
    timer.current = setInterval(() => {
      setShown(n => {
        if (n >= lines.length) {
          if (timer.current) clearInterval(timer.current);
          return n;
        }
        return n + 1;
      });
    }, 130);
  });

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  return (
    <pre
      ref={ref}
      data-reveal="fade"
      className="font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-all"
      style={{ color: 'var(--muted)' }}
    >
      {lines.map((line, i) => (
        <span
          key={i}
          className="block transition-opacity duration-300"
          style={{ opacity: i < shown ? 1 : 0, minHeight: '1.6em' }}
        >
          {render(line, i)}
        </span>
      ))}
    </pre>
  );
}

/** One FAQ entry. A real <details>, so it works before hydration and prints open. */
function FaqItem({ q, a, index }: { q: string; a: string; index: number }) {
  return (
    <Reveal delay={index * 70} as="div">
      <details className="group border-b" style={{ borderColor: 'var(--border)' }}>
        <summary className="flex items-start gap-4 py-5 cursor-pointer list-none marker:hidden">
          <span className="label shrink-0 mt-1.5">{String(index + 1).padStart(2, '0')}</span>
          <span className="text-base font-semibold text-white flex-1 transition-colors group-hover:text-white/75">{q}</span>
          <span
            className="shrink-0 mt-1 transition-transform duration-300 group-open:rotate-45"
            style={{ color: 'var(--faint)' }}
            aria-hidden="true"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
        </summary>
        <div className="acc-body">
          <div>
            <p className="text-sm leading-relaxed pb-6 pr-10" style={{ color: 'var(--muted)', paddingLeft: '2.75rem' }}>
              {a}
            </p>
          </div>
        </div>
      </details>
    </Reveal>
  );
}

/** The URL field and its button. Used in the hero and again in the closing CTA. */
function ScanInput({
  id,
  url,
  onUrl,
  onSubmit,
  busy,
  autoFocusRing,
}: {
  id: string;
  url: string;
  onUrl: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  autoFocusRing?: boolean;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div className="flex flex-col sm:flex-row gap-3 max-w-xl">
      <div
        className="flex-1 flex items-center border px-4 transition-all duration-300"
        style={{
          borderColor: focused ? 'var(--accent)' : 'var(--border-2)',
          background: 'var(--surface)',
          borderRadius: 4,
          boxShadow: focused || autoFocusRing ? 'var(--glow-accent)' : 'none',
        }}
      >
        <span className="font-mono text-sm shrink-0 transition-colors duration-300" style={{ color: focused ? 'var(--accent)' : 'var(--ghost)' }}>
          https://
        </span>
        <input
          id={id}
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Domain to scan"
          value={url}
          onChange={e => onUrl(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={e => e.key === 'Enter' && onSubmit()}
          className="flex-1 bg-transparent py-3.5 px-1 font-mono text-sm text-white outline-none focus-visible:outline-none min-w-0"
        />
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy}
        className="sheen px-7 py-3.5 text-sm font-semibold text-white shrink-0 transition-all active:scale-[0.98] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: 'var(--accent)', borderRadius: 4 }}
      >
        <span className="relative z-10">{busy ? 'Scanning…' : `Run ${SURFACE} safe modules`}</span>
      </button>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────── */

export default function Home() {
  const { user, refreshUser } = useAuth();
  const [url, setUrl] = useState('');
  const [target, setTarget] = useState('');
  const [status, setStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<CompletedScan | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorMeta, setErrorMeta] = useState<ScanErrorMeta>({});
  const [copied, setCopied] = useState(false);
  const runRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === 'scanning' || status === 'done') {
      setTimeout(() => runRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    }
  }, [status]);

  function startScan() {
    const value = url.trim();
    if (!value || !isValidUrl(value)) {
      setErrorMsg('Enter a valid URL, for example example.com');
      setErrorMeta({});
      setStatus('error');
      return;
    }
    setErrorMsg('');
    setErrorMeta({});
    setResult(null);
    setTarget(value);
    setStatus('scanning');
  }

  function handleResult(completed: CompletedScan) {
    setResult(completed);
    setStatus('done');
    if (completed.claimToken && completed.scanId) {
      holdClaim({ scanId: completed.scanId, claimToken: completed.claimToken });
    }
    refreshUser();
  }

  function reset() {
    setStatus('idle');
    setResult(null);
    setErrorMsg('');
    setErrorMeta({});
    setUrl('');
    setTarget('');
  }

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(CURL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard permission denied. The command is on screen either way.
    }
  }

  const running = status === 'scanning' || status === 'done';

  return (
    <main style={{ background: 'var(--bg)' }}>
      {/* ── Hero ───────────────────────────────────────── */}
      <section className="relative px-6 pt-24 pb-24 border-b overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        {/*
          The lattice sits behind everything in the hero and fades out before
          it reaches the fold, so the section boundary stays a hard hairline
          rather than a gradient smudge.
        */}
        <ScanField
          className="absolute inset-0 w-full h-full"
          style={{
            maskImage: 'radial-gradient(120% 90% at 50% 20%, #000 30%, transparent 78%)',
            WebkitMaskImage: 'radial-gradient(120% 90% at 50% 20%, #000 30%, transparent 78%)',
          }}
        />

        <div className="relative max-w-6xl mx-auto grid lg:grid-cols-[1fr_1.05fr] gap-14 lg:gap-16 items-start">
          <div className="min-w-0">
            <Reveal from="fade">
              <div
                className="inline-flex items-center gap-2.5 px-3 py-1.5 mb-9 border font-mono text-xs backdrop-blur-sm"
                style={{ borderColor: 'var(--border-2)', borderRadius: 999, color: 'var(--muted)' }}
              >
                <span className="w-1.5 h-1.5 rounded-full animate-pulse-glow" style={{ background: 'var(--accent)' }} />
                verified-domain attack simulation
              </div>
            </Reveal>

            {/*
              Three clipped lines that rise independently. The clip is what
              sells it: the words come up from behind a hard edge instead of
              fading in place.
            */}
            <h1 className="display text-white text-[clamp(3rem,7vw,5.25rem)] mb-7">
              {['Find what a', 'hacker would', 'find, first.'].map((line, i) => (
                <span key={line} className="block overflow-hidden pb-[0.06em]">
                  <Reveal delay={i * 110} as="span" className="block">
                    {i === 2 ? (
                      <span className="relative inline-block">
                        {line}
                        <DrawRule
                          delay={760}
                          className="absolute left-0 -bottom-1 w-full"
                          style={{ background: 'var(--accent)', height: 3 }}
                        />
                      </span>
                    ) : (
                      line
                    )}
                  </Reveal>
                </span>
              ))}
            </h1>

            <Reveal delay={320}>
              <p className="text-lg leading-relaxed mb-10 max-w-xl" style={{ color: 'var(--muted)' }}>
                Ironclad maps the public inputs on a domain you have verified, runs bounded SQL,
                HTML-reflection, SSRF and other probes where a real target exists, then shows the
                request evidence behind each confirmed issue.
              </p>
            </Reveal>

            {user?.plan === 'free' && user.scansRemaining !== null && (
              <p className="font-mono text-xs mb-4" style={{ color: 'var(--faint)' }}>
                <span className="text-white/70">{user.scansRemaining}</span> of {FREE_LIFETIME_LIMIT} free scans left
              </p>
            )}

            <Reveal delay={400} from="fade">
              <ScanInput
                id="scan-url"
                url={url}
                onUrl={setUrl}
                onSubmit={startScan}
                busy={status === 'scanning'}
              />

              {status === 'error' && (
                <p id="scan-error" role="alert" className="mt-4 text-sm animate-fade-in-up" style={{ color: 'var(--crit)' }}>
                  {errorMsg}{' '}
                  {errorMeta.signupRequired && (
                    <Link href="/signup" className="underline underline-offset-4" style={{ color: 'var(--accent)' }}>
                      Create a free account
                    </Link>
                  )}
                  {errorMeta.upgradeRequired && (
                    <Link href="/pricing" className="underline underline-offset-4" style={{ color: 'var(--accent)' }}>
                      See Pro
                    </Link>
                  )}
                </p>
              )}

              <p id="scan-terms" className="mt-5 font-mono text-xs leading-relaxed" style={{ color: 'var(--ghost)' }}>
                no account · usually under 45 seconds · active modules require current domain control
              </p>
            </Reveal>
          </div>

          {/*
            min-w-0 is load-bearing. As a grid item this div defaults to
            min-width:auto, so the demo card's un-wrappable monospace strings
            set the track's minimum and push the whole hero wider than the
            viewport on a phone.
          */}
          <Reveal delay={200} from="fade" className="min-w-0">
            <HeroScanDemo />
          </Reveal>
        </div>
      </section>

      {/* ── Trust strip ────────────────────────────────── */}
      <section className="px-6 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 grid-hairline border-x-0 border-t-0 border-b-0">
          {[
            { value: TOTAL, suffix: 'assessment modules' },
            { value: 0, suffix: 'findings without evidence' },
            { value: SURFACE, suffix: 'run on any URL, free' },
            { value: 45, prefix: 'under', suffix: 'seconds, typically' },
          ].map((stat, i) => (
            <div key={stat.suffix} className="py-7 px-5" style={{ borderRight: i < 3 ? '1px solid var(--border)' : undefined }}>
              <p className="display text-white text-3xl mb-1.5">
                {stat.prefix && <span className="font-mono text-sm font-normal mr-1.5" style={{ color: 'var(--faint)' }}>{stat.prefix}</span>}
                <CountUp to={stat.value} duration={900 + i * 120} />
              </p>
              <p className="font-mono text-xs" style={{ color: 'var(--muted)' }}>{stat.suffix}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Live run ───────────────────────────────────── */}
      {running && (
        <section ref={runRef} className="px-6 py-16 border-b animate-fade-in-up" style={{ borderColor: 'var(--border)' }}>
          <div className="max-w-6xl mx-auto">
            {status === 'scanning' && (
              <ScanRunner
                endpoint="/api/scan"
                label={target}
                body={{ url: target }}
                onResult={handleResult}
                onError={(message, meta) => { setErrorMsg(message); setErrorMeta(meta); setStatus('error'); }}
              />
            )}
            {status === 'done' && result && (
              <>
                {result.notSaved && (
                  <p
                    className="max-w-4xl mx-auto mb-5 px-4 py-3 font-mono text-xs border"
                    style={{ color: 'var(--high)', borderColor: 'rgba(245,158,11,0.25)', borderRadius: 4 }}
                  >
                    {result.notSaved}
                  </p>
                )}
                <ScanReport result={result} onReset={reset} />
              </>
            )}
          </div>
        </section>
      )}

      {/* ── 01 How it works ────────────────────────────── */}
      <section className="px-6 py-24 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto">
          <Reveal><p className="eyebrow mb-6">01 / how it works</p></Reveal>
          <Reveal delay={80}>
            <h2 className="display text-white text-[clamp(2rem,4.5vw,3rem)] mb-14 max-w-2xl">
              Three steps between you<br />and a real attack report.
            </h2>
          </Reveal>

          {/* Hairline threading the three cards, drawn on arrival. */}
          <DrawRule delay={200} className="mb-[-1px]" style={{ background: 'var(--accent-line)' }} />

          <div className="grid md:grid-cols-3 grid-hairline">
            {STEPS.map((step, i) => (
              <Reveal key={step.n} delay={i * 110} as="div" className="relative">
                <div className="trace-border relative p-7 h-full overflow-hidden" style={{ borderRadius: 2 }}>
                  {/* Oversized ghost numeral, sitting fully inside the card so
                      it does not read as a clipped mistake. Pure decoration,
                      so it is hidden from assistive tech and from print. */}
                  <span
                    aria-hidden="true"
                    data-decorative
                    className="display absolute top-3 right-4 text-[4.5rem] leading-none select-none pointer-events-none"
                    style={{ color: 'rgba(255,255,255,0.035)' }}
                  >
                    {step.n}
                  </span>
                  <p className="label mb-5 relative">step {step.n}</p>
                  <h3 className="text-lg font-semibold text-white mb-3 relative">{step.title}</h3>
                  <p className="text-sm leading-relaxed relative" style={{ color: 'var(--muted)' }}>{step.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 02 Coverage ────────────────────────────────── */}
      <section className="px-6 py-24 border-b" style={{ borderColor: 'var(--border)' }}>
        {/* The rails need the width more than the argument does: at 0.85fr the
            longer module names truncate on every other tile. */}
        <div className="max-w-6xl mx-auto grid lg:grid-cols-[0.7fr_1.3fr] gap-12 items-start">
          <div className="lg:sticky lg:top-24">
            <Reveal><p className="eyebrow mb-6">02 / attack coverage</p></Reveal>
            <Reveal delay={80}>
              <h2 className="display text-white text-[clamp(2rem,4.5vw,3rem)] mb-6">
                Not a header<br />checklist.
              </h2>
            </Reveal>
            <Reveal delay={140}>
              <p className="text-base leading-relaxed mb-9" style={{ color: 'var(--muted)' }}>
                Plenty of scanners read your response headers and infer the rest. Ironclad sends the
                payload, watches what comes back, and reports only what it managed to observe.
              </p>
            </Reveal>
            <dl className="font-mono text-sm space-y-2.5">
              {[
                [TOTAL, 'assessment modules'],
                [SURFACE, 'run on any URL, free'],
                [DEEP_ONLY, 'need domain proof'],
                [0, 'findings without evidence'],
              ].map(([value, text], i) => (
                <div key={text as string} className="flex gap-3">
                  <dt style={{ color: 'var(--faint)' }}>
                    <CountUp to={value as number} pad={2} duration={800 + i * 100} />
                  </dt>
                  <dd style={{ color: 'var(--muted)' }}>{text}</dd>
                </div>
              ))}
            </dl>
          </div>

          <CoverageLanes />
        </div>
      </section>

      {/* ── 03 Evidence ────────────────────────────────── */}
      <section className="px-6 py-24 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto">
          <Reveal><p className="eyebrow mb-6">03 / evidence</p></Reveal>
          <Reveal delay={80}>
            <h2 className="display text-white text-[clamp(2rem,4.5vw,3rem)] mb-14 max-w-2xl">
              Every finding comes<br />with the receipt.
            </h2>
          </Reveal>

          <Reveal delay={140} from="fade">
            <div className="border" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
              <div className="flex flex-wrap items-center gap-4 px-6 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
                <span className="chip" style={{ color: 'var(--crit)' }}>critical</span>
                <h3 className="text-base font-semibold text-white">Environment file publicly readable</h3>
                <span className="ml-auto font-mono text-xs" style={{ color: 'var(--ghost)' }}>
                  exposed-files · surface lane
                </span>
              </div>

              <div className="grid md:grid-cols-2">
                <div className="p-6 border-b md:border-b-0 md:border-r" style={{ borderColor: 'var(--border)' }}>
                  <p className="label mb-4">request sent</p>
                  <TypedLines
                    lines={REQUEST_LINES}
                    render={(line, i) =>
                      i === 2 ? (
                        <>
                          {'User-Agent: '}
                          <span style={{ color: 'var(--accent)' }}>Ironclad-Surface/2.0</span>
                        </>
                      ) : (
                        line
                      )
                    }
                  />
                </div>

                <div className="p-6">
                  <p className="label mb-4">response observed</p>
                  <TypedLines
                    lines={RESPONSE_LINES}
                    render={(line, i) =>
                      i === 0 ? (
                        <>
                          {'HTTP/1.1 '}
                          <span style={{ color: 'var(--crit)' }}>200 OK</span>
                        </>
                      ) : i === 3 ? (
                        <span style={{ color: 'var(--ok)' }}>{line}</span>
                      ) : (
                        line
                      )
                    }
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 border-t" style={{ borderColor: 'var(--border)' }}>
                {/* min-w-0 so the curl line scrolls inside its own pane on a
                    phone rather than widening the card. */}
                <div className="p-6 min-w-0 border-b md:border-b-0 md:border-r" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center justify-between mb-4">
                    <p className="label">reproduce</p>
                    <button
                      type="button"
                      onClick={copyCurl}
                      className="font-mono text-[11px] px-2 py-1 border transition-colors hover:text-white"
                      style={{
                        color: copied ? 'var(--ok)' : 'var(--faint)',
                        borderColor: copied ? 'var(--ok)' : 'var(--border-2)',
                        borderRadius: 3,
                      }}
                    >
                      {copied ? 'copied' : 'copy'}
                    </button>
                  </div>
                  <pre
                    className="font-mono text-[13px] p-3.5 overflow-x-auto"
                    style={{ background: 'var(--bg)', color: 'var(--muted)', borderRadius: 4 }}
                  >{CURL}</pre>
                </div>
                <div className="p-6 min-w-0">
                  <p className="label mb-4">fix</p>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                    Block <span className="font-mono text-white/75">.env*</span> at the server or CDN, then rotate
                    every credential the file contained. Treat them as compromised: you cannot know who read it
                    before you did.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={200}>
            <p className="mt-6 font-mono text-xs" style={{ color: 'var(--ghost)' }}>
              Redacted for anonymous scans. Evidence and remediation are withheld until you create an account.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── Boundaries ─────────────────────────────────── */}
      <section className="px-6 py-20 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <p className="font-mono text-sm mb-9" style={{ color: 'var(--muted)' }}>
              What Ironclad does not claim
            </p>
          </Reveal>
          <div className="grid md:grid-cols-3 gap-10 md:gap-8">
            {BOUNDARIES.map(([title, body], i) => (
              <Reveal key={title} delay={i * 110} as="div">
                <div className="relative pl-5">
                  {/* Left rule instead of a box. A disclaimer reads better as
                      marginalia than as a card competing with the pricing. */}
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1 bottom-1 w-px origin-top"
                    style={{ background: 'var(--accent-line)' }}
                  />
                  <h3 className="text-sm font-semibold text-white mb-2.5">{title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 04 Pricing ─────────────────────────────────── */}
      <section className="px-6 py-24 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto">
          <Reveal><p className="eyebrow mb-6">04 / pricing</p></Reveal>
          <Reveal delay={80}>
            <h2 className="display text-white text-[clamp(2rem,4.5vw,3rem)] mb-14">
              Start free. Keep going for £4.99.
            </h2>
          </Reveal>

          <div className="grid md:grid-cols-2 gap-5 max-w-4xl">
            <Reveal delay={140} as="div">
              <div className="border p-8 h-full" style={{ borderColor: 'var(--border)', borderRadius: 6 }}>
                <p className="label mb-6">free</p>
                <p className="display text-white text-5xl mb-3">£0</p>
                <p className="text-sm mb-8" style={{ color: 'var(--muted)' }}>
                  Enough to find out whether you have a real problem.
                </p>
                <ul className="space-y-3 mb-9">
                  {[
                    `${FREE_LIFETIME_LIMIT} scans total`,
                    `All ${TOTAL} assessment modules on a domain you verify`,
                    'Full evidence on every finding',
                    `${SURFACE} surface modules on any URL, no account`,
                  ].map((item, i) => (
                    <Reveal key={item} delay={220 + i * 60} from="x" as="li">
                      <span className="text-sm flex gap-3" style={{ color: 'var(--muted)' }}>
                        <span style={{ color: 'var(--ghost)' }}>·</span>{item}
                      </span>
                    </Reveal>
                  ))}
                </ul>
                <Link href="/signup" className="link-underline font-mono text-sm inline-block" style={{ color: 'var(--accent)' }}>
                  run a free scan →
                </Link>
              </div>
            </Reveal>

            <Reveal delay={200} as="div">
              <div
                className="trace-border border p-8 h-full"
                style={{
                  borderColor: 'var(--accent-line)',
                  background: 'rgba(59,130,246,0.03)',
                  borderRadius: 6,
                  boxShadow: 'var(--glow-accent)',
                }}
              >
                <div className="flex items-center justify-between mb-6">
                  <p className="label" style={{ color: 'var(--accent)' }}>pro</p>
                  <span className="chip" style={{ color: 'var(--accent)' }}>most picked</span>
                </div>
                <p className="display text-white text-5xl mb-3">
                  £4.99<span className="font-mono text-sm font-normal ml-2" style={{ color: 'var(--faint)' }}>/ month</span>
                </p>
                <p className="text-sm mb-8" style={{ color: 'var(--muted)' }}>Scan as often as you ship.</p>
                <ul className="space-y-3 mb-9">
                  {[
                    'Unlimited scans, fair-use burst limits',
                    `All ${TOTAL} assessment modules on every domain you verify`,
                    'Scan history with a fixed-since-last-time diff',
                    'Everything in Free',
                  ].map((item, i) => (
                    <Reveal key={item} delay={280 + i * 60} from="x" as="li">
                      <span className="text-sm flex gap-3" style={{ color: 'var(--muted)' }}>
                        <span style={{ color: 'var(--accent)' }}>·</span>{item}
                      </span>
                    </Reveal>
                  ))}
                </ul>
                <Link
                  href="/pricing"
                  className="sheen block text-center py-3 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98]"
                  style={{ background: 'var(--accent)', borderRadius: 4 }}
                >
                  <span className="relative z-10">Go Pro</span>
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────── */}
      <section className="px-6 py-24 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto">
          <Reveal><p className="eyebrow mb-10">05 / questions</p></Reveal>
          <div className="max-w-3xl border-t" style={{ borderColor: 'var(--border)' }}>
            {FAQ.map((item, i) => (
              <FaqItem key={item.q} q={item.q} a={item.a} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ────────────────────────────────── */}
      <section className="relative px-6 py-28 border-b overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        <ScanField
          className="absolute inset-0 w-full h-full"
          style={{
            maskImage: 'radial-gradient(90% 120% at 50% 50%, #000 10%, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(90% 120% at 50% 50%, #000 10%, transparent 70%)',
          }}
        />
        <div className="relative max-w-6xl mx-auto text-center">
          <Reveal>
            <h2 className="display text-white text-[clamp(2.25rem,5vw,3.5rem)] mb-5 max-w-3xl mx-auto">
              You will find out either way.
            </h2>
          </Reveal>
          <Reveal delay={90}>
            <p className="text-base mb-10 max-w-lg mx-auto" style={{ color: 'var(--muted)' }}>
              Better from a report than from a stranger. {SURFACE} modules, no account, about forty seconds.
            </p>
          </Reveal>
          <Reveal delay={160} from="fade">
            <div className="flex justify-center">
              <div className="w-full max-w-xl text-left">
                <ScanInput
                  id="scan-url-cta"
                  url={url}
                  onUrl={setUrl}
                  onSubmit={startScan}
                  busy={status === 'scanning'}
                />
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="relative px-6 py-12 overflow-hidden print:hidden">
        <span
          aria-hidden="true"
          data-decorative
          className="absolute -right-8 -bottom-10 opacity-[0.03] pointer-events-none"
        >
          <IroncladMark size={190} />
        </span>
        <div className="relative max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-5 justify-between">
          <p className="font-mono text-xs" style={{ color: 'var(--ghost)' }}>
            IRONCLAD · scan only what you own or are permitted to test
          </p>
          <div className="flex items-center gap-6 font-mono text-xs flex-wrap">
            {[
              ['/what-we-check', 'coverage'],
              ['/scanner', 'scanner'],
              ['/pricing', 'pricing'],
              ['/privacy', 'privacy'],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="link-underline hover:text-white transition-colors"
                style={{ color: 'var(--faint)' }}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
