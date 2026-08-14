'use client';

/**
 * The looping demo scan in the hero.
 *
 * The most persuasive thing Ironclad does is watch a site and drop findings
 * out one at a time, and until now you had to run a real scan to see it. This
 * card performs that in about fourteen seconds and then starts over.
 *
 * Everything it shows is real product data: phase labels come from
 * lib/scan-phases, the module count from lib/scan-lanes. The findings are the
 * worked example the page has always used, and the card is labelled "example"
 * for the same reason it always was.
 *
 * Implementation notes:
 *
 *  - One rAF loop drives the whole thing off a single elapsed-time value.
 *    Chained setTimeouts would drift, would keep firing in a background tab,
 *    and would need seven separate cancellations on unmount.
 *  - State is written once per animation step, not once per frame. The
 *    typewriter is the only per-frame consumer, and it is throttled to the
 *    character rate rather than the frame rate.
 *  - Offscreen and hidden-tab both pause. Reduced motion renders the finished
 *    state and never starts a loop.
 *  - aria-hidden, with a static summary for screen readers beside it. A
 *    fourteen-second loop that rewrites itself is not something to expose to
 *    assistive tech.
 */

import { useEffect, useRef, useState } from 'react';
import { SCAN_PHASES } from '@/lib/scan-phases';
import { LANE_CHECK_COUNTS } from '@/lib/scan-lanes';
import { prefersReducedMotion, useReducedMotion } from './useReveal';

const TOTAL_MODULES = LANE_CHECK_COUNTS.deep;
const DOMAIN = 'acme-store.example';

/** Eight real phase labels, enough to read as a run without filling the card. */
const RAIL_PHASE_IDS = ['vibe', 'files', 'headers', 'sourcemaps', 'ssl', 'sqli', 'admin', 'ssrf'];
const RAIL = RAIL_PHASE_IDS.map(id => SCAN_PHASES.find(p => p.id === id)).filter(
  (p): p is (typeof SCAN_PHASES)[number] => Boolean(p),
);

type Finding = { sev: string; color: string; title: string; meta: string };

const FINDINGS: Finding[] = [
  { sev: 'CRIT', color: 'var(--crit)', title: 'Supabase service role key in client HTML', meta: 'GET /  ·  bypasses row level security' },
  { sev: 'CRIT', color: 'var(--crit)', title: 'Environment file publicly readable',       meta: 'GET /.env  ·  200  ·  non-placeholder secret' },
  { sev: 'HIGH', color: 'var(--high)', title: 'Source maps expose unminified source',     meta: 'GET /_next/static/main.js.map  ·  200' },
  { sev: 'HIGH', color: 'var(--high)', title: 'Site reachable over plain HTTP',           meta: 'GET http://  ·  200  ·  no redirect to HTTPS' },
];

/* ── Timeline ────────────────────────────────────────
 * All times in milliseconds from the top of a cycle. Editing the run is
 * editing these numbers; nothing else encodes ordering.
 */
const T_TYPE_START   = 400;
const T_TYPE_MS      = 55;                                      // per character
const T_TYPE_END     = T_TYPE_START + DOMAIN.length * T_TYPE_MS;
const T_RUN_START    = T_TYPE_END + 420;
const T_RUN_MS       = 6600;                                    // rail + progress
const T_RUN_END      = T_RUN_START + T_RUN_MS;
/** When each finding lands, spread across the run rather than bunched at the end. */
const T_FINDINGS     = [1500, 2900, 4300, 5700].map(offset => T_RUN_START + offset);
const T_MORE         = T_RUN_END + 300;
const T_HOLD_END     = T_MORE + 3400;
const T_FADE_MS      = 420;
const T_CYCLE        = T_HOLD_END + T_FADE_MS;

type Stage = 'typing' | 'running' | 'settled';

const DONE_STATE = {
  typed: DOMAIN,
  stage: 'settled' as Stage,
  progress: 1,
  railDone: RAIL.length,
  landed: FINDINGS.length,
  showMore: true,
  fading: false,
};

const START_STATE = {
  typed: '',
  stage: 'typing' as Stage,
  progress: 0,
  railDone: 0,
  landed: 0,
  showMore: false,
  fading: false,
};

