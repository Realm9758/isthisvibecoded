'use client';

import { useState } from 'react';
import type { AnalysisResult } from '@/types/analysis';
import { ScoreRing } from './ScoreRing';
import { ShareModal } from './ShareModal';
import { useAuth } from '@/contexts/AuthContext';

const CATEGORY_COLORS: Record<string, string> = {
  framework: '#8b5cf6', library: '#06b6d4', hosting: '#22c55e',
  cdn: '#f59e0b', analytics: '#ec4899', backend: '#f97316', database: '#6366f1',
};
const CATEGORY_LABELS: Record<string, string> = {
  framework: 'Framework', library: 'Library', hosting: 'Hosting',
  cdn: 'CDN', analytics: 'Analytics', backend: 'Backend', database: 'Database',
};

function getVibeColor(s: number) { return s >= 70 ? '#8b5cf6' : s >= 30 ? '#f59e0b' : '#22c55e'; }
function getVibeGradient(s: number) {
  return s >= 70
    ? 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(99,102,241,0.08))'
    : s >= 30
    ? 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(234,179,8,0.05))'
    : 'linear-gradient(135deg, rgba(34,197,94,0.12), rgba(16,185,129,0.05))';
}
function getVibeBorder(s: number) {
  return s >= 70 ? 'rgba(139,92,246,0.25)' : s >= 30 ? 'rgba(245,158,11,0.25)' : 'rgba(34,197,94,0.25)';
}

// ── Passive vulnerability scanner (uses already-fetched data) ─────────────

interface PassiveFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
  fix: string;
}

const SEV_STYLE: Record<string, { color: string; bg: string; border: string; label: string }> = {
  critical: { color: '#f87171', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.22)', label: 'CRITICAL' },
  high:     { color: '#fb923c', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.22)', label: 'HIGH' },
  medium:   { color: '#fbbf24', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)',  label: 'MEDIUM' },
  low:      { color: '#6ee7b7', bg: 'rgba(110,231,183,0.06)', border: 'rgba(110,231,183,0.15)', label: 'LOW' },
  info:     { color: '#94a3b8', bg: 'rgba(148,163,184,0.06)', border: 'rgba(148,163,184,0.12)', label: 'INFO' },
};

