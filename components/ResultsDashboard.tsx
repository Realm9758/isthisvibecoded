'use client';

import { useState } from 'react';
import type { AnalysisResult } from '@/types/analysis';
import { ScoreRing } from './ScoreRing';
import { ShareModal } from './ShareModal';
import { useAuth } from '@/contexts/AuthContext';

// ── AI Prompt Section ─────────────────────────────────────────────────────

type AiTool = 'lovable' | 'v0' | 'bolt' | 'cursor' | 'claude' | 'replit';

interface ToolDef {
  id: AiTool;
  name: string;
  tagline: string;
  accent: string;
  bg: string;
  border: string;
}

const TOOLS: ToolDef[] = [
  { id: 'lovable',  name: 'Lovable',  tagline: 'Full-stack with Supabase', accent: '#f43f5e', bg: 'rgba(244,63,94,0.08)',  border: 'rgba(244,63,94,0.2)' },
  { id: 'v0',       name: 'v0',       tagline: 'Next.js + shadcn/ui',      accent: '#a78bfa', bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.2)' },
  { id: 'bolt',     name: 'Bolt',     tagline: 'React + Firebase',         accent: '#38bdf8', bg: 'rgba(56,189,248,0.08)',  border: 'rgba(56,189,248,0.2)' },
  { id: 'cursor',   name: 'Cursor',   tagline: 'Full-stack, any stack',    accent: '#4ade80', bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.2)' },
  { id: 'claude',   name: 'Claude',   tagline: 'Code-heavy, TypeScript',   accent: '#fb923c', bg: 'rgba(251,146,60,0.08)',  border: 'rgba(251,146,60,0.2)' },
  { id: 'replit',   name: 'Replit',   tagline: 'Deploy-first, fast',       accent: '#e879f9', bg: 'rgba(232,121,249,0.08)', border: 'rgba(232,121,249,0.2)' },
];

function detectLikelyTool(result: AnalysisResult): AiTool {
  const names = result.techStack.map(t => t.name.toLowerCase());
  const hosting = (result.hosting.provider ?? '').toLowerCase();
  const hasSupabase  = names.some(n => n.includes('supabase'));
  const hasFirebase  = names.some(n => n.includes('firebase'));
  const hasNextJs    = names.some(n => n.includes('next'));
  const hasShadcn    = names.some(n => n.includes('shadcn') || n.includes('radix'));
  const hasReact     = names.some(n => n.includes('react'));
  const onVercel     = hosting.includes('vercel');
  const onReplit     = hosting.includes('replit');

  if (onReplit) return 'replit';
  if (hasSupabase && hasNextJs && hasShadcn) return 'lovable';
  if (hasNextJs && hasShadcn && onVercel) return 'v0';
  if (hasFirebase && hasReact) return 'bolt';
  if (hasSupabase && hasReact) return 'lovable';
  if (hasNextJs && onVercel) return 'cursor';
  if (hasNextJs) return 'claude';
  return 'cursor';
}

function buildPrompt(tool: AiTool, result: AnalysisResult): string {
  const techNames = result.techStack.map(t => t.name);
  const hosting = result.hosting.provider;
  const domain = (() => { try { return new URL(result.url).hostname; } catch { return result.url; } })();
  const stack = [...techNames, hosting].filter(Boolean).join(', ');
  const missingHeaders = result.security.headers.filter(h => !h.present).map(h => `- Add ${h.name}: ${h.recommendation}`);
  const exposedPaths = result.publicFiles
    .filter(f => f.accessible && ['/.env', '/config.json', '/wp-admin', '/admin'].includes(f.path))
    .map(f => `- Review ${f.path} (${f.status})${f.evidence ? `: ${f.evidence}` : ''}`);
  const exposedKeys = result.publicKeys
    .filter(k => k.risk === 'high' || k.risk === 'medium')
    .map(k => `- Move ${k.type} out of public client code unless it is intentionally publishable`);
  const findings = [...missingHeaders, ...exposedPaths, ...exposedKeys];
  const findingText = findings.length > 0 ? findings.join('\n') : '- No major passive findings; review headers and deployment defaults anyway.';

  const toolFocus: Record<AiTool, string> = {
    lovable: 'Supabase auth/RLS, environment variables, deployment headers, and protected routes.',
    v0: 'Next.js App Router headers, middleware, shadcn/ui-safe defaults, and deployment config.',
    bolt: 'React/Vite deployment config, backend route protection, and environment variable handling.',
    cursor: 'Make a small, production-quality patch with tests or verification steps.',
    claude: 'Reason carefully through the security implications before editing files.',
    replit: 'Keep the deployment simple and document required environment variables.',
  };

  function buildFixPrompt(toolName: string, focus: string) {
    return `I own ${domain}. Please help me fix these passive VibeScan findings in my existing codebase.

Detected stack: ${stack || 'Unknown from public HTML'}
Target agent: ${toolName}
Focus areas: ${focus}

Findings to fix:
${findingText}

Requirements:
1. Make the smallest safe code/config changes needed.
2. Do not remove authentication or weaken existing protections.
3. Add secure HTTP headers at the app or hosting layer.
4. If an exposed path is intentional, protect it with authentication or explain why it is safe.
5. Keep secrets server-side only and rotate any leaked secret.
6. Show the exact files changed and verification steps.

Before editing, inspect the current framework and deployment setup. After editing, run lint/build or give manual verification commands if those are not available.`;
  }

  const prompts: Record<AiTool, string> = {
    lovable: buildFixPrompt('Lovable', toolFocus.lovable),
    v0: buildFixPrompt('v0', toolFocus.v0),
    bolt: buildFixPrompt('Bolt', toolFocus.bolt),
    cursor: buildFixPrompt('Cursor', toolFocus.cursor),
    claude: buildFixPrompt('Claude', toolFocus.claude),
    replit: buildFixPrompt('Replit', toolFocus.replit),
  };

  return prompts[tool];
}

