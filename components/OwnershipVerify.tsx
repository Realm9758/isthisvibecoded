'use client';

import { useState } from 'react';
import type { VerificationToken } from '@/types/analysis';

type Method = 'dns' | 'meta' | 'file';

interface Props {
  domain: string;
  onVerified?: () => void;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="text-[10px] font-medium px-2 py-0.5 rounded border transition-colors shrink-0"
      style={{ color: copied ? '#4ade80' : 'rgba(255,255,255,0.4)', borderColor: copied ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)' }}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function Step({ n, text }: { n: number; text: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-5 h-5 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-[10px] font-bold text-violet-400 shrink-0 mt-0.5">
        {n}
      </div>
      <div className="text-xs text-white/55 leading-relaxed">{text}</div>
    </div>
  );
}

function CodeBlock({ text, label }: { text: string; label?: string }) {
  return (
    <div>
      {label && <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">{label}</p>}
      <div className="flex items-start gap-2">
        <pre className="flex-1 text-xs font-mono bg-black/50 border border-white/10 rounded-lg p-3 text-emerald-300 overflow-x-auto whitespace-pre-wrap break-all">
          {text}
        </pre>
        <CopyButton text={text} />
      </div>
    </div>
  );
}

function DNSInstructions({ domain, token }: { domain: string; token: string }) {
  const recordName  = `_vibecoded-verification.${domain}`;
  const recordValue = `vibecoded-verification=${token}`;

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-amber-500/8 border border-amber-500/20 text-xs text-amber-300/80">
        <strong>Best for custom domains.</strong> Does not work on *.vercel.app, *.netlify.app, or other platform subdomains — use Meta Tag instead.
      </div>

      <div className="space-y-3">
        <Step n={1} text={<>Go to your domain registrar's DNS settings. Common providers: <span className="text-white/70">Cloudflare</span> (DNS tab), <span className="text-white/70">Namecheap</span> (Advanced DNS), <span className="text-white/70">GoDaddy</span> (DNS Management), <span className="text-white/70">Vercel</span> (Project → Domains → your domain).</>} />

        <Step n={2} text={<>Add a new <span className="font-mono text-white/70 bg-white/5 px-1 rounded">TXT</span> record with these exact values:</>} />

        <div className="ml-8 space-y-2">
          <CodeBlock label="Name / Host" text={recordName} />
          <CodeBlock label="Value / Content" text={recordValue} />
          <p className="text-[10px] text-white/25">TTL: any value (300 or Auto is fine)</p>
        </div>

        <Step n={3} text="Save the record. DNS changes can take 1–15 minutes to propagate (sometimes up to 48h). Usually instant on Cloudflare." />

        <Step n={4} text={<>Click <span className="text-white/70 font-medium">Check Verification</span> below once added. If it fails, wait a few minutes and try again.</>} />
      </div>

      <div className="p-3 rounded-lg bg-white/3 border border-white/8 text-xs text-white/35 space-y-1">
        <p className="font-medium text-white/45">Example (Cloudflare):</p>
        <p>Type: TXT &nbsp;·&nbsp; Name: <span className="font-mono text-white/55">_vibecoded-verification</span> &nbsp;·&nbsp; Content: <span className="font-mono text-white/55">{recordValue.slice(0, 30)}…</span></p>
      </div>
    </div>
  );
}

function MetaInstructions({ domain, token }: { domain: string; token: string }) {
  const tag = `<meta name="vibecoded-verification" content="${token}" />`;
  const nextConfig = `// next.config.js\nmodule.exports = {\n  async headers() {\n    return [{ source: '/', headers: [\n      { key: 'x-vibe-verify', value: '${token}' }\n    ]}]\n  }\n}`;

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-emerald-500/8 border border-emerald-500/20 text-xs text-emerald-300/80">
        <strong>Works on all platforms</strong> including Vercel, Netlify, Cloudflare Pages, and custom servers.
      </div>

      <div className="space-y-3">
        <Step n={1} text={<>Copy the meta tag below:</>} />

        <div className="ml-8">
          <CodeBlock text={tag} />
        </div>

        <Step n={2} text={<>Add it inside the <span className="font-mono text-white/70 bg-white/5 px-1 rounded">&lt;head&gt;</span> of your site. Where exactly depends on your framework:</>} />

        <div className="ml-8 space-y-3">
          <div className="p-3 rounded-lg border border-white/8 bg-white/2 space-y-2">
            <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Next.js (App Router)</p>
            <p className="text-xs text-white/45">In <span className="font-mono text-white/65">app/layout.tsx</span>, add to the <span className="font-mono text-white/65">metadata</span> export:</p>
            <CodeBlock text={`export const metadata = {\n  // ...existing fields\n  other: {\n    'vibecoded-verification': '${token}',\n  },\n};`} />
          </div>

          <div className="p-3 rounded-lg border border-white/8 bg-white/2 space-y-2">
            <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Next.js (Pages Router) / Plain HTML</p>
            <p className="text-xs text-white/45">Paste directly inside your <span className="font-mono text-white/65">&lt;Head&gt;</span> component or HTML <span className="font-mono text-white/65">&lt;head&gt;</span>:</p>
            <CodeBlock text={tag} />
          </div>

          <div className="p-3 rounded-lg border border-white/8 bg-white/2 space-y-2">
            <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider">WordPress</p>
            <p className="text-xs text-white/45">Go to <span className="font-mono text-white/65">Appearance → Theme Editor → header.php</span> and paste before <span className="font-mono text-white/65">&lt;/head&gt;</span>. Or use a plugin like <em>Header and Footer Scripts</em>.</p>
          </div>

          <div className="p-3 rounded-lg border border-white/8 bg-white/2 space-y-2">
            <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Webflow / Squarespace / Framer</p>
            <p className="text-xs text-white/45">Go to site settings → Custom Code → Head section → paste the meta tag.</p>
          </div>
        </div>

        <Step n={3} text="Deploy your changes so the tag is live on the public URL." />
        <Step n={4} text={<>Click <span className="text-white/70 font-medium">Check Verification</span> below.</>} />
      </div>
    </div>
  );
}