export function HeroScanDemo() {
  const [animated, setAnimated] = useState(START_STATE);
  const reduced = useReducedMotion();

  /*
   * With motion reduced the card simply renders its finished state. Deriving
   * it during render rather than writing it from an effect means no cascading
   * render, and no state that has to be kept in step with the preference.
   */
  const s = reduced ? DONE_STATE : animated;

  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    const host = hostRef.current;
    if (!host) return;

    let raf = 0;
    let running = false;
    let visible = false;
    /** Wall-clock origin while running; accumulated elapsed time while paused. */
    let clock = 0;

    // Last values written to React, so a frame that changes nothing costs
    // nothing. Without this the card would re-render sixty times a second.
    let lastTyped = -1;
    let lastRail = -1;
    let lastLanded = -1;
    let lastStage: Stage | '' = '';
    let lastMore = false;
    let lastFading = false;
    let lastProgressStep = -1;

    function tick(elapsed: number) {
      const t = elapsed % T_CYCLE;

      const typedCount =
        t < T_TYPE_START ? 0
        : t >= T_TYPE_END ? DOMAIN.length
        : Math.floor((t - T_TYPE_START) / T_TYPE_MS);

      const stage: Stage = t < T_RUN_START ? 'typing' : t < T_RUN_END ? 'running' : 'settled';

      const progress =
        t <= T_RUN_START ? 0
        : t >= T_RUN_END ? 1
        : (t - T_RUN_START) / T_RUN_MS;

      const railDone =
        t <= T_RUN_START ? 0
        : t >= T_RUN_END ? RAIL.length
        : Math.min(RAIL.length, Math.floor(((t - T_RUN_START) / T_RUN_MS) * RAIL.length) + 1);

      let landed = 0;
      for (const at of T_FINDINGS) if (t >= at) landed++;

      const showMore = t >= T_MORE;
      const fading = t >= T_HOLD_END;

      // Progress is quantised to whole percent so the bar still moves smoothly
      // (it is a CSS transform) without a state write on every single frame.
      const progressStep = Math.round(progress * 100);

      if (
        typedCount === lastTyped &&
        railDone === lastRail &&
        landed === lastLanded &&
        stage === lastStage &&
        showMore === lastMore &&
        fading === lastFading &&
        progressStep === lastProgressStep
      ) {
        return;
      }

      lastTyped = typedCount;
      lastRail = railDone;
      lastLanded = landed;
      lastStage = stage;
      lastMore = showMore;
      lastFading = fading;
      lastProgressStep = progressStep;

      setAnimated({
        typed: DOMAIN.slice(0, typedCount),
        stage,
        progress: progressStep / 100,
        railDone,
        landed,
        showMore,
        fading,
      });
    }

    function frame(now: number) {
      if (!running) return;
      tick(now - clock);
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running || !visible || document.hidden) return;
      running = true;
      clock = performance.now() - clock;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      clock = performance.now() - clock;
    }

    const io = new IntersectionObserver(
      entries => {
        visible = entries[0]?.isIntersecting ?? false;
        if (visible) start();
        else stop();
      },
      { threshold: 0 },
    );
    io.observe(host);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const counts = [
    { k: 'critical', v: Math.min(2, s.landed) },
    { k: 'high',     v: Math.max(0, s.landed - 2) },
    // Medium findings are not shown as rows, so this tracks the run rather
    // than the list. It stays behind the first critical, because a report
    // showing mediums before it has found anything worse reads as wrong.
    { k: 'medium',   v: s.landed === 0 ? 0 : Math.max(1, Math.round(s.progress * 5)) },
    { k: 'modules',  v: Math.round(s.progress * TOTAL_MODULES) },
  ];

  const activePhase =
    s.stage === 'settled'
      ? SCAN_PHASES[SCAN_PHASES.length - 1]
      : RAIL[Math.max(0, Math.min(RAIL.length - 1, s.railDone - 1))];

  return (
    <div ref={hostRef} className="min-w-0">
      {/* The loop is decorative. This is what a screen reader gets instead. */}
      <p className="sr-only">
        Example report for {DOMAIN}: 2 critical, 2 high and 5 medium findings across{' '}
        {TOTAL_MODULES} assessment modules.
      </p>

      <div
        aria-hidden="true"
        className="relative overflow-hidden border min-w-0 transition-opacity"
        style={{
          borderColor: s.stage === 'settled' ? 'var(--accent-line)' : 'var(--border)',
          background: 'var(--surface)',
          borderRadius: 6,
          boxShadow: s.stage === 'settled' && s.showMore ? 'var(--glow-accent)' : 'none',
          opacity: s.fading ? 0 : 1,
          transitionDuration: s.fading ? `${T_FADE_MS}ms` : '600ms',
        }}
      >
        {/* Scan band crossing the card while modules run. */}
        {s.stage === 'running' && (
          <div
            className="absolute inset-x-0 top-0 h-16 pointer-events-none z-10 animate-sweep-y"
            style={{
              background: 'linear-gradient(180deg, transparent, rgba(59,130,246,0.10) 60%, rgba(59,130,246,0.30))',
            }}
          />
        )}

        {/* ── Header: the target, typing itself in ── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <span
            className={`w-2 h-2 rounded-full shrink-0 transition-colors duration-300 ${s.stage === 'running' ? 'animate-pulse-glow' : ''}`}
            style={{ background: s.stage === 'running' ? 'var(--high)' : s.stage === 'settled' ? 'var(--ok)' : 'var(--ghost)' }}
          />
          <span className="font-mono text-sm text-white truncate">
            {s.typed}
            {s.stage === 'typing' && (
              <span className="animate-caret inline-block w-[7px] -mb-[2px] h-[1.05em] align-middle ml-px" style={{ background: 'var(--accent)' }} />
            )}
          </span>
          <span
            className="font-mono text-xs shrink-0 transition-all duration-300"
            style={{
              color: 'var(--faint)',
              opacity: s.stage === 'typing' ? 0 : 1,
              transform: s.stage === 'typing' ? 'scale(0.9)' : 'none',
            }}
          >
            verified
          </span>
          <span className="ml-auto label shrink-0">example</span>
        </div>

        {/* ── Progress: the accent bar becomes determinate ── */}
        <div style={{ height: 2, background: 'var(--border)' }}>
          <div
            style={{
              height: 2,
              background: 'var(--accent)',
              transform: `scaleX(${s.progress})`,
              transformOrigin: 'left center',
              transition: 'transform 140ms linear',
            }}
          />
        </div>

        {/* ── Counters ── */}
        <div className="grid grid-cols-4 border-b" style={{ borderColor: 'var(--border)' }}>
          {counts.map((cell, i) => (
            <div key={cell.k} className="px-4 py-4" style={{ borderRight: i < 3 ? '1px solid var(--border)' : undefined }}>
              <p className="label mb-1.5">{cell.k}</p>
              <p
                className="font-mono text-lg transition-colors duration-300"
                style={{
                  color: cell.v > 0 ? '#fff' : 'var(--ghost)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {cell.v}
              </p>
            </div>
          ))}
        </div>

        {/*
          Phase rail: what is running right now. Always present at a fixed
          height, like every other row in this card. Nothing here may resize
          the card mid-loop, because the hero would then breathe up and down
          on a fourteen-second cycle while the reader is trying to type.
        */}
        <div className="px-5 h-[34px] flex items-center gap-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
          <span
            className="font-mono text-[11px] shrink-0 transition-colors duration-300"
            style={{ color: s.stage === 'typing' ? 'var(--ghost)' : 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}
          >
            {String(Math.round(s.progress * TOTAL_MODULES)).padStart(2, '0')}/{TOTAL_MODULES}
          </span>
          <span
            className="font-mono text-[11px] truncate transition-opacity duration-200"
            style={{ color: 'var(--muted)', opacity: s.stage === 'typing' ? 0 : 1 }}
          >
            {activePhase?.label ?? ''}
          </span>
          <span className="ml-auto flex gap-1 shrink-0">
            {RAIL.map((phase, i) => (
              <span
                key={phase.id}
                className="w-1 h-1 rounded-full transition-colors duration-200"
                style={{ background: i < s.railDone ? 'var(--accent)' : 'var(--ghost)' }}
              />
            ))}
          </span>
        </div>

        {/* ── Findings, landing one at a time into slots that already exist ── */}
        <ul>
          {FINDINGS.map((f, i) => {
            const shown = i < s.landed;
            return (
              <li
                key={f.title}
                className="relative flex items-center px-5 h-[70px]"
                style={{ borderBottom: i < FINDINGS.length - 1 ? '1px solid var(--border)' : undefined }}
              >
                {/* One-shot severity wash behind the row that just arrived. */}
                {shown && (
                  <span
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: `linear-gradient(90deg, ${f.color}, transparent 70%)`,
                      animation: 'sev-flash 900ms ease-out both',
                    }}
                  />
                )}

                {/*
                  Empty slot. Without this the card spends most of its loop as
                  four blank bordered rows, which reads as a broken table
                  rather than as a scan still working.
                */}
                <div
                  aria-hidden="true"
                  className="absolute inset-x-5 flex items-center gap-3.5 transition-opacity duration-300"
                  style={{ opacity: shown ? 0 : 1 }}
                >
                  <span className="w-[38px] h-[18px] shrink-0" style={{ background: 'rgba(255,255,255,0.045)', borderRadius: 3 }} />
                  <span className="flex-1 min-w-0">
                    <span className="block h-[9px] mb-2" style={{ background: 'rgba(255,255,255,0.045)', borderRadius: 2, width: `${58 + i * 9}%` }} />
                    <span className="block h-[7px]" style={{ background: 'rgba(255,255,255,0.028)', borderRadius: 2, width: `${34 + i * 6}%` }} />
                  </span>
                </div>

                <div
                  className="flex items-start gap-3.5 w-full min-w-0 relative"
                  style={{
                    opacity: shown ? 1 : 0,
                    animation: shown ? 'finding-land 420ms var(--ease-spring) both' : undefined,
                  }}
                >
                  <span className="chip shrink-0 mt-0.5" style={{ color: f.color }}>{f.sev}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white/90 leading-snug truncate">{f.title}</p>
                    <p className="font-mono text-xs mt-1.5 truncate" style={{ color: 'var(--faint)' }}>{f.meta}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <p
          className="px-5 font-mono text-xs border-t h-[49px] leading-[49px] transition-opacity duration-500"
          style={{
            color: 'var(--ghost)',
            borderColor: 'var(--border)',
            opacity: s.showMore ? 1 : 0,
          }}
        >
          + 7 more findings
        </p>
      </div>
    </div>
  );
}