function PromptSection({ result }: { result: AnalysisResult }) {
  const detected = detectLikelyTool(result);
  const [activeTool, setActiveTool] = useState<AiTool>(detected);
  const [copied, setCopied] = useState(false);

  const prompt = buildPrompt(activeTool, result);
  const toolDef = TOOLS.find(t => t.id === activeTool)!;
  const detectedDef = TOOLS.find(t => t.id === detected)!;

  function copyPrompt() {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-2xl border border-white/8 overflow-hidden mb-4" style={{ background: 'rgba(255,255,255,0.015)' }}>
      <div className="px-5 py-4 border-b border-white/6 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.8)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            <p className="text-xs font-semibold text-white/60 uppercase tracking-wider">Fix Prompt</p>
          </div>
          <p className="text-xs text-white/30">
            {result.vibe.score >= 45 ? (
              <>Best fit: <span className="font-semibold" style={{ color: detectedDef.accent }}>{detectedDef.name}</span> · review before applying</>
            ) : (
              <>Generic remediation prompt based on visible stack · review before applying</>
            )}
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
            {t.id === detected && (
              <span className="text-[9px] px-1 rounded" style={{ background: t.bg, color: t.accent }}>detected</span>
            )}
          </button>
        ))}
      </div>

      <div className="px-3 pb-3 pt-2">
        <div
          className="relative rounded-xl border overflow-hidden"
          style={{ borderColor: toolDef.border, background: 'rgba(0,0,0,0.3)' }}
        >
          <div className="px-2 py-1.5 border-b flex items-center gap-2" style={{ borderColor: toolDef.border, background: toolDef.bg }}>
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

// ── Category / vibe helpers ───────────────────────────────────────────────

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

// ── Fix code examples ─────────────────────────────────────────────────────

interface FixCodeExample {
  label: string;
  code: string;
}

// Mirrors CHECKED_HEADERS penalties in lib/security-headers.ts
const HEADER_PENALTIES: Record<string, number> = {
  'Content-Security-Policy':   25,
  'Strict-Transport-Security': 20,
  'X-Frame-Options':           5,
  'X-Content-Type-Options':    10,
  'Referrer-Policy':           10,
  'Permissions-Policy':        5,
};

const HEADER_FIX_CODES: Record<string, FixCodeExample[]> = {
  'Content-Security-Policy': [
    {
      label: 'Next.js',
      code: `// next.config.js
module.exports = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [{
        key: 'Content-Security-Policy',
        value: "default-src 'self'; script-src 'self' 'unsafe-inline'",
      }],
    }];
  },
};`,
    },
    { label: 'Nginx',  code: `add_header Content-Security-Policy "default-src 'self'" always;` },
    { label: 'Apache', code: `Header always set Content-Security-Policy "default-src 'self'"` },
  ],
  'Strict-Transport-Security': [
    {
      label: 'Next.js',
      code: `// next.config.js — inside headers()
{ key: 'Strict-Transport-Security',
  value: 'max-age=31536000; includeSubDomains; preload' }`,
    },
    { label: 'Nginx',  code: `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;` },
    { label: 'Apache', code: `Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"` },
  ],
  'X-Frame-Options': [
    {
      label: 'Next.js',
      code: `// next.config.js — inside headers()
{ key: 'X-Frame-Options', value: 'DENY' }`,
    },
    { label: 'Nginx',  code: `add_header X-Frame-Options "DENY" always;` },
    { label: 'Apache', code: `Header always set X-Frame-Options "DENY"` },
  ],
  'X-Content-Type-Options': [
    {
      label: 'Next.js',
      code: `{ key: 'X-Content-Type-Options', value: 'nosniff' }`,
    },
    { label: 'Nginx',  code: `add_header X-Content-Type-Options "nosniff" always;` },
    { label: 'Apache', code: `Header always set X-Content-Type-Options "nosniff"` },
  ],
  'Referrer-Policy': [
    {
      label: 'Next.js',
      code: `{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }`,
    },
    { label: 'Nginx',  code: `add_header Referrer-Policy "strict-origin-when-cross-origin" always;` },
    { label: 'Apache', code: `Header always set Referrer-Policy "strict-origin-when-cross-origin"` },
  ],
  'Permissions-Policy': [
    {
      label: 'Next.js',
      code: `{ key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }`,
    },
    { label: 'Nginx',  code: `add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;` },
    { label: 'Apache', code: `Header always set Permissions-Policy "camera=(), microphone=(), geolocation=()"` },
  ],
};

