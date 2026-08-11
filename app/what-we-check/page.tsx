import Link from 'next/link';
import type { Metadata } from 'next';
import { SURFACE_PHASE_IDS, DEEP_ONLY_PHASE_IDS, LANE_CHECK_COUNTS } from '@/lib/scan-lanes';
import { SCAN_PHASES } from '@/lib/scan-phases';

export const metadata: Metadata = {
  title: 'What Ironclad checks',
  description: `The ${LANE_CHECK_COUNTS.surface} checks that run on any site, and the ${DEEP_ONLY_PHASE_IDS.length} that need your permission.`,
};

const SURFACE_SET = new Set<string>(SURFACE_PHASE_IDS);
const DEEP_SET = new Set<string>(DEEP_ONLY_PHASE_IDS);

export default function WhatWeCheckPage() {
  const surface = SCAN_PHASES.filter(p => SURFACE_SET.has(p.id));
  const deep = SCAN_PHASES.filter(p => DEEP_SET.has(p.id));

  return (
    <main className="min-h-screen px-6 py-16" style={{ background: '#0a0a0f' }}>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-white/90 mb-3">What Ironclad checks</h1>
        <p className="text-white/45 leading-relaxed mb-10">
          {LANE_CHECK_COUNTS.deep} checks in total, split by permission rather than by price.
        </p>

        <section className="rounded-2xl border border-white/8 bg-white/2 p-6 mb-10">
          <h2 className="text-sm font-semibold text-white/80 mb-2">The rule</h2>
          <p className="text-sm text-white/45 leading-relaxed">
            The surface lane may request static artifacts that were published by accident: configuration
            files, backups, build output, documentation. It may not request application entry points: admin
            panels, internal APIs, object endpoints.
          </p>
          <p className="text-sm text-white/45 leading-relaxed mt-3">
            Asking a server for <code className="font-mono text-xs text-white/60">/.env</code> retrieves a
            file it is already handing to anyone who asks. Asking for{' '}
            <code className="font-mono text-xs text-white/60">/admin</code> looks like an intrusion attempt,
            can lock accounts out, and will wake somebody up. That is where the line sits, and no
            subscription moves it.
          </p>
        </section>

        <section className="mb-10">
          <div className="flex items-baseline gap-3 mb-4">
            <h2 className="text-xl font-bold text-white/85">{surface.length} surface checks</h2>
            <span className="text-xs uppercase tracking-widest text-emerald-400/70">Any site, no account</span>
          </div>
          <div className="space-y-2">
            {surface.map(phase => (
              <div key={phase.id} className="rounded-xl border border-white/6 bg-white/2 p-4">
                <h3 className="text-sm font-medium text-white/75 mb-1">{phase.label}</h3>
                <p className="text-xs text-white/35 leading-relaxed">{phase.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-10">
          <div className="flex items-baseline gap-3 mb-4">
            <h2 className="text-xl font-bold text-white/85">{deep.length} deep checks</h2>
            <span className="text-xs uppercase tracking-widest text-red-400/70">Verified domains only</span>
          </div>
          <p className="text-sm text-white/40 leading-relaxed mb-4">
            Each of these sends a real test payload or repeats requests against an endpoint. They run only
            after you have proved control of the domain, on the free plan as well as Pro.
          </p>
          <div className="space-y-2">
            {deep.map(phase => (
              <div key={phase.id} className="rounded-xl border border-red-500/10 p-4" style={{ background: 'rgba(239,68,68,0.03)' }}>
                <h3 className="text-sm font-medium text-white/75 mb-1">{phase.label}</h3>
                <p className="text-xs text-white/35 leading-relaxed">{phase.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-white/8 bg-white/2 p-6">
          <h2 className="text-sm font-semibold text-white/80 mb-2">What a clean result means</h2>
          <p className="text-sm text-white/45 leading-relaxed">
            A scan that finds nothing means these bounded probes observed nothing, not that the site is
            secure. Ironclad looks from the outside at one moment in time. It cannot read your source, review
            your access control, or reason about your business logic, and it is not a penetration test.
          </p>
        </section>

        <div className="mt-10 flex gap-3 flex-wrap">
          <Link href="/" className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            Run a scan
          </Link>
          <Link href="/scanner" className="px-5 py-2.5 rounded-xl text-sm text-white/50 border border-white/8 hover:bg-white/5 transition-colors">
            About the scanner
          </Link>
        </div>
      </div>
    </main>
  );
}
