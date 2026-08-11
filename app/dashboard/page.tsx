'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { OwnershipVerify } from '@/components/OwnershipVerify';
import type { DeepScanResult, DeepFinding } from '@/types/deep-scan';
import { DEEP_COVERAGE_VERSION, DEEP_SCANNER_VERSION, DEEP_SCORING_VERSION } from '@/lib/deep-versions';
import { ScanRunner } from '@/components/ScanRunner';
import { getSecurityColor, getVibeColor } from '@/lib/vibe-constants';
import { ACCOUNT_POLICY_VERSION, DEEP_SCAN_TERMS_VERSION, isValidDisplayHandle } from '@/lib/policy';

// The SSE result event includes scanId alongside the DeepScanResult fields
type DeepScanResultWithId = DeepScanResult & { scanId?: string };

interface ScanSummary {
  id: string;
  createdAt: number;
  isPublic: boolean;
  result: {
    url: string;
    vibe: { score: number; label: string };
    security: { score: number; riskLevel: string };
    techStack: { name: string }[];
  };
}

interface DeepScanEntry {
  id: string;
  domain: string;
  result: DeepScanResult;
  created_at: number;
}

const vibeColor = getVibeColor;
const secColor = getSecurityColor;
function domain(url: string)  { try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname; } catch { return url; } }
function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

type DeepStep = 'idle' | 'enter-url' | 'verify' | 'confirmed' | 'scanning' | 'results';

// ── Auth gate ──────────────────────────────────────────────────────────────

function AuthGate() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, signup } = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') await login(email, password);
      else {
        const displayHandle = name.trim();
        if (!displayHandle) throw new Error('A public display handle is required.');
        if (!isValidDisplayHandle(displayHandle)) {
          throw new Error('Use 1–40 letters, numbers, dots, underscores, or hyphens; start with a letter or number.');
        }
        if (!policyAccepted) throw new Error('Please accept the privacy and account policy to continue.');
        await signup(email, password, displayHandle, ACCOUNT_POLICY_VERSION);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-57px)] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(248,113,113,0.9)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">
            {mode === 'login' ? 'Sign in to your scans' : 'Create your account'}
          </h1>
          <p className="text-white/40 text-sm">
            Deep vulnerability scans require a verified account
          </p>
        </div>

        <div
          className="rounded-2xl p-7 border border-white/8"
          style={{ background: 'rgba(255,255,255,0.025)', backdropFilter: 'blur(16px)' }}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5" htmlFor="dashboard-signup-handle">
                  Public display handle
                </label>
                <input
                  id="dashboard-signup-handle"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  maxLength={40}
                  pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,39}"
                  title="Use letters, numbers, dots, underscores, or hyphens; start with a letter or number."
                  autoComplete="username"
                  aria-describedby="dashboard-handle-privacy-note"
                  placeholder="your-handle"
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)')}
                />
                <p id="dashboard-handle-privacy-note" className="text-[11px] text-white/30 leading-relaxed mt-1.5">
                  Your handle is public when you comment or reply. Your public profile becomes discoverable only after you explicitly publish a scan.
                </p>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Min. 8 characters"
                className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)')}
              />
            </div>

            {mode === 'signup' && (
              <label className="flex items-start gap-2.5 rounded-xl border border-white/8 bg-white/2 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={policyAccepted}
                  onChange={event => setPolicyAccepted(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-red-500"
                />
                <span className="text-xs text-white/45 leading-relaxed">
                  I agree to the{' '}
                  <Link href="/privacy" className="text-red-300/80 underline hover:text-red-200">
                    privacy and account policy
                  </Link>
                  . <span className="text-[10px] text-white/25">Version {ACCOUNT_POLICY_VERSION}</span>
                </span>
              </label>
            )}

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (mode === 'signup' && !policyAccepted)}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
              style={{
                background: loading ? 'rgba(220,38,38,0.5)' : 'linear-gradient(135deg, #dc2626, #b91c1c)',
                boxShadow: '0 0 20px rgba(220,38,38,0.2)',
              }}
            >
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-white/30 mt-5">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            onClick={() => {
              setMode(m => m === 'login' ? 'signup' : 'login');
              setPolicyAccepted(false);
              setError('');
            }}
            className="text-red-400 hover:text-red-300 transition-colors font-medium"
          >
            {mode === 'login' ? 'Sign up free →' : 'Sign in →'}
          </button>
        </p>
      </div>
    </div>
  );
}

