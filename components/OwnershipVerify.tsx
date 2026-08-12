'use client';

import { useEffect, useState } from 'react';
import type { VerificationToken } from '@/types/analysis';
import { apiPath } from '@/lib/site';
import { MUTATION_GUARD_HEADER, MUTATION_GUARD_VALUE } from '@/lib/request-security-constants';

type Method = 'dns' | 'meta' | 'file';

type VerificationResponse = VerificationToken & {
  alreadyVerified?: boolean;
  verificationExpired?: boolean;
  verifiedAt?: number;
  expiresAt?: number;
  verificationMethod?: string;
  claimContest?: boolean;
};

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
      <div className="w-5 h-5 rounded-full bg-[color:var(--accent)]/20 border border-transparent flex items-center justify-center text-[10px] font-bold text-[color:var(--accent)] shrink-0 mt-0.5">
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
  const recordName  = '_vibecoded-verification';
  const recordValue = `vibecoded-verification=${token}`;

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-amber-500/8 border border-amber-500/20 text-xs text-amber-300/80">
        <strong>Usually 1 to 15 minutes.</strong> This is non-disruptive and works for custom domains. Platform subdomains should use a hosting connection or Meta Tag.
      </div>

      <div className="space-y-3">
        <Step n={1} text={<>Open the DNS provider named by your nameservers. This may be different from the company where you bought the domain.</>} />

        <Step n={2} text={<>Add a new <span className="font-mono text-white/70 bg-white/5 px-1 rounded">TXT</span> record with these exact values:</>} />

        <div className="ml-8 space-y-2">
          <CodeBlock label="Name / Host" text={recordName} />
          <CodeBlock label="Value / Content" text={recordValue} />
          <p className="text-[10px] text-white/25">TTL: any value (300 or Auto is fine)</p>
          <p className="text-[10px] text-white/35">If your provider explicitly asks for a full hostname, use <span className="font-mono">_vibecoded-verification.{domain}</span>.</p>
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