const NO_HTTPS_FIX_CODES: FixCodeExample[] = [
  {
    label: "Let's Encrypt",
    code: `# Install Certbot (Ubuntu/Debian)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com`,
  },
  {
    label: 'Cloudflare',
    code: `# Cloudflare Dashboard:
# SSL/TLS → Overview → Mode: Full (strict)
# SSL/TLS → Edge Certificates → Always Use HTTPS: ON`,
  },
  {
    label: 'Vercel / Netlify',
    code: `# Both platforms enable HTTPS automatically.
# Ensure your custom domain is added in
# project settings and DNS is pointing correctly.`,
  },
];

// ── Passive vulnerability scanner (uses already-fetched data) ─────────────

interface PassiveFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
  fix: string;
  fixCodes?: FixCodeExample[];
}

const SEV_STYLE: Record<string, { color: string; bg: string; border: string; label: string; icon: string }> = {
  critical: { color: '#f87171', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.22)',  label: 'CRITICAL', icon: '⛔' },
  high:     { color: '#fb923c', bg: 'rgba(249,115,22,0.08)',  border: 'rgba(249,115,22,0.22)', label: 'HIGH',     icon: '🔴' },
  medium:   { color: '#fbbf24', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)',  label: 'MEDIUM',   icon: '🟡' },
  low:      { color: '#6ee7b7', bg: 'rgba(110,231,183,0.06)', border: 'rgba(110,231,183,0.15)',label: 'LOW',      icon: '🟢' },
  info:     { color: '#94a3b8', bg: 'rgba(148,163,184,0.06)', border: 'rgba(148,163,184,0.12)',label: 'INFO',     icon: 'ℹ️' },
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
      fixCodes: NO_HTTPS_FIX_CODES,
    });
  }

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
    'X-Frame-Options': "The page can be embedded invisibly inside an iframe on an attacker's site. Users can be tricked into clicking hidden buttons — submitting forms, making purchases, or changing account settings.",
    'X-Content-Type-Options': 'Browsers may MIME-sniff response content. In edge cases this allows a text file uploaded by a user to be executed as JavaScript.',
    'Referrer-Policy': 'Full page URLs (including query params with tokens or IDs) are sent in the Referer header to every third-party resource loaded on the page — analytics, fonts, CDNs.',
    'Permissions-Policy': "No restrictions on which browser APIs embedded scripts can access. Good defence-in-depth to explicitly disable camera, microphone, and geolocation for scripts that don't need them.",
  };
  const headerFix: Record<string, string> = {
    'Content-Security-Policy': "Add a Content-Security-Policy header. Start with: default-src 'self'; adjust based on your external resource needs.",
    'Strict-Transport-Security': 'Add header: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload',
    'X-Frame-Options': 'Add header: X-Frame-Options: DENY (or use CSP frame-ancestors directive)',
    'X-Content-Type-Options': 'Add header: X-Content-Type-Options: nosniff',
    'Referrer-Policy': 'Add header: Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy': 'Add header: Permissions-Policy: camera=(), microphone=(), geolocation=()',
  };

  for (const h of result.security.headers) {
    if (!h.present) {
      findings.push({
        id: `header-${h.name}`,
        severity: headerSeverityMap[h.name] ?? 'info',
        title: `Missing header: ${h.name}`,
        detail: headerDetail[h.name] ?? h.recommendation,
        fix: headerFix[h.name] ?? h.recommendation,
        fixCodes: HEADER_FIX_CODES[h.name],
      });
    }
  }

  const dangerousFiles: Record<string, { severity: PassiveFinding['severity']; detail: string; fix: string; fixCodes?: FixCodeExample[] }> = {
    '/.env': {
      severity: 'critical',
      detail: 'Your .env file is publicly accessible. It likely contains database passwords, API secrets, JWT signing keys, and third-party service credentials — everything an attacker needs for full system compromise.',
      fix: 'Block access immediately via your web server config. Rotate every secret in the file. Add .env to .gitignore and never commit it.',
      fixCodes: [
        { label: 'Nginx',  code: `location ~ /\\.env { deny all; return 403; }` },
        { label: 'Apache', code: `<Files ".env">\n  Order allow,deny\n  Deny from all\n</Files>` },
        { label: 'Vercel', code: `# vercel.json\n{\n  "headers": [{\n    "source": "/.env",\n    "headers": [{ "key": "x-robots-tag", "value": "noindex" }]\n  }]\n}\n# Also: move secrets to Vercel Environment Variables dashboard.` },
      ],
    },
    '/config.json': {
      severity: 'high',
      detail: 'A config.json file is publicly accessible and may contain database connection strings, API keys, or application secrets.',
      fix: 'Move config files outside the webroot or restrict access via server configuration.',
      fixCodes: [
        { label: 'Nginx', code: `location ~ /config\\.json { deny all; return 403; }` },
      ],
    },
    '/wp-admin': {
      severity: 'medium',
      detail: "WordPress admin panel is publicly reachable. It's a common target for brute-force attacks and authenticated WordPress exploits.",
      fix: 'Restrict /wp-admin to trusted IPs, add two-factor authentication, and keep WordPress + plugins updated.',
      fixCodes: [
        { label: 'Nginx', code: `location /wp-admin {\n  allow 203.0.113.0; # your IP\n  deny all;\n}` },
      ],
    },
    '/admin': {
      severity: 'medium',
      detail: "An admin panel is publicly accessible. If not protected by strong authentication it's a direct path to system compromise.",
      fix: 'Ensure strong authentication is required. Consider IP allowlisting for admin paths.',
      fixCodes: [
        { label: 'Nginx', code: `location /admin {\n  allow 203.0.113.0; # your IP\n  deny all;\n}` },
      ],
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
        fixCodes: d.fixCodes,
      });
    }
  }

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
        fixCodes: [
          { label: 'Next.js', code: `// .env.local (never committed)\nSECRET_KEY=your_secret_here\n\n// Server component or API route only:\nconst key = process.env.SECRET_KEY;\n\n// For client-safe public vars:\nNEXT_PUBLIC_ANON_KEY=your_public_key` },
        ],
      });
    }
  }

  return findings.sort((a, b) => {
    const order = ['critical', 'high', 'medium', 'low', 'info'];
    return order.indexOf(a.severity) - order.indexOf(b.severity);
  });
}

