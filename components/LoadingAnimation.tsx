'use client';

const STEPS = [
  'Fetching page source...',
  'Analyzing vibe code patterns...',
  'Checking security headers...',
  'Detecting tech stack...',
  'Scanning for exposed keys...',
  'Checking public endpoints...',
  'Detecting hosting provider...',
  'Generating report...',
];

export function LoadingAnimation({ step }: { step?: number }) {
  const activeStep = step ?? 0;

  return (
    <div className="flex flex-col items-center gap-8 py-12 animate-fade-in-up">
      {/* Spinning rings */}
      <div className="relative w-24 h-24">
        <div
          className="absolute inset-0 rounded-full border-2 border-transparent animate-spin-slow"
          style={{ borderTopColor: '#8b5cf6', borderRightColor: 'rgba(139,92,246,0.3)' }}
        />
        <div
          className="absolute inset-2 rounded-full border-2 border-transparent"
          style={{
            borderTopColor: '#06b6d4',
            borderRightColor: 'rgba(6,182,212,0.3)',
            animation: 'spin-slow 2s linear infinite reverse',
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-3 h-3 rounded-full bg-violet-500 animate-pulse-glow" />
        </div>
      </div>

      <div className="text-center">
        <p className="text-white/80 font-medium mb-1">Analyzing website...</p>
        <p className="text-white/40 text-sm">{STEPS[activeStep % STEPS.length]}</p>
      </div>

      {/* Step indicators */}
      <div className="flex gap-1.5">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className="h-1 rounded-full transition-all duration-500"
            style={{
              width: i === activeStep % STEPS.length ? 24 : 6,
              background: i <= activeStep % STEPS.length ? '#8b5cf6' : 'rgba(255,255,255,0.1)',
            }}
          />
        ))}
      </div>

      <p className="text-xs text-white/25 max-w-xs text-center">
        Passive analysis only — no scanning, no exploitation, no brute force.
      </p>
    </div>
  );
}