// ── Severity helpers ──────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#f59e0b',
  low:      '#6ee7b7',
  info:     '#94a3b8',
};
const SEV_BG: Record<string, string> = {
  critical: 'rgba(239,68,68,0.12)',
  high:     'rgba(249,115,22,0.12)',
  medium:   'rgba(245,158,11,0.12)',
  low:      'rgba(110,231,183,0.08)',
  info:     'rgba(148,163,184,0.08)',
};
const SEV_BORDER: Record<string, string> = {
  critical: 'rgba(239,68,68,0.25)',
  high:     'rgba(249,115,22,0.25)',
  medium:   'rgba(245,158,11,0.25)',
  low:      'rgba(110,231,183,0.15)',
  info:     'rgba(148,163,184,0.12)',
};

function FindingCard({ f }: { f: DeepFinding }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: SEV_BG[f.severity], borderColor: SEV_BORDER[f.severity] }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
            style={{ color: SEV_COLOR[f.severity], background: SEV_BG[f.severity], border: `1px solid ${SEV_BORDER[f.severity]}` }}
          >
            {f.severity}
          </span>
          <span className="text-sm font-medium text-white/80 truncate">{f.title}</span>
        </div>
        <svg
          className="w-4 h-4 shrink-0 transition-transform text-white/30"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
          <p className="text-xs text-white/55 leading-relaxed">{f.description}</p>
          {f.evidence && (
            <pre className="text-xs font-mono bg-black/30 rounded-lg p-3 text-emerald-300/80 overflow-x-auto whitespace-pre-wrap border border-white/5">
              {f.evidence}
            </pre>
          )}
          <div className="flex gap-2 items-start">
            <span className="text-[10px] font-bold text-emerald-400/70 uppercase tracking-wider shrink-0 mt-0.5">Fix</span>
            <p className="text-xs text-white/45 leading-relaxed">{f.remediation}</p>
          </div>
          {f.url && (
            <p className="text-[10px] font-mono text-white/25 truncate">{f.url}</p>
          )}
        </div>
      )}
    </div>
  );
}

const GRADE = (s: number) => s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 55 ? 'C' : s >= 35 ? 'D' : 'F';
const GRADE_COLOR = (g: string) => g === '—' ? '#94a3b8' : g === 'A' ? '#22c55e' : g === 'B' ? '#84cc16' : g === 'C' ? '#f59e0b' : g === 'D' ? '#f97316' : '#ef4444';