// ── Fix code block with tabs + copy ──────────────────────────────────────

function FixCodeBlock({ examples }: { examples: FixCodeExample[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(examples[activeIdx].code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const active = examples[activeIdx];

  return (
    <div className="mt-3 rounded-xl border border-white/8 overflow-hidden" style={{ background: 'rgba(0,0,0,0.35)' }}>
      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-white/6 px-2 py-1" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <div className="flex gap-1">
          {examples.map((ex, i) => (
            <button
              key={ex.label}
              onClick={() => setActiveIdx(i)}
              className="px-2.5 py-1 rounded text-[10px] font-medium transition-all"
              style={i === activeIdx
                ? { background: 'rgba(139,92,246,0.2)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }
                : { color: 'rgba(255,255,255,0.3)', border: '1px solid transparent' }
              }
            >
              {ex.label}
            </button>
          ))}
        </div>
        <button
          onClick={copy}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all shrink-0"
          style={copied
            ? { color: '#4ade80', background: 'rgba(74,222,128,0.1)' }
            : { color: 'rgba(255,255,255,0.3)', background: 'transparent' }
          }
        >
          {copied ? (
            <><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Copied</>
          ) : (
            <><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> Copy</>
          )}
        </button>
      </div>
      <pre className="text-[10px] leading-relaxed text-emerald-300/70 px-4 py-3 overflow-x-auto font-mono whitespace-pre">
        {active.code}
      </pre>
    </div>
  );
}

// ── False positive button ─────────────────────────────────────────────────

function FalsePositiveButton({ finding, site }: { finding: PassiveFinding; site: string }) {
  const [state, setState] = useState<'idle' | 'open' | 'sent'>('idle');
  const [comment, setComment] = useState('');

  async function submit() {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site, issueId: finding.id, issueTitle: finding.title, comment }),
    });
    setState('sent');
  }

  if (state === 'sent') {
    return <p className="text-[10px] text-emerald-400/70 mt-2">✓ Reported — thanks for the feedback.</p>;
  }

  if (state === 'open') {
    return (
      <div className="mt-3 space-y-2">
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Optional: why do you think this is a false positive?"
          rows={2}
          className="w-full px-3 py-2 rounded-lg text-[11px] text-white/60 placeholder-white/20 resize-none outline-none"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        />
        <div className="flex gap-2">
          <button
            onClick={submit}
            className="px-3 py-1 rounded-lg text-[11px] font-semibold text-white"
            style={{ background: 'rgba(139,92,246,0.8)', border: '1px solid rgba(139,92,246,0.4)' }}
          >
            Submit
          </button>
          <button
            onClick={() => setState('idle')}
            className="px-3 py-1 rounded-lg text-[11px] text-white/40 border border-white/10"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setState('open')}
      className="mt-2 text-[10px] text-white/25 hover:text-white/50 transition-colors"
    >
      ⚑ Report incorrect detection
    </button>
  );
}

