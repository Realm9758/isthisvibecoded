'use client';

import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  feature: string;
  children: React.ReactNode;
}

export function UpgradeGate({ feature, children }: Props) {
  const { user } = useAuth();

  if (user?.plan === 'pro' || user?.plan === 'team') {
    return <>{children}</>;
  }

  return (
    <div className="relative rounded-xl overflow-hidden">
      {/* Blurred preview */}
      <div className="pointer-events-none select-none" style={{ filter: 'blur(3px)', opacity: 0.3 }}>
        {children}
      </div>

      {/* Overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0f]/60 backdrop-blur-sm rounded-xl border border-violet-500/20">
        <div className="text-center px-6">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center mx-auto mb-3">
            <span className="text-violet-400 text-lg">◈</span>
          </div>
          <p className="text-sm font-semibold text-white/80 mb-1">{feature}</p>
          <p className="text-xs text-white/40 mb-4">Unlock this feature with Pro</p>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
          >
            Upgrade to Pro — $9/mo
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ProBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-500/25 text-violet-400 ml-1.5">
      PRO
    </span>
  );
}