function CheckRow({ item }: { item: { id: string; label: string; description: string; status: string; detail: string } }) {
  const [open, setOpen] = useState(false);
  const icon = item.status === 'pass' ? '✓' : item.status === 'warn' ? '⚠' : item.status === 'fail' ? '✗' : '–';
  const color = item.status === 'pass' ? '#4ade80' : item.status === 'warn' ? '#fbbf24' : item.status === 'fail' ? '#f87171' : '#ffffff30';

  return (
    <button
      onClick={() => setOpen(o => !o)}
      className="w-full text-left rounded-xl border px-4 py-3 transition-all hover:bg-white/3"
      style={{
        background: item.status === 'fail' ? 'rgba(239,68,68,0.04)' : item.status === 'warn' ? 'rgba(251,191,36,0.04)' : 'rgba(255,255,255,0.02)',
        borderColor: item.status === 'fail' ? 'rgba(239,68,68,0.2)' : item.status === 'warn' ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.06)',
      }}
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold w-4 shrink-0" style={{ color }}>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white/75">{item.label}</span>
            <span className="text-[10px] text-white/30 hidden sm:block">{item.description}</span>
          </div>
        </div>
        <svg className="w-3 h-3 text-white/20 shrink-0 transition-transform" style={{ transform: open ? 'rotate(180deg)' : '' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {open && (
        <div className="mt-2 pt-2 border-t border-white/5 text-xs text-white/45 leading-relaxed" style={{ color: item.status === 'pass' ? '#4ade80cc' : item.status === 'warn' ? '#fbbf24cc' : item.status === 'fail' ? '#f87171cc' : '#94a3b8cc' }}>
          {item.detail}
        </div>
      )}
    </button>
  );
}

// ── AI Fix Prompt Section (deep scan) ────────────────────────────────────

type AiTool = 'cursor' | 'claude' | 'lovable' | 'v0' | 'bolt' | 'replit';

const TOOLS: { id: AiTool; name: string; tagline: string; accent: string; bg: string; border: string }[] = [
  { id: 'cursor',  name: 'Cursor',  tagline: 'Full-stack, any stack',    accent: '#4ade80', bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.2)' },
  { id: 'claude',  name: 'Claude',  tagline: 'Security-focused',         accent: '#fb923c', bg: 'rgba(251,146,60,0.08)',  border: 'rgba(251,146,60,0.2)' },
  { id: 'lovable', name: 'Lovable', tagline: 'Full-stack with Supabase', accent: '#f43f5e', bg: 'rgba(244,63,94,0.08)',  border: 'rgba(244,63,94,0.2)' },
  { id: 'v0',      name: 'v0',      tagline: 'Next.js + shadcn/ui',      accent: '#a78bfa', bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.2)' },
  { id: 'bolt',    name: 'Bolt',    tagline: 'React + Firebase',         accent: '#38bdf8', bg: 'rgba(56,189,248,0.08)',  border: 'rgba(56,189,248,0.2)' },
  { id: 'replit',  name: 'Replit',  tagline: 'Deploy-first, fast',       accent: '#e879f9', bg: 'rgba(232,121,249,0.08)', border: 'rgba(232,121,249,0.2)' },
];

function buildFixPrompt(tool: AiTool, result: DeepScanResult): string {
  const { domain, summary, findings } = result;
  const order: DeepFinding['severity'][] = ['critical', 'high', 'medium', 'low'];
  const actionable = findings
    .filter(f => f.severity !== 'info')
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

  const findingLines = actionable.slice(0, 12).map(f =>
    `[${f.severity.toUpperCase()}] ${f.title}\n  Issue: ${f.description}\n  Fix: ${f.remediation}`
  ).join('\n\n');

  const scoreBlurb = `${summary.score === null ? 'No score: request coverage was incomplete' : `Experimental risk index: ${summary.score}/100`} · ${summary.critical} critical · ${summary.high} high · ${summary.medium} medium`;

  const shared = `An experimental black-box scan of ${domain} reported ${actionable.length} potential finding${actionable.length === 1 ? '' : 's'}. Validate each observation and its application context before changing code.\n\n${scoreBlurb}\n\n--- Potential findings ---\n\n${findingLines || 'No actionable findings were reported by the selected checks.'}`;

  const suffix: Record<AiTool, string> = {
    cursor: `\n\n---\nPlease go through each issue one by one. For each:\n1. Identify the affected file(s) in the codebase\n2. Show me the exact code change needed\n3. Explain why the fix works\n\nStart with the critical issues first.`,
    claude: `\n\n---\nFor each potential finding:\n- Validate whether the evidence establishes an attack vector\n- Show the exact code fix (before/after) only when warranted\n- Suggest any related hardening improvements\n\nPrioritise critical > high > medium. Be precise about file paths.`,
    lovable: `\n\n---\nI'm using Lovable (React + Supabase). Help me fix each issue:\n1. Which file and component needs changing\n2. The updated code\n3. Any Supabase RLS policies that need updating\n\nFix critical issues first.`,
    v0: `\n\n---\nMy project uses Next.js App Router + shadcn/ui. For each issue:\n1. Which route, component or middleware is affected\n2. The corrected code snippet\n3. Any next.config.js or middleware changes needed`,
    bolt: `\n\n---\nI'm using React + Vite + Firebase. Help me fix these step by step:\n1. Affected component or Firebase rule\n2. The exact code fix\n3. Any Firebase security rule updates needed`,
    replit: `\n\n---\nI'm hosting on Replit (Node.js + Express). For each issue:\n1. Which endpoint or middleware to change\n2. The corrected code\n3. Any environment variable or config changes\n\nKeep it simple and clear.`,
  };

  return shared + suffix[tool];
}

function DeepScanPromptSection({ result }: { result: DeepScanResult }) {
  const [activeTool, setActiveTool] = useState<AiTool>('cursor');
  const [copied, setCopied] = useState(false);
  const prompt = buildFixPrompt(activeTool, result);
  const toolDef = TOOLS.find(t => t.id === activeTool)!;
  const hasIssues = result.summary.critical + result.summary.high + result.summary.medium > 0;

  function copyPrompt() {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.015)' }}>
      <div className="px-5 py-4 border-b border-white/6 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.8)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            <p className="text-xs font-semibold text-white/60 uppercase tracking-wider">AI Fix Prompt</p>
          </div>
          <p className="text-xs text-white/30">
            {hasIssues
              ? `${result.summary.critical + result.summary.high} critical/high issues · paste into your AI to get exact code fixes`
              : 'No critical issues · paste into your AI for hardening advice'}
          </p>
        </div>
        <button
          onClick={copyPrompt}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0"
          style={copied
            ? { background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80' }
            : { background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.25)', color: '#a78bfa' }
          }
        >
          {copied ? (
            <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Copied</>
          ) : (
            <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>Copy Prompt</>
          )}
        </button>
      </div>

      {/* Tool tabs */}
      <div className="flex gap-1 px-3 pt-3 overflow-x-auto pb-1">
        {TOOLS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTool(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all shrink-0"
            style={activeTool === t.id
              ? { background: t.bg, border: `1px solid ${t.border}`, color: t.accent }
              : { background: 'transparent', border: '1px solid transparent', color: 'rgba(255,255,255,0.3)' }
            }
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Prompt preview */}
      <div className="px-3 pb-3 pt-2">
        <div className="relative rounded-xl border overflow-hidden" style={{ borderColor: toolDef.border, background: 'rgba(0,0,0,0.3)' }}>
          <div className="px-3 py-1.5 border-b flex items-center gap-2" style={{ borderColor: toolDef.border, background: toolDef.bg }}>
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: toolDef.accent }} />
            <span className="text-[10px] font-medium" style={{ color: toolDef.accent }}>{toolDef.name} — {toolDef.tagline}</span>
          </div>
          <pre className="text-[11px] leading-relaxed text-white/55 p-4 whitespace-pre-wrap font-mono overflow-x-auto max-h-52 overflow-y-auto">
            {prompt}
          </pre>
        </div>
      </div>
    </div>
  );
}