function buildPassiveFindings(result: AnalysisResult): PassiveFinding[] {
  const findings: PassiveFinding[] = [];

  // HTTPS
  if (!result.security.httpsEnabled) {
    findings.push({
      id: 'no-https',
      severity: 'critical',
      title: 'Site served over HTTP — traffic is unencrypted',
      detail: 'All data between users and this site travels in plaintext. Passwords, tokens, and form data can be intercepted by anyone on the same network (coffee shop Wi-Fi, ISP, etc.).',
      fix: "Enable HTTPS. Use Let's Encrypt (free) via Certbot, or enable it in your hosting provider's dashboard.",
    });
  }

  // Security headers
  const headerSeverityMap: Record<string, PassiveFinding['severity']> = {
    'Content-Security-Policy': 'high',
    'Strict-Transport-Security': 'medium',
    'X-Frame-Options': 'medium',
    'X-Content-Type-Options': 'low',
    'Referrer-Policy': 'low',
    'Permissions-Policy': 'info',
  };
  const headerDetail: Record<string, string> = {
    'Content-Security-Policy': 'Without CSP, any XSS vulnerability has no secondary defence. Injected scripts can run freely, steal session cookies, and exfiltrate user data to attacker-controlled servers.',
    'Strict-Transport-Security': 'Without HSTS, browsers may access the site over HTTP on first visit, opening a window for SSL-stripping attacks. An attacker between the user and server can downgrade the connection.',
    'X-Frame-Options': 'The page can be embedded invisibly inside an iframe on an attacker\'s site. Users can be tricked into clicking hidden buttons — submitting forms, making purchases, or changing account settings.',
    'X-Content-Type-Options': 'Browsers may MIME-sniff response content. In edge cases this allows a text file uploaded by a user to be executed as JavaScript.',
    'Referrer-Policy': 'Full page URLs (including query params with tokens or IDs) are sent in the Referer header to every third-party resource loaded on the page — analytics, fonts, CDNs.',
    'Permissions-Policy': 'No restrictions on which browser APIs embedded scripts can access. Good defence-in-depth to explicitly disable camera, microphone, and geolocation for scripts that don\'t need them.',
  };
  const headerFix: Record<string, string> = {
    'Content-Security-Policy': "Add header: Content-Security-Policy: default-src 'self'; script-src 'self'. For Next.js, set this in next.config.js headers().",
    'Strict-Transport-Security': 'Add header: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
    'X-Frame-Options': 'Add header: X-Frame-Options: DENY (or use CSP frame-ancestors directive)',
    'X-Content-Type-Options': 'Add header: X-Content-Type-Options: nosniff',
    'Referrer-Policy': 'Add header: Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy': "Add header: Permissions-Policy: camera=(), microphone=(), geolocation=()",
  };

  for (const h of result.security.headers) {
    if (!h.present) {
      findings.push({
        id: `header-${h.name}`,
        severity: headerSeverityMap[h.name] ?? 'info',
        title: `Missing header: ${h.name}`,
        detail: headerDetail[h.name] ?? h.recommendation,
        fix: headerFix[h.name] ?? h.recommendation,
      });
    }
  }

  // Exposed dangerous files
  const dangerousFiles: Record<string, { severity: PassiveFinding['severity']; detail: string; fix: string }> = {
    '/.env': {
      severity: 'critical',
      detail: 'Your .env file is publicly accessible. It likely contains database passwords, API secrets, JWT signing keys, and third-party service credentials — everything an attacker needs for full system compromise.',
      fix: 'Block access immediately via your web server config. Rotate every secret in the file. Add .env to .gitignore and never commit it.',
    },
    '/config.json': {
      severity: 'high',
      detail: 'A config.json file is publicly accessible and may contain database connection strings, API keys, or application secrets.',
      fix: 'Move config files outside the webroot or restrict access via server configuration.',
    },
    '/wp-admin': {
      severity: 'medium',
      detail: 'WordPress admin panel is publicly reachable. It\'s a common target for brute-force attacks and authenticated WordPress exploits.',
      fix: 'Restrict /wp-admin to trusted IPs, add two-factor authentication, and keep WordPress + plugins updated.',
    },
    '/admin': {
      severity: 'medium',
      detail: 'An admin panel is publicly accessible. If not protected by strong authentication it\'s a direct path to system compromise.',
      fix: 'Ensure strong authentication is required. Consider IP allowlisting for admin paths.',
    },
  };

  for (const f of result.publicFiles) {
    if (f.accessible && dangerousFiles[f.path]) {
      const d = dangerousFiles[f.path];
      findings.push({
        id: `file-${f.path}`,
        severity: d.severity,
        title: `Sensitive path accessible: ${f.path}`,
        detail: d.detail,
        fix: d.fix,
      });
    }
  }

  // Public keys
  const keyRiskMap: Record<string, PassiveFinding['severity']> = {
    high: 'high', medium: 'medium', low: 'info', info: 'info',
  };
  for (const k of result.publicKeys) {
    if (k.risk === 'high' || k.risk === 'medium') {
      findings.push({
        id: `key-${k.type}`,
        severity: keyRiskMap[k.risk] ?? 'info',
        title: `${k.type} found in page source`,
        detail: `A ${k.type} was found embedded in the publicly visible HTML/JavaScript. If this is a server-side secret (not a publishable/public key), it must be moved to a server-only environment variable immediately.`,
        fix: 'Move secrets to server-side environment variables. Only public-facing keys (Stripe pk_, Supabase anon key) are safe to include client-side — and only if your Row Level Security / security rules are correctly configured.',
      });
    }
  }

  return findings.sort((a, b) => {
    const order = ['critical', 'high', 'medium', 'low', 'info'];
    return order.indexOf(a.severity) - order.indexOf(b.severity);
  });
}

