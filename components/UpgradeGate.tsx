'use client';

import Link from 'next/link';

interface Props {
  feature: string;
  children: React.ReactNode;
}

export function UpgradeGate({ feature, children }: Props) {
  return (
    <div className="relative rounded-xl overflow-hidden">
      {/* Blurred preview */}
      <div className="pointer-events-none select-none" style={{ filter: 'blur(3px)', opacity: 0.25 }}>
        {children}
      </div>

      {/* Coming Soon overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border border-violet-500/15"
        style={{ background: 'rgba(10,10,20,0.7)', backdropFilter: 'blur(6px)' }}>
        <div className="text-center px-6">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center mx-auto mb-3"
            style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.22)' }}
          >
            <span className="text-violet-400 text-base">◈</span>
          </div>
          <p className="text-xs font-bold tracking-widest uppercase text-violet-400 mb-1">Coming Soon</p>
          <p className="text-sm font-semibold text-white/70 mb-0.5">{feature}</p>
          <p className="text-xs text-white/30 mb-4">This feature is in development</p>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-violet-500/25 text-violet-400 hover:bg-violet-500/10 transition-colors"
          >
            View Plans
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ProBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-500/25 text-violet-400 ml-1.5 uppercase tracking-wider">
      Soon
    </span>
  );
}