function DeepScanResults({ result, domain, onReset }: { result: DeepScanResultWithId; domain: string; onReset: () => void }) {
  const [tab, setTab] = useState<'findings' | 'checked'>('findings');
  const { summary, findings, checked } = result;
  const scoreAvailable = summary.score !== null
    && result.coverage?.complete === true
    && result.versions?.scanner === DEEP_SCANNER_VERSION
    && result.versions?.scoring === DEEP_SCORING_VERSION
    && result.versions?.coverage === DEEP_COVERAGE_VERSION;
  const grade = scoreAvailable ? GRADE(summary.score as number) : '—';
  const gradeColor = GRADE_COLOR(grade);
  const order: DeepFinding['severity'][] = ['critical', 'high', 'medium', 'low', 'info'];
  const sorted = [...findings].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  const passCount = checked?.filter(c => c.status === 'pass').length ?? 0;
  const failCount = checked?.filter(c => c.status === 'fail').length ?? 0;
  const warnCount = checked?.filter(c => c.status === 'warn').length ?? 0;
  const unknownCount = checked?.filter(c => c.status === 'skip').length ?? 0;

  return (
    <div className="space-y-5">
      {/* Score header */}
      <div
        className="rounded-2xl border p-5"
        style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white/35 mb-0.5">Deep Scan Results for</p>
            <p className="font-mono text-base font-bold text-white/85 truncate">{domain}</p>
            <p className="text-xs text-white/25 mt-0.5">
              {findings.length} finding{findings.length !== 1 ? 's' : ''} · {checked?.length ?? 0} checks · {(result.duration / 1000).toFixed(1)}s
            </p>
            <p className="text-[10px] text-white/20 mt-1 font-mono">
              {result.versions
                ? `scanner ${result.versions.scanner} · score ${result.versions.scoring} · coverage ${result.versions.coverage}`
                : 'legacy/unversioned result · score withheld'}
            </p>
            <div className="flex gap-2 mt-3 flex-wrap">
              {(['critical','high','medium','low'] as const).map(sev =>
                summary[sev] > 0 && (
                  <span key={sev} className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ color: SEV_COLOR[sev], background: SEV_BG[sev], border: `1px solid ${SEV_BORDER[sev]}` }}>
                    {summary[sev]} {sev}
                  </span>
                )
              )}
              {findings.length === 0 && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-slate-300 bg-slate-500/10 border border-slate-500/20">
                  No confirmed findings
                </span>
              )}
              {!scoreAvailable && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-amber-300 bg-amber-500/10 border border-amber-500/20">
                  Incomplete coverage
                </span>
              )}
            </div>
          </div>
          {/* Grade */}
          <div className="text-center shrink-0">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: `${gradeColor}18`, border: `2px solid ${gradeColor}40` }}
            >
              <span className="text-3xl font-black" style={{ color: gradeColor }}>{grade}</span>
            </div>
            <p className="text-xs text-white/30 mt-1">{scoreAvailable ? `${summary.score}/100` : 'score withheld'}</p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3 mt-4 pt-4 border-t border-white/5">
          <div className="text-center">
            <p className="text-lg font-bold text-emerald-400">{passCount}</p>
            <p className="text-[10px] text-white/30 uppercase tracking-wider">No finding</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-amber-400">{warnCount}</p>
            <p className="text-[10px] text-white/30 uppercase tracking-wider">Warnings</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-red-400">{failCount}</p>
            <p className="text-[10px] text-white/30 uppercase tracking-wider">Failed</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-slate-400">{unknownCount}</p>
            <p className="text-[10px] text-white/30 uppercase tracking-wider">Unknown</p>
          </div>
        </div>
      </div>


      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/3 border border-white/6">
        <button
          onClick={() => setTab('findings')}
          className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
          style={{ background: tab === 'findings' ? 'rgba(239,68,68,0.15)' : 'transparent', color: tab === 'findings' ? '#f87171' : 'rgba(255,255,255,0.4)' }}
        >
          {findings.length} Findings
        </button>
        <button
          onClick={() => setTab('checked')}
          className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
          style={{ background: tab === 'checked' ? 'rgba(255,255,255,0.06)' : 'transparent', color: tab === 'checked' ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)' }}
        >
          {checked?.length ?? 0} Checks Run
        </button>
      </div>

      {/* Findings tab */}
      {tab === 'findings' && (
        <div className="space-y-2">
          {sorted.length === 0 ? (
            <div className="text-center py-10 rounded-xl border border-slate-500/20 bg-slate-500/5">
              <p className="text-2xl mb-2">🛡</p>
              <p className="text-sm font-semibold text-slate-300">No confirmed findings</p>
              <p className="text-xs text-white/35 mt-1">
                {scoreAvailable
                  ? `None of the ${checked?.length ?? 0} selected checks matched a finding. This is not proof the site is vulnerability-free.`
                  : `${result.coverage?.requestsFailed ?? 0} requests failed and ${result.coverage?.requestsBlocked ?? 0} were blocked, so no grade was produced.`}
              </p>
            </div>
          ) : (
            sorted.map(f => <FindingCard key={f.id} f={f} />)
          )}
        </div>
      )}

      {/* All checks tab */}
      {tab === 'checked' && checked && (
        <div className="space-y-1.5">
          {checked.map(item => <CheckRow key={item.id} item={item} />)}
        </div>
      )}

      {/* AI Fix Prompt */}
      <DeepScanPromptSection result={result} />

      <button onClick={onReset} className="text-xs text-white/25 hover:text-white/55 transition-colors">
        ← Scan another domain
      </button>
    </div>
  );
}