function MetaInstructions({ token }: { token: string }) {
  const tag = `<meta name="vibecoded-verification" content="${token}" />`;

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-emerald-500/8 border border-emerald-500/20 text-xs text-emerald-300/80">
        <strong>Usually 2 to 5 minutes.</strong> Best for Lovable, v0, Bolt and other builders where you can publish a head tag.
      </div>

      <div className="space-y-3">
        <Step n={1} text={<>Copy the meta tag below:</>} />

        <div className="ml-8">
          <CodeBlock text={tag} />
        </div>

        <Step n={2} text={<>Add it inside the <span className="font-mono text-white/70 bg-white/5 px-1 rounded">&lt;head&gt;</span> of your site. Where exactly depends on your framework:</>} />

        <div className="ml-8 space-y-3">
          <div className="p-3 rounded-lg border border-white/8 bg-white/2 space-y-2">
            <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Lovable / Bolt</p>
            <p className="text-xs text-white/45">Paste this into the builder chat:</p>
            <CodeBlock text={`Add this exact meta tag to the server-rendered document <head>, then publish the production site. Do not render it in the page body or only after JavaScript loads:\n${tag}`} />
          </div>
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
        <strong>Usually 2 to 5 minutes and requires a publish.</strong> Use this when you can add a static public file.
      </div>

      <div className="space-y-3">
        <Step n={1} text={<>Create a plain text file with <em>only</em> the token as its content (no spaces, no newline):</>} />

        <div className="ml-8 space-y-2">
          <CodeBlock label="File contents (exact)" text={token} />
        </div>

        <Step n={2} text={<>Upload it so it&apos;s accessible at this exact URL:</>} />

        <div className="ml-8">
          <CodeBlock label="Required URL" text={fullUrl} />
        </div>

        <Step n={3} text={<>How to upload depends on your platform:</>} />

        <div className="ml-8 space-y-3">
          <div className="p-3 rounded-lg border border-white/8 bg-white/2 space-y-1">
            <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Next.js / Vite / React</p>
            <p className="text-xs text-white/45">Create the file at <span className="font-mono text-white/65">public/.well-known/vibecoded.txt</span>. Next.js and Vite serve the <span className="font-mono text-white/65">public/</span> folder at the root.</p>
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
  const [token, setToken] = useState<VerificationResponse | null>(null);
  const [method, setMethod] = useState<Method>('meta');
  const [status, setStatus] = useState<'idle' | 'generating' | 'checking' | 'verified' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const [claimContest, setClaimContest] = useState(false);

  useEffect(() => {
    void generate();
    // The domain is the identity of this verification panel. A new domain
    // should load or create its saved proof without an extra click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  async function generate() {
    setStatus('generating');
    setError(null);
    setClaimContest(false);
    try {
      const res = await fetch(apiPath('/api/verify'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [MUTATION_GUARD_HEADER]: MUTATION_GUARD_VALUE,
        },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate token');
      const verification = data as VerificationResponse;
      setToken(verification);
      if (verification.verificationMethod && ['dns', 'meta', 'file'].includes(verification.verificationMethod)) {
        setMethod(verification.verificationMethod as Method);
      }
      if (verification.alreadyVerified) {
        setStatus('verified');
        return;
      }
      setClaimContest(!!verification.claimContest);
      setStatus('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate token');
      setStatus('idle');
    }
  }

  async function connectProvider(provider: 'vercel' | 'netlify') {
    setError(null);
    try {
      const res = await fetch(apiPath('/api/verify/oauth/start'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [MUTATION_GUARD_HEADER]: MUTATION_GUARD_VALUE,
        },
        body: JSON.stringify({ provider, domain }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.authorizationUrl !== 'string') {
        throw new Error(data.error ?? `Could not connect ${provider}`);
      }
      window.location.assign(data.authorizationUrl);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : `Could not connect ${provider}`);
    }
  }

  async function verify() {
    if (!token) return;
    setStatus('checking');
    setError(null);
    try {
      const res = await fetch(apiPath('/api/verify'), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          [MUTATION_GUARD_HEADER]: MUTATION_GUARD_VALUE,
        },
        body: JSON.stringify({ domain, token: token.token, method }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Verification check failed');
      if (data.verified) {
        setToken(current => current ? {
          ...current,
          alreadyVerified: true,
          verificationExpired: false,
          verifiedAt: data.verifiedAt,
          expiresAt: data.expiresAt,
          verificationMethod: data.method,
        } : current);
        setStatus('verified');
      } else {
        setStatus('failed');
        setError(data.error ?? 'Verification record not found yet. Try again after adding it.');
      }
    } catch (e) {
      setStatus('failed');
      setError(e instanceof Error ? e.message : 'Check failed');
    }
  }

  async function removeVerification(requireConfirmation: boolean, disconnectProvider = false) {
    const providerName = token?.verificationMethod?.replace('-oauth', '');
    const prompt = disconnectProvider && providerName
      ? `Disconnect ${providerName} and revoke all domain proofs that use that connection?`
      : `Revoke verification for ${domain}? A new proof will be required before another deep scan.`;
    if (requireConfirmation && !window.confirm(prompt)) {
      return;
    }

    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(apiPath('/api/verify'), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          [MUTATION_GUARD_HEADER]: MUTATION_GUARD_VALUE,
        },
        body: JSON.stringify({ domain, disconnectProvider }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not remove verification');
      setClaimContest(false);
      await generate();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove verification');
    } finally {
      setRemoving(false);
    }
  }

  const METHODS: { id: Method; label: string; icon: string; best: string }[] = [
    { id: 'meta',  label: 'Meta Tag',    icon: '</>', best: '2 to 5 min, builder-friendly' },
    { id: 'file',  label: 'Static File', icon: './',  best: '2 to 5 min, publish needed' },
    { id: 'dns',   label: 'DNS TXT',     icon: 'TXT', best: '1 to 15 min, custom domains' },
  ];
  const connectedProvider = token?.verificationMethod === 'vercel-oauth'
    ? 'Vercel'
    : token?.verificationMethod === 'netlify-oauth'
      ? 'Netlify'
      : null;

  return (
    <div className="border overflow-hidden" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)', borderRadius: 6 }}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-transparent flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-transparent" />
        <h3 className="text-sm font-semibold text-[color:var(--accent)]">Verify domain control for {domain}</h3>
      </div>

      <div className="p-5">
        {status === 'verified' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-xl shrink-0">✓</div>
              <div>
                <p className="font-bold text-emerald-300">Domain control verified</p>
                <p className="text-xs text-white/50 mt-0.5">
                  A current control proof exists for <span className="font-mono">{domain}</span>. Keep the connection, tag, file, or TXT record in place because it is checked again before each active scan.
                </p>
              </div>
            </div>
            {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => onVerified?.()}
                className="px-5 py-2.5 text-sm font-bold rounded-xl bg-[color:var(--accent)] hover:bg-[color:var(--accent)] text-white transition-colors"
              >
                Continue to authorisation
              </button>
              <button
                onClick={() => removeVerification(true)}
                disabled={removing}
                className="text-xs text-red-300/60 hover:text-red-300 transition-colors disabled:opacity-50"
              >
                {removing ? 'Revoking…' : 'Revoke verification'}
              </button>
              {connectedProvider && (
                <button
                  onClick={() => removeVerification(true, true)}
                  disabled={removing}
                  className="text-xs transition-colors disabled:opacity-50"
                  style={{ color: 'var(--faint)' }}
                >
                  Disconnect {connectedProvider}
                </button>
              )}
            </div>
          </div>

        ) : !token ? (
          <div className="space-y-4">
            <p className="text-sm text-white/50 leading-relaxed">
              To run active security tests, connect the hosting project for{' '}
              <span className="font-mono text-white/70">{domain}</span>, or publish a unique fallback token through DNS or the site.
              This proves current technical control, not legal ownership or authorisation to test it.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <button onClick={() => connectProvider('vercel')} className="border px-4 py-3 text-left hover:bg-white/4" style={{ borderColor: 'var(--border-2)', borderRadius: 4 }}>
                <span className="block text-sm font-semibold text-white">Connect Vercel</span>
                <span className="block text-xs mt-1" style={{ color: 'var(--faint)' }}>About 30 seconds, read-only project domains</span>
              </button>
              <button onClick={() => connectProvider('netlify')} className="border px-4 py-3 text-left hover:bg-white/4" style={{ borderColor: 'var(--border-2)', borderRadius: 4 }}>
                <span className="block text-sm font-semibold text-white">Connect Netlify</span>
                <span className="block text-xs mt-1" style={{ color: 'var(--faint)' }}>About 30 seconds, read-only site domains</span>
              </button>
            </div>
            <p className="text-xs" style={{ color: 'var(--ghost)' }}>
              {status === 'generating' ? 'Preparing manual fallback methods...' : 'Manual proof could not be prepared automatically.'}
            </p>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>

        ) : (
          <div className="space-y-5">
            <div>
              <p className="label mb-3">Fastest: connect your host</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <button onClick={() => connectProvider('vercel')} className="border px-4 py-3 text-left hover:bg-white/4" style={{ borderColor: 'var(--border-2)', borderRadius: 4 }}>
                  <span className="block text-sm font-semibold text-white">Connect Vercel</span>
                  <span className="block text-xs mt-1" style={{ color: 'var(--faint)' }}>Read-only domain access</span>
                </button>
                <button onClick={() => connectProvider('netlify')} className="border px-4 py-3 text-left hover:bg-white/4" style={{ borderColor: 'var(--border-2)', borderRadius: 4 }}>
                  <span className="block text-sm font-semibold text-white">Connect Netlify</span>
                  <span className="block text-xs mt-1" style={{ color: 'var(--faint)' }}>Read-only site access</span>
                </button>
              </div>
            </div>
            <p className="label">Or publish a manual proof</p>
            {token.verificationExpired && (
              <div className="p-3 rounded-xl border border-amber-500/25 bg-amber-500/8 text-xs text-amber-300/85 leading-relaxed">
                The previous control proof has expired. Place the token again and renew verification before scanning.
              </div>
            )}
            {/* Claim contest warning */}
            {claimContest && (
              <div className="p-3 rounded-xl border border-yellow-500/30 bg-yellow-500/8 text-xs text-yellow-300/90 leading-relaxed">
                <p className="font-bold mb-0.5">Another account has a current control verification for this domain.</p>
                Publish this token on the live site and click <span className="font-medium">Check Verification</span>. A successful check replaces the existing account&apos;s verification.
              </div>
            )}
            {/* Method tabs */}
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map(m => (
                <button
                  key={m.id}
                  onClick={() => { setMethod(m.id); setStatus('idle'); setError(null); }}
                  className="border p-3 text-left transition-all"
                  style={{
                    background: method === m.id ? 'var(--accent-dim)' : 'rgba(255,255,255,0.02)',
                    borderColor: method === m.id ? 'var(--accent-line)' : 'var(--border)',
                    borderRadius: 4,
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
              {method === 'meta' && <MetaInstructions token={token.token} />}
              {method === 'file' && <FileInstructions domain={domain} token={token.token} />}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={verify}
                disabled={status === 'checking'}
                className="px-5 py-2.5 text-sm font-bold rounded-xl bg-[color:var(--accent)] hover:bg-[color:var(--accent)] text-white transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {status === 'checking' && (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                )}
                {status === 'checking' ? 'Checking…' : 'Check Verification'}
              </button>
              <button
                onClick={() => removeVerification(false)}
                disabled={removing}
                className="text-xs text-white/30 hover:text-white/60 transition-colors disabled:opacity-50"
              >
                {removing ? 'Removing…' : 'Reset token'}
              </button>
            </div>

            {status === 'failed' && error && (
              <div className="p-3 rounded-lg bg-orange-500/8 border border-orange-500/20">
                <p className="text-xs text-orange-400">{error}</p>
                <p className="text-xs text-white/30 mt-1">The proof must be visible in the server response. Publish the change, then retry. We saved this setup to your account, so you can leave and return later.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