function FileInstructions({ domain, token }: { domain: string; token: string }) {
  const filePath = `/.well-known/vibecoded.txt`;
  const fullUrl  = `https://${domain}${filePath}`;

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-sky-500/8 border border-sky-500/20 text-xs text-sky-300/80">
        <strong>Works on all platforms.</strong> Best if you can't edit your HTML directly but can upload static files.
      </div>

      <div className="space-y-3">
        <Step n={1} text={<>Create a plain text file with <em>only</em> the token as its content (no spaces, no newline):</>} />

        <div className="ml-8 space-y-2">
          <CodeBlock label="File contents (exact)" text={token} />
        </div>

        <Step n={2} text={<>Upload it so it's accessible at this exact URL:</>} />

        <div className="ml-8">
          <CodeBlock label="Required URL" text={fullUrl} />
        </div>

        <Step n={3} text={<>How to upload depends on your platform:</>} />

        <div className="ml-8 space-y-3">
          <div className="p-3 rounded-lg border border-white/8 bg-white/2 space-y-1">
            <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Next.js / Vite / React</p>
            <p className="text-xs text-white/45">Create the file at <span className="font-mono text-white/65">public/.well-known/vibecoded.txt</span> — Next.js/Vite serve the <span className="font-mono text-white/65">public/</span> folder at the root.</p>
          </div>

          <div className="p-3 rounded-lg border border-white/8 bg-white/2 space-y-1">
            <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Vercel</p>
            <p className="text-xs text-white/45">Add <span className="font-mono text-white/65">public/.well-known/vibecoded.txt</span> to your repo, commit, and push. Vercel will serve it automatically.</p>
          </div>

          <div className="p-3 rounded-lg border border-white/8 bg-white/2 space-y-1">
            <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Apache / Nginx</p>
            <p className="text-xs text-white/45">Upload to <span className="font-mono text-white/65">/var/www/html/.well-known/vibecoded.txt</span> (or your webroot). You may need to create the <span className="font-mono text-white/65">.well-known</span> directory first.</p>
          </div>

          <div className="p-3 rounded-lg border border-white/8 bg-white/2 space-y-1">
            <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider">cPanel / FTP</p>
            <p className="text-xs text-white/45">Use File Manager or FTP to upload to <span className="font-mono text-white/65">public_html/.well-known/vibecoded.txt</span>.</p>
          </div>
        </div>

        <Step n={4} text={<>Visit <a href={fullUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline">{fullUrl}</a> in your browser to confirm the token is showing, then click <span className="text-white/70 font-medium">Check Verification</span>.</>} />
      </div>
    </div>
  );
}

export function OwnershipVerify({ domain, onVerified }: Props) {
  const [token, setToken] = useState<VerificationToken | null>(null);
  const [method, setMethod] = useState<Method>('meta');
  const [status, setStatus] = useState<'idle' | 'generating' | 'checking' | 'verified' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setStatus('generating');
    setError(null);
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setToken(data);
      setStatus('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate token');
      setStatus('idle');
    }
  }

  async function verify() {
    if (!token) return;
    setStatus('checking');
    setError(null);
    try {
      const params = new URLSearchParams({ domain, token: token.token, method });
      const res = await fetch(`/api/verify?${params}`);
      const data = await res.json();
      if (data.verified) {
        setStatus('verified');
        onVerified?.();
      } else {
        setStatus('failed');
        setError(data.error ?? 'Verification record not found yet. Try again after adding it.');
      }
    } catch (e) {
      setStatus('failed');
      setError(e instanceof Error ? e.message : 'Check failed');
    }
  }

  async function reset() {
    await fetch('/api/verify', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain }),
    });
    setToken(null);
    setStatus('idle');
    setError(null);
  }

  const METHODS: { id: Method; label: string; icon: string; best: string }[] = [
    { id: 'meta',  label: 'Meta Tag',    icon: '</>', best: 'Easiest — works everywhere' },
    { id: 'file',  label: 'File Upload', icon: '📄',  best: 'No code required' },
    { id: 'dns',   label: 'DNS Record',  icon: '🌐',  best: 'Custom domains only' },
  ];

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-violet-500/15 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-violet-400" />
        <h3 className="text-sm font-semibold text-violet-300">Verify Ownership of {domain}</h3>
      </div>

      <div className="p-5">
        {status === 'verified' ? (
          <div className="flex items-center gap-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-xl shrink-0">✓</div>
            <div>
              <p className="font-bold text-emerald-300">Domain Verified!</p>
              <p className="text-xs text-white/50 mt-0.5">You have confirmed ownership of <span className="font-mono">{domain}</span>.</p>
            </div>
          </div>

        ) : !token ? (
          <div className="space-y-4">
            <p className="text-sm text-white/50 leading-relaxed">
              To run active security tests, you must prove you own <span className="font-mono text-white/70">{domain}</span>. This uses the same method as Google Search Console — only the real site owner can complete it.
            </p>
            <button
              onClick={generate}
              disabled={status === 'generating'}
              className="px-5 py-2.5 text-sm font-semibold rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
            >
              {status === 'generating' ? 'Generating token…' : 'Generate Verification Token'}
            </button>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>

        ) : (
          <div className="space-y-5">
            {/* Method tabs */}
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map(m => (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className="rounded-xl border p-3 text-left transition-all"
                  style={{
                    background: method === m.id ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.02)',
                    borderColor: method === m.id ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.08)',
                  }}
                >
                  <div className="text-base mb-1">{m.icon}</div>
                  <p className="text-xs font-bold text-white/80">{m.label}</p>
                  <p className="text-[10px] text-white/35 mt-0.5">{m.best}</p>
                </button>
              ))}
            </div>

            {/* Instructions */}
            <div className="rounded-xl border border-white/8 bg-black/20 p-4">
              {method === 'dns'  && <DNSInstructions  domain={domain} token={token.token} />}
              {method === 'meta' && <MetaInstructions domain={domain} token={token.token} />}
              {method === 'file' && <FileInstructions domain={domain} token={token.token} />}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={verify}
                disabled={status === 'checking'}
                className="px-5 py-2.5 text-sm font-bold rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {status === 'checking' && (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                )}
                {status === 'checking' ? 'Checking…' : 'Check Verification'}
              </button>
              <button onClick={reset} className="text-xs text-white/30 hover:text-white/60 transition-colors">
                Reset token
              </button>
            </div>

            {status === 'failed' && error && (
              <div className="p-3 rounded-lg bg-orange-500/8 border border-orange-500/20">
                <p className="text-xs text-orange-400">{error}</p>
                <p className="text-xs text-white/30 mt-1">Make sure your changes are deployed and publicly accessible, then try again.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