// ── Deep scan panel ────────────────────────────────────────────────────────

function DeepScanPanel() {
  const [step, setStep] = useState<DeepStep>('idle');
  const [inputUrl, setInputUrl] = useState('');
  const [scanDomain, setScanDomain] = useState('');
  const [urlError, setUrlError] = useState('');
  const [scanError, setScanError] = useState('');
  const [scanResult, setScanResult] = useState<DeepScanResultWithId | null>(null);
  const [authorizationAccepted, setAuthorizationAccepted] = useState(false);

  function handleUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUrlError('');
    let d = '';
    try {
      d = new URL(inputUrl.startsWith('http') ? inputUrl : `https://${inputUrl}`).hostname;
    } catch {
      setUrlError('Enter a valid domain — e.g. example.com');
      return;
    }
    if (!d) { setUrlError('Enter a valid domain'); return; }
    setScanDomain(d);
    setAuthorizationAccepted(false);
    setStep('verify');
  }

  function reset() {
    setStep('idle');
    setInputUrl('');
    setScanDomain('');
    setScanError('');
    setScanResult(null);
    setAuthorizationAccepted(false);
  }

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: 'rgba(239,68,68,0.03)', borderColor: 'rgba(239,68,68,0.18)' }}
    >
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(248,113,113,0.9)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-white/85">Deep Vulnerability Scan</h2>
            <p className="text-xs text-white/35 mt-0.5">Verified domain control · Selected active checks · Experimental</p>
          </div>
        </div>
        <Link href="/vulnerability" className="text-xs text-white/30 hover:text-white/60 transition-colors hidden sm:block">
          How it works →
        </Link>
      </div>

      <div className="p-6">
        {step === 'idle' && (
          <div className="text-center py-4">
            <p className="text-sm text-white/45 mb-5 max-w-sm mx-auto leading-relaxed">
              Run selected best-effort checks for reflection, exposed files, CORS, headers, and public paths. This is not a complete OWASP audit or penetration test.
            </p>
            <button
              onClick={() => setStep('enter-url')}
              className="px-6 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'rgba(248,113,113,0.9)' }}
            >
              + New Deep Scan
            </button>
          </div>
        )}

        {step === 'enter-url' && (
          <div>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/8 border border-amber-500/20 mb-5">
              <span className="text-amber-400 shrink-0">⚠</span>
              <p className="text-xs text-amber-300/80">
                Only submit a website you are explicitly authorised to test.
              </p>
            </div>
            <form onSubmit={handleUrlSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">Your website URL</label>
                <input
                  type="text"
                  value={inputUrl}
                  onChange={e => setInputUrl(e.target.value)}
                  placeholder="example.com or https://example.com"
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'rgba(239,68,68,0.45)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)')}
                />
                {urlError && <p className="text-xs text-red-400 mt-1.5">{urlError}</p>}
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                  style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)', boxShadow: '0 0 16px rgba(220,38,38,0.2)' }}
                >
                  Continue to Verify Domain Control
                </button>
                <button type="button" onClick={() => setStep('idle')} className="px-4 py-2.5 rounded-xl text-sm border border-white/8 text-white/40 hover:bg-white/5 transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {step === 'verify' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/8 border border-red-500/18">
              <span className="text-red-400 shrink-0 text-sm">🔐</span>
              <p className="text-xs text-red-300/80">
                Checking control of a publication channel for <span className="font-mono font-semibold text-white/65">{scanDomain}</span>.
                Someone able to place the token can complete this step; it does not prove legal ownership or authorisation.
              </p>
            </div>
            <OwnershipVerify
              domain={scanDomain}
              onVerified={() => {
                setAuthorizationAccepted(false);
                setStep('confirmed');
              }}
            />
            <button onClick={() => setStep('enter-url')} className="text-xs text-white/25 hover:text-white/55 transition-colors">
              ← Change URL
            </button>
          </div>
        )}

        {step === 'confirmed' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-4 flex items-center gap-3">
              <span className="text-emerald-400 text-lg">✓</span>
              <div>
                <p className="text-sm font-semibold text-emerald-300">Domain control verified for {scanDomain}</p>
                <p className="text-xs text-white/40 mt-0.5">Ready to run the experimental set of active checks.</p>
              </div>
            </div>
            {scanError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400">{scanError}</p>
              </div>
            )}
            <label className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/6 p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={authorizationAccepted}
                onChange={event => setAuthorizationAccepted(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-red-500"
              />
              <span className="text-xs text-white/55 leading-relaxed">
                I confirm that I am explicitly authorised to test <span className="font-mono text-white/75">{scanDomain}</span> and to run
                the active requests described in the{' '}
                <Link href="/vulnerability" className="text-amber-300/80 underline hover:text-amber-200">
                  deep-scan terms
                </Link>
                . I authorise this specific scan. This confirmation is recorded with the result.
                <span className="block mt-1 text-[10px] text-white/25">Terms version: {DEEP_SCAN_TERMS_VERSION}</span>
              </span>
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => { setScanError(''); setStep('scanning'); }}
                disabled={!authorizationAccepted}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)', boxShadow: '0 0 20px rgba(220,38,38,0.25)' }}
              >
                Run Deep Scan Now
              </button>
              <button onClick={reset} className="px-4 py-3 rounded-xl text-sm border border-white/8 text-white/40 hover:bg-white/5 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === 'scanning' && (
          <ScanRunner
            endpoint="/api/deep-scan"
            label={scanDomain}
            body={{
              domain: scanDomain,
              authorizationAccepted,
              termsVersion: DEEP_SCAN_TERMS_VERSION,
            }}
            onResult={r => { setScanResult(r); setStep('results'); }}
            onError={e => {
              setAuthorizationAccepted(false);
              setScanError(e);
              setStep('confirmed');
            }}
          />
        )}

        {step === 'results' && scanResult && (
          <DeepScanResults result={scanResult} domain={scanDomain} onReset={reset} />
        )}
      </div>
    </div>
  );
}