function PassiveFindingRow({ f }: { f: PassiveFinding }) {
  const [open, setOpen] = useState(false);
  const s = SEV_STYLE[f.severity];
  return (
    <div className="rounded-xl border overflow-hidden transition-all" style={{ background: s.bg, borderColor: s.border }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span
          className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
          style={{ color: s.color, background: `${s.bg}`, border: `1px solid ${s.border}` }}
        >
          {s.label}
        </span>
        <span className="text-sm font-medium text-white/80 flex-1 min-w-0 truncate">{f.title}</span>
        <svg
          className="w-4 h-4 shrink-0 text-white/25 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : '' }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-white/6 space-y-3">
          <p className="text-xs text-white/55 leading-relaxed">{f.detail}</p>
          <div className="flex gap-2 items-start">
            <span className="text-[10px] font-bold text-emerald-400/80 uppercase tracking-wider shrink-0 mt-0.5">Fix</span>
            <p className="text-xs text-white/45 leading-relaxed">{f.fix}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

interface Props {
  result: AnalysisResult & { scanId?: string; roasts?: string[]; scansRemaining?: number | null };
  onReset: () => void;
  defaultRoastMode?: boolean;
}

export function ResultsDashboard({ result, onReset, defaultRoastMode = false }: Props) {
  const { user } = useAuth();
  const [roastMode, setRoastMode] = useState(defaultRoastMode);
  const [shareOpen, setShareOpen] = useState(false);
  const [vulnOpen, setVulnOpen] = useState(false);

  const vibeColor  = getVibeColor(result.vibe.score);
  const vibeGrad   = getVibeGradient(result.vibe.score);
  const vibeBorder = getVibeBorder(result.vibe.score);
  const roasts = result.roasts ?? [];

  const displayUrl = (() => { try { return new URL(result.url).hostname; } catch { return result.url; } })();

  const passiveFindings = buildPassiveFindings(result);
  const critCount = passiveFindings.filter(f => f.severity === 'critical').length;
  const highCount = passiveFindings.filter(f => f.severity === 'high').length;
  const medCount  = passiveFindings.filter(f => f.severity === 'medium').length;
  const totalIssues = critCount + highCount + medCount;

  return (
    <div className="w-full max-w-5xl mx-auto">
      {shareOpen && result.scanId && (
        <ShareModal result={result} onClose={() => setShareOpen(false)} />
      )}

      {/* ── Scan limit warning ── */}
      {result.scansRemaining !== undefined && result.scansRemaining !== null && result.scansRemaining <= 1 && (
        <div className="mb-5 p-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 flex items-center justify-between gap-3">
          <p className="text-xs text-yellow-400">
            {result.scansRemaining === 0 ? "You've used all free scans today." : '1 free scan remaining today.'}
          </p>
          <a href="/pricing" className="text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors shrink-0">View Plans →</a>
        </div>
      )}

      {/* ── Roast banner ── */}
      {roastMode && roasts.length > 0 && (
        <div className="mb-5 p-4 rounded-xl border border-orange-500/20 bg-orange-500/5 space-y-2">
          <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-3">🔥 AI Roast</p>
          {roasts.map((r, i) => (
            <div key={i} className="flex gap-2 text-sm text-orange-200/80">
              <span className="text-orange-400 shrink-0">›</span><span>{r}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Vibe result card ── */}
      <div
        className="rounded-2xl border p-6 mb-4"
        style={{ background: vibeGrad, borderColor: vibeBorder }}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <ScoreRing
            score={result.vibe.score}
            color={vibeColor}
            label={result.vibe.label}
            sublabel={`${result.vibe.confidence} confidence`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-white/40 text-sm">Verdict for</span>
              <span className="font-mono text-sm text-white/80 bg-black/20 px-2 py-0.5 rounded border border-white/10">{displayUrl}</span>
            </div>
            <h2 className="text-2xl font-black mb-3" style={{ color: vibeColor }}>{result.vibe.label}</h2>
            {result.vibe.reasons.length > 0 ? (
              <ul className="space-y-1.5">
                {result.vibe.reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-white/65">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: vibeColor }} />
                    {r}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-white/40 italic">No vibe-coding signals detected.</p>
            )}
          </div>
          <div className="flex flex-col gap-2 shrink-0 sm:self-start">
            <button
              onClick={() => setRoastMode(r => !r)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${roastMode ? 'bg-orange-500/15 border-orange-500/30 text-orange-400' : 'border-white/10 text-white/40 hover:bg-white/5'}`}
            >
              {roastMode ? '🔥 Roast On' : '🔥 Roast'}
            </button>
            {result.scanId && (
              <button
                onClick={() => setShareOpen(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/15 transition-colors"
              >
                Share
              </button>
            )}
            <button
              onClick={onReset}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 text-white/40 hover:bg-white/5 transition-colors"
            >
              New Scan
            </button>
          </div>
        </div>
      </div>

      {/* ── Tech stack ── */}
      {result.techStack.length > 0 && (
        <div className="rounded-xl border border-white/6 bg-white/2 p-4 mb-4">
          <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Tech Stack Detected</p>
          <div className="flex flex-wrap gap-2">
            {result.techStack.map(t => (
              <span
                key={t.name}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border"
                style={{ color: CATEGORY_COLORS[t.category], background: `${CATEGORY_COLORS[t.category]}18`, borderColor: `${CATEGORY_COLORS[t.category]}33` }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: CATEGORY_COLORS[t.category] }} />
                {t.name}
                <span className="opacity-40 text-[10px]">{CATEGORY_LABELS[t.category]}</span>
              </span>
            ))}
            {result.hosting.provider && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {result.hosting.provider}
                <span className="opacity-40 text-[10px]">Hosting</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Passive vulnerability scan toggle ── */}
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: vulnOpen ? 'rgba(239,68,68,0.22)' : 'rgba(255,255,255,0.07)' }}>
        <button
          onClick={() => setVulnOpen(v => !v)}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-white/2"
          style={{ background: vulnOpen ? 'rgba(239,68,68,0.04)' : 'rgba(255,255,255,0.01)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.22)' }}
            >
              🔍
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold text-white/80">Passive Vulnerability Scan</p>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-white/5 border border-white/10 text-white/35">
                  Read-only · No exploitation
                </span>
              </div>
              <p className="text-xs text-white/35 mt-0.5">
                {vulnOpen
                  ? `${passiveFindings.length} findings from publicly visible data`
                  : 'Check for likely hackable issues using only public information'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {!vulnOpen && totalIssues > 0 && (
              <div className="flex gap-1.5">
                {critCount > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10 border border-red-500/20">{critCount} critical</span>}
                {highCount > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-orange-400 bg-orange-500/10 border border-orange-500/20">{highCount} high</span>}
                {medCount > 0  && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-yellow-400 bg-yellow-500/10 border border-yellow-500/20">{medCount} med</span>}
              </div>
            )}
            {!vulnOpen && totalIssues === 0 && passiveFindings.length > 0 && (
              <span className="text-[10px] font-medium text-white/30">{passiveFindings.length} minor</span>
            )}
            <div
              className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={vulnOpen
                ? { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }
                : { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }
              }
            >
              {vulnOpen ? 'Hide ↑' : 'Scan →'}
            </div>
          </div>
        </button>

        {vulnOpen && (
          <div className="px-5 pb-5 space-y-3 border-t border-white/5 pt-4">
            {/* Summary row */}
            <div className="flex gap-4 flex-wrap mb-1">
              {(['critical','high','medium','low','info'] as const).map(sev => {
                const count = passiveFindings.filter(f => f.severity === sev).length;
                if (!count) return null;
                const s = SEV_STYLE[sev];
                return (
                  <div key={sev} className="text-center">
                    <p className="text-lg font-black" style={{ color: s.color }}>{count}</p>
                    <p className="text-[9px] uppercase tracking-wider" style={{ color: s.color, opacity: 0.6 }}>{sev}</p>
                  </div>
                );
              })}
              {passiveFindings.length === 0 && (
                <p className="text-sm text-emerald-400">✓ No issues found in publicly visible data.</p>
              )}
            </div>

            <p className="text-[10px] text-white/25 mb-3">
              All findings are derived from publicly visible HTTP headers, HTML source, and accessible files — no active probing or exploitation.
            </p>

            {/* Findings */}
            <div className="space-y-2">
              {passiveFindings.map(f => <PassiveFindingRow key={f.id} f={f} />)}
            </div>

            {/* Deep scan CTA */}
            <div
              className="mt-4 rounded-xl border p-4 flex items-start justify-between gap-4 flex-wrap"
              style={{ background: 'rgba(239,68,68,0.04)', borderColor: 'rgba(239,68,68,0.15)' }}
            >
              <div>
                <p className="text-sm font-bold text-white/75 mb-0.5">Want active testing?</p>
                <p className="text-xs text-white/35 max-w-sm">
                  This passive scan only reads what any browser can see. Deep Scan runs actual OWASP Top 10 tests — SQL injection, XSS, auth bypass, admin discovery — on sites you own.
                </p>
              </div>
              <a
                href={user ? '/dashboard' : '/signup'}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-white shrink-0 transition-all"
                style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)', boxShadow: '0 0 16px rgba(220,38,38,0.2)' }}
              >
                {user ? 'Run Deep Scan →' : 'Sign up & Deep Scan →'}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
