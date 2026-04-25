'use client';

const STEPS = [
  { id: 'fetch',     label: 'Fetching page source',          detail: 'GET / HTTP/1.1 — following redirects' },
  { id: 'vibe',      label: 'Analyzing vibe-code patterns',   detail: 'Checking AI fingerprints & stack signals' },
  { id: 'headers',   label: 'Checking security headers',      detail: 'CSP · HSTS · X-Frame-Options · COOP' },
  { id: 'tech',      label: 'Detecting tech stack',            detail: '40+ framework & library signatures' },
  { id: 'keys',      label: 'Scanning for exposed keys',       detail: 'API tokens · secrets · credentials' },
  { id: 'endpoints', label: 'Probing public endpoints',        detail: '.env · admin paths · config files' },
  { id: 'hosting',   label: 'Identifying hosting provider',    detail: 'Vercel · Netlify · Cloudflare · AWS' },
  { id: 'report',    label: 'Generating report',               detail: 'Scoring & ranking findings' },
];

export function LoadingAnimation({ step }: { step?: number }) {
  const activeIdx = (step ?? 0) % STEPS.length;

  return (
    <div className="w-full max-w-lg animate-fade-in-up">
      {/* Terminal window */}
      <div
        className="rounded-2xl border border-white/8 overflow-hidden"
        style={{ background: 'rgba(10,10,15,0.95)' }}
      >
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/6" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          </div>
          <span className="text-[11px] text-white/30 font-mono ml-2">vibe-check — passive scanner</span>
        </div>

        {/* Terminal body */}
        <div className="px-5 py-4 space-y-1.5 font-mono text-xs min-h-[200px]">
          {STEPS.map((s, i) => {
            const done    = i < activeIdx;
            const current = i === activeIdx;
            const pending = i > activeIdx;

            return (
              <div
                key={s.id}
                className="flex items-start gap-3 transition-all duration-300"
                style={{ opacity: pending ? 0.25 : 1 }}
              >
                {/* Status glyph */}
                <span
                  className="shrink-0 mt-px"
                  style={{
                    color: done ? '#4ade80' : current ? '#a78bfa' : 'rgba(255,255,255,0.25)',
                  }}
                >
                  {done ? '✓' : current ? '›' : '·'}
                </span>

                {/* Label */}
                <span style={{ color: done ? 'rgba(255,255,255,0.45)' : current ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.25)' }}>
                  {s.label}
                  {current && (
                    <span className="text-white/30 ml-2 text-[10px]">{s.detail}</span>
                  )}
                  {current && (
                    <span
                      className="inline-block w-1.5 h-3 ml-1.5 align-middle rounded-sm"
                      style={{
                        background: '#a78bfa',
                        animation: 'blink 1s step-end infinite',
                      }}
                    />
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="px-5 pb-4">
          <div className="h-0.5 rounded-full bg-white/6 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.round(((activeIdx + 1) / STEPS.length) * 100)}%`,
                background: 'linear-gradient(90deg, #7c3aed, #4f46e5)',
              }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[10px] text-white/25 font-mono">
              {activeIdx + 1}/{STEPS.length} checks
            </p>
            <p className="text-[10px] text-white/20">passive · read-only · no exploitation</p>
          </div>
        </div>
      </div>

      <style>{`@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }`}</style>
    </div>
  );
}