// ── Deep scan history card ─────────────────────────────────────────────────

function DeepScanHistoryCard({ entry }: { entry: DeepScanEntry }) {
  const { summary, findings } = entry.result;
  const scoreAvailable = summary.score !== null
    && entry.result.coverage?.complete === true
    && entry.result.versions?.scanner === DEEP_SCANNER_VERSION
    && entry.result.versions?.scoring === DEEP_SCORING_VERSION
    && entry.result.versions?.coverage === DEEP_COVERAGE_VERSION;
  const grade = scoreAvailable ? GRADE(summary.score as number) : '—';
  const gradeColor = GRADE_COLOR(grade);
  const criticalCount = summary.critical ?? 0;
  const highCount = summary.high ?? 0;

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5 rounded-xl border border-white/6 bg-white/2 hover:bg-white/3 hover:border-white/10 transition-all">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-sm font-semibold text-white/75 truncate">{entry.domain}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {criticalCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: SEV_COLOR.critical, background: SEV_BG.critical, border: `1px solid ${SEV_BORDER.critical}` }}>
              {criticalCount} critical
            </span>
          )}
          {highCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: SEV_COLOR.high, background: SEV_BG.high, border: `1px solid ${SEV_BORDER.high}` }}>
              {highCount} high
            </span>
          )}
          {findings.length === 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-slate-300" style={{ background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.2)' }}>
              No confirmed findings
            </span>
          )}
          <span className="text-[10px] text-white/25">{timeAgo(entry.created_at)}</span>
        </div>
      </div>
      <div className="text-center shrink-0">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: `${gradeColor}18`, border: `1.5px solid ${gradeColor}40` }}
        >
          <span className="text-lg font-black" style={{ color: gradeColor }}>{grade}</span>
        </div>
        <p className="text-[10px] text-white/25 mt-0.5">{scoreAvailable ? `${summary.score}/100` : 'withheld'}</p>
      </div>
    </div>
  );
}