// ── Passive finding row ───────────────────────────────────────────────────

function PassiveFindingRow({ f, site }: { f: PassiveFinding; site: string }) {
  const [open, setOpen] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const s = SEV_STYLE[f.severity];

  return (
    <div className="rounded-xl border overflow-hidden transition-all" style={{ background: s.bg, borderColor: s.border, borderLeftWidth: 3, borderLeftColor: s.color }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="text-sm shrink-0">{s.icon}</span>
        <span
          className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
          style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
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

          <div className="space-y-1">
            <div className="flex gap-2 items-start">
              <span className="text-[10px] font-bold text-emerald-400/80 uppercase tracking-wider shrink-0 mt-0.5">Fix</span>
              <p className="text-xs text-white/45 leading-relaxed">{f.fix}</p>
            </div>

            {f.fixCodes && f.fixCodes.length > 0 && (
              <button
                onClick={() => setShowCode(c => !c)}
                className="flex items-center gap-1.5 text-[10px] font-medium transition-colors mt-1"
                style={{ color: showCode ? '#a78bfa' : 'rgba(167,139,250,0.5)' }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
                </svg>
                {showCode ? 'Hide code example' : 'Show code example'}
              </button>
            )}
          </div>

          {showCode && f.fixCodes && <FixCodeBlock examples={f.fixCodes} />}

          <FalsePositiveButton finding={f} site={site} />
        </div>
      )}
    </div>
  );
}

// ── Score breakdown ───────────────────────────────────────────────────────

