'use client';

interface ScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  color: string;
  label: string;
  sublabel?: string;
  caption?: string;
}

export function ScoreRing({ score, size = 140, strokeWidth = 10, color, label, sublabel, caption = '/ 100' }: ScoreRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" style={{ transform: 'rotate(-90deg)' }}>
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={strokeWidth}
          />
          {/* Progress */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums" style={{ color }}>
            {score}
          </span>
          <span className="text-xs text-white/40 uppercase tracking-widest">{caption}</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-white/90">{label}</p>
        {sublabel && <p className="text-xs text-white/40 mt-0.5">{sublabel}</p>}
      </div>
    </div>
  );
}