// ── Scan history card ──────────────────────────────────────────────────────

function ScanCard({ scan }: { scan: ScanSummary }) {
  const d = domain(scan.result.url);
  const vc = vibeColor(scan.result.vibe.score);
  const sc = secColor(scan.result.security.score);
  const topTech = scan.result.techStack.slice(0, 3).map(t => t.name).join(' · ');

  return (
    <Link
      href={`/result/${scan.id}`}
      className="block p-4 rounded-xl border border-white/6 bg-white/2 hover:bg-white/4 hover:border-white/10 transition-all group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-mono text-sm font-semibold text-white/80 truncate">{d}</span>
            {!scan.isPublic && (
              <span className="text-[9px] text-white/30 border border-white/10 px-1.5 py-0.5 rounded uppercase tracking-wider">Private</span>
            )}
          </div>
          {topTech && <p className="text-xs text-white/30 truncate">{topTech}</p>}
          <p className="text-xs text-white/20 mt-1">{timeAgo(scan.createdAt)}</p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className="text-xs text-white/25 uppercase tracking-wider text-[9px]">Evidence</p>
            <p className="text-sm font-bold" style={{ color: vc }}>{scan.result.vibe.score}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-white/25 uppercase tracking-wider text-[9px]">Headers</p>
            <p className="text-sm font-bold" style={{ color: sc }}>{scan.result.security.score}</p>
          </div>
          <svg className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}

// ── Main dashboard ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [scansLoading, setScansLoading] = useState(true);
  const [deepScans, setDeepScans] = useState<DeepScanEntry[]>([]);
  const [deepScansLoading, setDeepScansLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetch('/api/user/scans')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setScans(data); })
      .finally(() => setScansLoading(false));

    fetch('/api/user/deep-scans')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setDeepScans(data); })
      .finally(() => setDeepScansLoading(false));
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0f' }}>
        <div className="w-5 h-5 border-2 border-white/20 border-t-violet-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ background: '#0a0a0f' }}>
        <AuthGate />
      </div>
    );
  }

  const PLAN_COLOR: Record<string, string> = {
    pro: 'text-violet-300 bg-violet-500/15 border-violet-500/30',
    team: 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30',
    free: 'text-white/40 bg-white/5 border-white/10',
  };

  return (
    <main className="min-h-screen px-6 py-10" style={{ background: '#0a0a0f' }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 40% at 50% -5%, rgba(239,68,68,0.06) 0%, transparent 60%)' }}
      />

      <div className="relative max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
          <div>
            <p className="text-white/35 text-sm mb-0.5">Welcome back</p>
            <h1 className="text-2xl font-bold text-white">{user.name}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${PLAN_COLOR[user.plan]}`}>
                {user.plan}
              </span>
              {user.plan === 'free' && user.scansRemaining !== null && (
                <span className="text-xs text-white/30">
                  {user.scansRemaining} passive scan{user.scansRemaining !== 1 ? 's' : ''} left today
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              href="/"
              className="px-4 py-2 rounded-xl text-xs font-medium border border-white/10 text-white/50 hover:bg-white/5 transition-colors"
            >
              ← Run passive scan
            </Link>
            <Link
              href="/security"
              className="px-4 py-2 rounded-xl text-xs font-medium border border-red-500/25 bg-red-500/8 text-red-400 hover:bg-red-500/12 transition-colors"
            >
              About deep scans
            </Link>
          </div>
        </div>

        {/* Deep scan panel */}
        <div className="mb-8">
          <DeepScanPanel />
        </div>

        {/* Deep scan history */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white/70 uppercase tracking-wider">Past Deep Scans</h2>
            <span className="text-xs text-white/25">{deepScans.length} scan{deepScans.length !== 1 ? 's' : ''}</span>
          </div>

          {deepScansLoading ? (
            <div className="space-y-2">
              {[1, 2].map(i => (
                <div key={i} className="h-16 rounded-xl border border-white/5 bg-white/2 animate-pulse" />
              ))}
            </div>
          ) : deepScans.length === 0 ? (
            <div
              className="rounded-xl border border-white/6 px-5 py-6 flex items-center justify-between gap-4"
              style={{ background: 'rgba(255,255,255,0.015)' }}
            >
              <div>
                <p className="text-sm text-white/45 mb-0.5">No deep scans yet</p>
                <p className="text-xs text-white/25">Run your first experimental active check set from the panel above.</p>
              </div>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-white/25">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {deepScans.map(entry => (
                <DeepScanHistoryCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>

        {/* My Scans */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white/70 uppercase tracking-wider">My Passive Scans</h2>
            <span className="text-xs text-white/25">{scans.length} scan{scans.length !== 1 ? 's' : ''}</span>
          </div>

          {scansLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 rounded-xl border border-white/5 bg-white/2 animate-pulse" />
              ))}
            </div>
          ) : scans.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-white/5 bg-white/2">
              <p className="text-3xl mb-3 opacity-20">◌</p>
              <p className="text-sm text-white/40 mb-1">No scans yet</p>
              <p className="text-xs text-white/25 mb-4">Run a passive scan from the homepage to see your history here.</p>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium border border-white/10 text-white/50 hover:bg-white/5 transition-colors"
              >
                Scan a site →
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {scans.map(scan => (
                <ScanCard key={scan.id} scan={scan} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