function ScoreBreakdown({ result }: { result: AnalysisResult }) {
  const [open, setOpen] = useState(false);

  // Build list of deductions
  const deductions: { label: string; penalty: number; color: string }[] = [];

  if (!result.security.httpsEnabled) {
    deductions.push({ label: 'No HTTPS', penalty: 30, color: '#f87171' });
  }

  for (const h of result.security.headers) {
    if (!h.present) {
      const penalty = HEADER_PENALTIES[h.name] ?? 0;
      if (penalty > 0) {
        deductions.push({
          label: `Missing ${h.name}`,
          penalty,
          color: penalty >= 20 ? '#f87171' : penalty >= 10 ? '#fb923c' : '#fbbf24',
        });
      }
    }
  }

  const totalDeducted = deductions.reduce((s, d) => s + d.penalty, 0);
  const score = Math.max(0, 100 - totalDeducted);
  const scoreColor = score >= 80 ? '#4ade80' : score >= 50 ? '#fbbf24' : '#f87171';

  return (
    <div className="rounded-xl border border-white/6 overflow-hidden" style={{ background: 'rgba(255,255,255,0.01)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/2 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
          </svg>
          <p className="text-xs font-semibold text-white/55">How this score is calculated</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-black" style={{ color: scoreColor }}>{score}/100</span>
          <svg
            className="w-3.5 h-3.5 text-white/25 transition-transform"
            style={{ transform: open ? 'rotate(180deg)' : '' }}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-white/6 px-4 pb-4 pt-3 space-y-2">
          {/* Starting score row */}
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-white/40">Starting score</span>
                <span className="text-[11px] font-semibold text-white/50">100</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/6 overflow-hidden">
                <div className="h-full w-full rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} />
              </div>
            </div>
          </div>

          {/* Deductions */}
          {deductions.length === 0 ? (
            <p className="text-[11px] text-emerald-400 py-1">No deductions — perfect security headers.</p>
          ) : (
            deductions.map(d => (
              <div key={d.label} className="flex items-center gap-3 py-0.5">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{d.label}</span>
                    <span className="text-[11px] font-bold" style={{ color: d.color }}>−{d.penalty}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/6 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.round((d.penalty / 100) * 100)}%`,
                        background: d.color,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Divider + final score */}
          <div className="border-t border-white/6 pt-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white/50">Security Score</span>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-20 rounded-full bg-white/6 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${score}%`,
                    background: scoreColor,
                  }}
                />
              </div>
              <span className="text-sm font-black" style={{ color: scoreColor }}>{score}/100</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Onboarding note ───────────────────────────────────────────────────────

function OnboardingNote() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      className="rounded-xl border border-violet-500/15 px-4 py-3 flex items-start gap-3"
      style={{ background: 'rgba(139,92,246,0.04)' }}
    >
      <svg width="14" height="14" className="shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
      </svg>
      <div className="flex-1 space-y-1">
        <p className="text-[11px] font-semibold text-white/55">How to read these results</p>
        <ul className="space-y-0.5">
          {[
            ['AI Signal Score', '0 means few public AI-generation signals; 100 means strong public evidence. It does not prove authorship.'],
            ['Security Score', '0–100 based on HTTP headers and exposed files. 80+ = well-configured.'],
            ['Key Risks', 'Issues visible without authentication. Expand each to see fix instructions and code examples.'],
            ['Next step', 'Sign up and verify ownership to run a full active vulnerability scan.'],
          ].map(([term, desc]) => (
            <li key={term} className="text-[11px] text-white/40">
              <span className="text-white/60 font-medium">{term}:</span> {desc}
            </li>
          ))}
        </ul>
      </div>
      <button onClick={() => setDismissed(true)} className="text-white/20 hover:text-white/50 transition-colors shrink-0 text-lg leading-none">×</button>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────

interface Props {
  result: AnalysisResult & { scanId?: string; roasts?: string[]; scansRemaining?: number | null };
  onReset: () => void;
  defaultRoastMode?: boolean;
}

// ── Publish modal ─────────────────────────────────────────────────────────

function PublishModal({ scanId, onClose, onPublished }: { scanId: string; onClose: () => void; onPublished: () => void }) {
  const [comment, setComment] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  async function handlePublish() {
    setError('');
    setPublishing(true);
    try {
      const res = await fetch(`/api/scans/${scanId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: true }),
      });
      if (!res.ok) { setError('Failed to publish'); return; }

      if (comment.trim()) {
        await fetch('/api/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scanId, body: comment.trim() }),
        });
      }

      onPublished();
      onClose();
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 p-6" style={{ background: '#0f0f18' }}>
        <h2 className="text-base font-bold text-white/85 mb-1">Publish to Leaderboard</h2>
        <p className="text-xs text-white/40 mb-5">
          This scan will be visible to everyone on the public leaderboard. Add an optional note before posting.
        </p>

        <div className="mb-4">
          <label className="block text-xs font-medium text-white/40 mb-1.5">Caption (optional)</label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Add context about this site…"
            rows={3}
            maxLength={500}
            className="w-full px-3 py-2.5 rounded-xl text-sm text-white/75 placeholder-white/20 outline-none resize-none transition-all"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
            onFocus={e => (e.currentTarget.style.borderColor = 'rgba(139,92,246,0.35)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)')}
            autoFocus
          />
          <p className="text-[10px] text-white/20 mt-1 text-right">{comment.length}/500</p>
        </div>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all"
            style={{ background: 'rgba(139,92,246,0.85)', border: '1px solid rgba(139,92,246,0.5)' }}
          >
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-sm border border-white/10 text-white/40 hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Risk level helper ─────────────────────────────────────────────────────

function getRiskLevel(findings: PassiveFinding[]): { label: string; color: string; bg: string; border: string } {
  if (findings.some(f => f.severity === 'critical')) return { label: 'Critical Risk', color: '#f87171', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)' };
  if (findings.some(f => f.severity === 'high'))     return { label: 'High Risk',     color: '#fb923c', bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.3)' };
  if (findings.some(f => f.severity === 'medium'))   return { label: 'Medium Risk',   color: '#fbbf24', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)' };
  if (findings.some(f => f.severity === 'low'))      return { label: 'Low Risk',      color: '#6ee7b7', bg: 'rgba(110,231,183,0.08)', border: 'rgba(110,231,183,0.2)' };
  return { label: 'Looks Clean', color: '#4ade80', bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.2)' };
}

// ── Main component ────────────────────────────────────────────────────────

export function ResultsDashboard({ result, onReset, defaultRoastMode = false }: Props) {
  const { user } = useAuth();
  const [roastMode, setRoastMode] = useState(defaultRoastMode);
  const [shareOpen, setShareOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [published, setPublished] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [allRisksOpen, setAllRisksOpen] = useState(false);
  const [allVibeOpen, setAllVibeOpen] = useState(false);

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

  const riskLevel = getRiskLevel(passiveFindings);
  const topVibeReasons = result.vibe.reasons.slice(0, 3);
  const moreVibeReasons = result.vibe.reasons.slice(3);

  const keyRiskFindings = passiveFindings.filter(f => f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium');
  const lowerFindings   = passiveFindings.filter(f => f.severity === 'low' || f.severity === 'info');

  const likelyTool    = detectLikelyTool(result);
  const likelyToolDef = TOOLS.find(t => t.id === likelyTool)!;

  return (
    <div className="w-full max-w-2xl mx-auto space-y-3">
      {shareOpen && result.scanId && (
        <ShareModal result={result} onClose={() => setShareOpen(false)} />
      )}
      {publishOpen && result.scanId && (
        <PublishModal
          scanId={result.scanId}
          onClose={() => setPublishOpen(false)}
          onPublished={() => setPublished(true)}
        />
      )}

      {/* Onboarding note */}
      <OnboardingNote />

      {/* Scan limit warning */}
      {result.scansRemaining !== undefined && result.scansRemaining !== null && result.scansRemaining <= 1 && (
        <div className="p-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 flex items-center justify-between gap-3">
          <p className="text-xs text-yellow-400">
            {result.scansRemaining === 0 ? "You've used all free scans today." : '1 free scan remaining today.'}
          </p>
          <a href="/pricing" className="text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors shrink-0">View Plans →</a>
        </div>
      )}

      {/* ══ SECTION 1: SUMMARY ══════════════════════════════════════════════ */}
      <div className="rounded-2xl border overflow-hidden" style={{ background: vibeGrad, borderColor: vibeBorder }}>

        <div className="flex items-center gap-4 px-5 pt-5 pb-4">
          <ScoreRing
            score={result.vibe.score}
            color={vibeColor}
            label={result.vibe.label}
            sublabel={`${result.vibe.confidence} confidence`}
            caption="AI signals"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              <span className="font-mono text-xs text-white/50 bg-black/20 px-2 py-0.5 rounded border border-white/10 truncate max-w-[200px]">{displayUrl}</span>
            </div>
            <h2 className="text-xl font-black leading-tight mb-2.5" style={{ color: vibeColor }}>{result.vibe.label}</h2>
            <p className="text-xs text-white/40 leading-relaxed mb-3 max-w-md">
              {result.vibe.score}/100 is an AI-signal score: higher means more public evidence of AI-assisted scaffolding, not a definitive authorship claim.
            </p>
            <div className="flex gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border" style={{ color: riskLevel.color, background: riskLevel.bg, borderColor: riskLevel.border }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: riskLevel.color }} />
                {riskLevel.label}
              </span>
              {totalIssues > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border border-red-500/25 bg-red-500/8 text-red-400">
                  {totalIssues} issue{totalIssues > 1 ? 's' : ''} found
                </span>
              )}
              {result.vibe.score >= 50 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border" style={{ color: likelyToolDef.accent, background: likelyToolDef.bg, borderColor: likelyToolDef.border }}>
                  Likely {likelyToolDef.name}
                </span>
              )}
            </div>
          </div>
          {/* Action buttons */}
          <div className="flex flex-col gap-1.5 shrink-0 self-start" data-print-hide>
            <button
              onClick={() => setRoastMode(r => !r)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${roastMode ? 'bg-orange-500/15 border-orange-500/30 text-orange-400' : 'border-white/10 text-white/40 hover:bg-white/5'}`}
            >
              {roastMode ? '🔥 On' : '🔥 Roast'}
            </button>
            {result.scanId && (
              <button onClick={() => setShareOpen(true)} className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/15 transition-colors">
                Share
              </button>
            )}
            {result.scanId && user && (
              <button
                onClick={() => setPublishOpen(true)}
                disabled={published}
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-60"
                style={published
                  ? { borderColor: 'rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.08)', color: '#4ade80' }
                  : { borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.45)' }
                }
              >
                {published ? '✓ Live' : 'Publish'}
              </button>
            )}
            <button onClick={onReset} className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-white/10 text-white/40 hover:bg-white/5 transition-colors">
              New Scan
            </button>
          </div>
        </div>

        {/* Roast banner */}
        {roastMode && roasts.length > 0 && (
          <div className="mx-5 mb-4 p-3 rounded-xl border border-orange-500/20 bg-orange-500/5 space-y-1.5">
            <p className="text-[10px] font-bold text-orange-400 uppercase tracking-wider">🔥 AI Roast</p>
            {roasts.map((r, i) => (
              <div key={i} className="flex gap-2 text-xs text-orange-200/75">
                <span className="text-orange-400 shrink-0">›</span><span>{r}</span>
              </div>
            ))}
          </div>
        )}

        {/* Vibe signals */}
        {result.vibe.reasons.length > 0 && (
          <div className="border-t px-5 py-4 space-y-2" style={{ borderColor: vibeBorder }}>
            <p className="text-[10px] font-semibold text-white/35 uppercase tracking-wider mb-2">Public AI signals found</p>
            {topVibeReasons.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-white/65">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: vibeColor }} />
                {r}
              </div>
            ))}
            {moreVibeReasons.length > 0 && (
              <>
                {allVibeOpen && moreVibeReasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-white/45">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-white/20 shrink-0" />
                    {r}
                  </div>
                ))}
                <button
                  onClick={() => setAllVibeOpen(o => !o)}
                  className="text-xs text-white/30 hover:text-white/50 transition-colors mt-1"
                >
                  {allVibeOpen ? '↑ Show less' : `+ ${moreVibeReasons.length} more signals`}
                </button>
              </>
            )}
          </div>
        )}
        {result.vibe.reasons.length === 0 && (
          <div className="border-t px-5 py-4" style={{ borderColor: vibeBorder }}>
            <p className="text-sm text-white/40 italic">No vibe-coding signals detected.</p>
          </div>
        )}
      </div>

      {/* ══ SECTION 2: KEY RISKS ════════════════════════════════════════════ */}
      <div className="rounded-2xl border border-white/7 overflow-hidden" style={{ background: 'rgba(255,255,255,0.01)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/6">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.22)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-white/80">Key Risks</p>
              <p className="text-[10px] text-white/35">From publicly visible data — no exploitation</p>
            </div>
          </div>
          <div className="flex gap-2">
            {critCount > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10 border border-red-500/20">{critCount} critical</span>}
            {highCount > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-orange-400 bg-orange-500/10 border border-orange-500/20">{highCount} high</span>}
            {medCount > 0  && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-yellow-400 bg-yellow-500/10 border border-yellow-500/20">{medCount} med</span>}
            {totalIssues === 0 && <span className="text-[10px] font-medium text-emerald-400">✓ Clean</span>}
          </div>
        </div>

        <div className="p-4 space-y-2">
          {keyRiskFindings.length === 0 && lowerFindings.length === 0 && (
            <p className="text-sm text-emerald-400 px-1 py-2">No security issues found in publicly visible data.</p>
          )}

          {keyRiskFindings.map(f => <PassiveFindingRow key={f.id} f={f} site={result.url} />)}

          {lowerFindings.length > 0 && (
            <>
              {allRisksOpen && lowerFindings.map(f => <PassiveFindingRow key={f.id} f={f} site={result.url} />)}
              <button
                onClick={() => setAllRisksOpen(o => !o)}
                className="w-full text-center text-xs text-white/30 hover:text-white/50 transition-colors py-2"
              >
                {allRisksOpen ? '↑ Hide minor findings' : `+ ${lowerFindings.length} minor finding${lowerFindings.length > 1 ? 's' : ''}`}
              </button>
            </>
          )}

          {/* Score breakdown */}
          <ScoreBreakdown result={result} />

          {/* Deep scan CTA */}
          <div className="mt-2 rounded-xl border p-3.5 flex items-center justify-between gap-3" style={{ background: 'rgba(239,68,68,0.04)', borderColor: 'rgba(239,68,68,0.12)' }}>
            <div>
              <p className="text-xs font-bold text-white/70">Want active testing?</p>
              <p className="text-[11px] text-white/35 mt-0.5">Deep Scan runs OWASP Top 10 tests on sites you own.</p>
            </div>
            <a
              href={user ? '/dashboard' : '/signup'}
              className="px-4 py-2 rounded-lg text-xs font-bold text-white shrink-0 transition-all"
              style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}
            >
              {user ? 'Deep Scan →' : 'Sign up →'}
            </a>
          </div>
        </div>
      </div>

      {/* ══ SECTION 3: TECHNICAL BREAKDOWN ══════════════════════════════════ */}
      <div className="rounded-2xl border border-white/7 overflow-hidden" style={{ background: 'rgba(255,255,255,0.01)' }}>
        <button
          onClick={() => setTechOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/2 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.22)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-white/80">Technical Breakdown</p>
              <p className="text-[10px] text-white/35">Tech stack, all signals, remediation prompt</p>
            </div>
          </div>
          <svg
            className="w-4 h-4 text-white/25 transition-transform"
            style={{ transform: techOpen ? 'rotate(180deg)' : '' }}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {techOpen && (
          <div className="border-t border-white/6 px-5 pb-5 pt-4 space-y-5">
            {(result.techStack.length > 0 || result.hosting.provider) && (
              <div>
                <p className="text-[10px] font-semibold text-white/35 uppercase tracking-wider mb-2.5">Tech Stack Detected</p>
                <div className="flex flex-wrap gap-2">
                  {result.techStack.map(t => (
                    <span
                      key={t.name}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
                      style={{ color: CATEGORY_COLORS[t.category], background: `${CATEGORY_COLORS[t.category]}18`, borderColor: `${CATEGORY_COLORS[t.category]}33` }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: CATEGORY_COLORS[t.category] }} />
                      {t.name}
                      <span className="opacity-40 text-[10px]">{CATEGORY_LABELS[t.category]}</span>
                    </span>
                  ))}
                  {result.hosting.provider && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      {result.hosting.provider}
                      <span className="opacity-40 text-[10px]">Hosting</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            {result.security.headers.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-white/35 uppercase tracking-wider mb-2.5">Security Headers</p>
                <div className="rounded-xl border border-white/6 overflow-hidden">
                  {result.security.headers.map((h, i) => (
                    <div
                      key={h.name}
                      className="flex items-center gap-3 px-4 py-2.5 text-xs"
                      style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${h.present ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      <span className="font-mono text-white/55 flex-1">{h.name}</span>
                      {!h.present && HEADER_PENALTIES[h.name] && (
                        <span className="text-[10px] font-bold text-red-400/60">−{HEADER_PENALTIES[h.name]}</span>
                      )}
                      <span className={h.present ? 'text-emerald-400' : 'text-red-400/70'}>{h.present ? 'Present' : 'Missing'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <PromptSection result={result} />
          </div>
        )}
      </div>
    </div>
  );
}
