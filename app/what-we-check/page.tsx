import Link from 'next/link';
import type { Metadata } from 'next';
import { SURFACE_PHASE_IDS, DEEP_ONLY_PHASE_IDS, LANE_CHECK_COUNTS } from '@/lib/scan-lanes';
import { SCAN_PHASES } from '@/lib/scan-phases';

export const metadata: Metadata = {
  title: 'Coverage | Ironclad',
  description: `The ${LANE_CHECK_COUNTS.surface} checks that run on any site, and the ${DEEP_ONLY_PHASE_IDS.length} that need your permission.`,
};

const SURFACE_SET = new Set<string>(SURFACE_PHASE_IDS);
const DEEP_SET = new Set<string>(DEEP_ONLY_PHASE_IDS);

function CheckRow({ label, detail, index }: { label: string; detail: string; index: number }) {
  return (
    <div className="flex gap-5 px-6 py-5" style={{ borderTop: index === 0 ? undefined : '1px solid var(--border)' }}>
      <span className="font-mono text-xs shrink-0 pt-0.5 w-6" style={{ color: 'var(--ghost)' }}>
        {String(index + 1).padStart(2, '0')}
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-white mb-1.5">{label}</h3>
        <p className="font-mono text-xs leading-relaxed" style={{ color: 'var(--faint)' }}>{detail}</p>
      </div>
    </div>
  );
}

export default function WhatWeCheckPage() {
  const surface = SCAN_PHASES.filter(p => SURFACE_SET.has(p.id));
  const deep = SCAN_PHASES.filter(p => DEEP_SET.has(p.id));

  return (
    <main style={{ background: 'var(--bg)' }}>
      <section className="px-6 py-20 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-4xl mx-auto">
          <p className="eyebrow mb-6">coverage</p>
          <h1 className="display text-white text-[clamp(2.25rem,5vw,3.5rem)] mb-7">
            {LANE_CHECK_COUNTS.deep} checks, split by<br />permission not price.
          </h1>
          <p className="text-lg leading-relaxed max-w-2xl" style={{ color: 'var(--muted)' }}>
            The surface lane may request static artifacts that were published by accident: configuration
            files, backups, build output, documentation. It may not request application entry points: admin
            panels, internal APIs, object endpoints.
          </p>
          <p className="text-base leading-relaxed max-w-2xl mt-5" style={{ color: 'var(--muted)' }}>
            Asking a server for <span className="font-mono text-white/70">/.env</span> retrieves a file it is
            already handing to anyone who asks. Asking for <span className="font-mono text-white/70">/admin</span> looks
            like an intrusion attempt, can lock accounts out, and will wake somebody up. That is where the line
            sits, and no subscription moves it.
          </p>
        </div>
      </section>

      <section className="px-6 py-16 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-wrap items-baseline gap-4 mb-8">
            <h2 className="display text-white text-2xl">{surface.length} surface checks</h2>
            <span className="font-mono text-xs" style={{ color: 'var(--faint)' }}>any site · no account</span>
          </div>
          <div className="border" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
            {surface.map((phase, i) => (
              <CheckRow key={phase.id} label={phase.label} detail={phase.detail} index={i} />
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-16 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-wrap items-baseline gap-4 mb-4">
            <h2 className="display text-white text-2xl">{deep.length} deep checks</h2>
            <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>verified domains only</span>
          </div>
          <p className="text-sm leading-relaxed mb-8 max-w-2xl" style={{ color: 'var(--muted)' }}>
            Each of these sends a real test payload or repeats requests against an endpoint. They run only
            after you have proved control of the domain, on the free plan as well as Pro.
          </p>
          <div
            className="border"
            style={{ borderColor: 'var(--accent-line)', background: 'rgba(59,130,246,0.02)', borderRadius: 6 }}
          >
            {deep.map((phase, i) => (
              <CheckRow key={phase.id} label={phase.label} detail={phase.detail} index={i} />
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="border p-7 mb-10" style={{ borderColor: 'var(--border)', borderRadius: 6 }}>
            <h2 className="text-base font-semibold text-white mb-2.5">What a clean result means</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              A scan that finds nothing means these bounded probes observed nothing, not that the site is
              secure. Ironclad looks from the outside at one moment in time. It cannot read your source,
              review your access control, or reason about your business logic, and it is not a penetration
              test.
            </p>
          </div>

          <div className="flex gap-4 flex-wrap">
            <Link
              href="/"
              className="px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: 'var(--accent)', borderRadius: 4 }}
            >
              Run a scan
            </Link>
            <Link
              href="/scanner"
              className="px-6 py-3 font-mono text-sm border transition-colors hover:bg-white/4"
              style={{ borderColor: 'var(--border-2)', color: 'var(--muted)', borderRadius: 4 }}
            >
              about the scanner
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
