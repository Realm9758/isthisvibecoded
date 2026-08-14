'use client';

/**
 * The coverage section: 32 assessment modules, split by the rule that decides
 * which of them may run against a domain you have not proved you control.
 *
 * This replaces a grid of 32 tiny monospace names, which was the weakest block
 * on the page: dense, uniform, and impossible to read as anything but a wall.
 * Two labelled rails make the surface/deep split visible at a glance, and each
 * tile can be inspected for the phase's real description.
 *
 * The descriptions were already written, in lib/scan-phases.ts, and were until
 * now only ever shown mid-scan. So the section gains 32 lines of accurate copy
 * without inventing a word.
 *
 * Interaction is hover *and* focus, and the tiles are real buttons, so the
 * detail panel is reachable by keyboard. A hover-only reveal here would put a
 * third of the page's copy out of reach.
 */

import { useState } from 'react';
import { SCAN_PHASES, type ScanPhase } from '@/lib/scan-phases';
import { DEEP_ONLY_PHASE_IDS, SURFACE_PHASE_IDS } from '@/lib/scan-lanes';
import { useReveal } from './useReveal';

function phasesFor(ids: readonly string[]): ScanPhase[] {
  return ids
    .map(id => SCAN_PHASES.find(phase => phase.id === id))
    .filter((phase): phase is ScanPhase => Boolean(phase));
}

const LANES = [
  {
    key: 'surface' as const,
    title: 'Surface lane',
    note: 'read-only requests · any URL · no account',
    dot: 'var(--ghost)',
    phases: phasesFor(SURFACE_PHASE_IDS),
  },
  {
    key: 'deep' as const,
    title: 'Deep lane',
    note: 'sends a payload or probes an entry point · verified domains only',
    dot: 'var(--accent)',
    phases: phasesFor(DEEP_ONLY_PHASE_IDS),
  },
];

/** Milliseconds between adjacent tiles arriving. Small enough to read as one motion. */
const STAGGER = 18;

function Tile({
  phase,
  lane,
  delay,
  active,
  dimmed,
  onInspect,
}: {
  phase: ScanPhase;
  lane: 'surface' | 'deep';
  delay: number;
  active: boolean;
  dimmed: boolean;
  onInspect: (phase: ScanPhase | null) => void;
}) {
  const ref = useReveal(delay);

  return (
    <button
      ref={ref}
      type="button"
      data-reveal="x"
      onMouseEnter={() => onInspect(phase)}
      onMouseLeave={() => onInspect(null)}
      onFocus={() => onInspect(phase)}
      onBlur={() => onInspect(null)}
      // The panel below carries the description; the tile itself is the control.
      aria-label={`${phase.label}: ${phase.detail}`}
      className="group flex items-center gap-2.5 px-3.5 py-3 text-left min-w-0 border transition-all duration-200"
      style={{
        borderColor: active ? 'var(--accent-line)' : 'var(--border)',
        background: active ? 'rgba(59,130,246,0.06)' : 'var(--surface)',
        borderRadius: 4,
        opacity: dimmed ? 0.32 : 1,
        transform: active ? 'translateY(-2px)' : 'none',
        boxShadow: active ? 'var(--glow-accent)' : 'none',
      }}
    >
      <span
        className="w-1 h-1 rounded-full shrink-0 transition-transform duration-200"
        style={{
          background: lane === 'deep' ? 'var(--accent)' : 'var(--ghost)',
          transform: active ? 'scale(2.2)' : 'none',
        }}
      />
      <span
        className="font-mono text-[13px] truncate transition-colors duration-200"
        style={{ color: active ? '#fff' : 'var(--muted)' }}
      >
        {phase.label}
      </span>
    </button>
  );
}

export function CoverageLanes() {
  const [inspected, setInspected] = useState<ScanPhase | null>(null);
  const panelRef = useReveal(0);

  return (
    <div className="min-w-0">
      {LANES.map((lane, laneIndex) => (
        <div key={lane.key} className={laneIndex ? 'mt-9' : undefined}>
          <div className="flex items-baseline gap-3 mb-4">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: lane.dot }} />
            <h3 className="font-mono text-[13px] text-white">{lane.title}</h3>
            <span className="font-mono text-[11px]" style={{ color: 'var(--faint)' }}>
              {String(lane.phases.length).padStart(2, '0')}
            </span>
            <span className="font-mono text-[11px] truncate hidden sm:block" style={{ color: 'var(--ghost)' }}>
              {lane.note}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {lane.phases.map((phase, i) => (
              <Tile
                key={phase.id}
                phase={phase}
                lane={lane.key}
                delay={(laneIndex * 6 + i) * STAGGER}
                active={inspected?.id === phase.id}
                dimmed={Boolean(inspected) && inspected?.id !== phase.id}
                onInspect={setInspected}
              />
            ))}
          </div>
        </div>
      ))}

      {/*
        Fixed-height panel. Reserving the space means the tile grid never moves
        under the pointer when a description appears, which would otherwise
        make the rails unusable with a mouse.
      */}
      <div
        ref={panelRef}
        data-reveal="fade"
        className="mt-6 px-4 py-4 border min-h-[86px] flex items-start"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 4 }}
      >
        <p
          className="text-[13px] leading-relaxed transition-opacity duration-200"
          style={{ color: inspected ? 'var(--muted)' : 'var(--ghost)' }}
        >
          {inspected ? (
            <>
              <span className="font-mono text-white">{inspected.label}</span>
              <span style={{ color: 'var(--ghost)' }}> · </span>
              {inspected.detail}
            </>
          ) : (
            'Point at a module to read what it actually sends.'
          )}
        </p>
      </div>
    </div>
  );
}
