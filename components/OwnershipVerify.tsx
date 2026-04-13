'use client';

import { useState } from 'react';
import type { VerificationToken } from '@/types/analysis';

type Method = 'dns' | 'meta' | 'file';

interface Props {
  domain: string;
  onVerified?: () => void;
}

export function OwnershipVerify({ domain, onVerified }: Props) {
  const [token, setToken] = useState<VerificationToken | null>(null);
  const [method, setMethod] = useState<Method>('dns');
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

  const methodInstruction = token
    ? method === 'dns'
      ? { label: 'Add DNS TXT Record', code: `_vibecoded-verification.${domain}\n→ vibecoded-verification=${token.token}` }
      : method === 'meta'
      ? { label: 'Add to <head>', code: `<meta name="vibecoded-verification"\n      content="${token.token}" />` }
      : { label: `Upload file to`, code: `${token.methods.filePath}\n\nFile contents:\n${token.token}` }
    : null;

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full bg-violet-400" />
        <h3 className="text-sm font-semibold text-violet-300">Verify Ownership of {domain}</h3>
      </div>

      {status === 'verified' ? (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <span className="text-2xl">✓</span>
          <div>
            <p className="font-semibold text-emerald-300">Domain Verified!</p>
            <p className="text-xs text-white/50 mt-0.5">You have confirmed ownership of {domain}.</p>
          </div>
        </div>
      ) : !token ? (
        <div>
          <p className="text-sm text-white/50 mb-4">
            Prove you own this domain to unlock deeper scan features and detailed recommendations.
          </p>
          <button
            onClick={generate}
            disabled={status === 'generating'}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
          >
            {status === 'generating' ? 'Generating...' : 'Generate Verification Token'}
          </button>
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        </div>
      ) : (
        <div>
          {/* Method selector */}
          <div className="flex gap-2 mb-4">
            {(['dns', 'meta', 'file'] as Method[]).map(m => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
                  method === m
                    ? 'bg-violet-600 border-violet-500 text-white'
                    : 'bg-transparent border-white/10 text-white/50 hover:text-white/80'
                }`}
              >
                {m === 'dns' ? 'DNS Record' : m === 'meta' ? 'Meta Tag' : 'File Upload'}
              </button>
            ))}
          </div>

          {methodInstruction && (
            <div className="mb-4">
              <p className="text-xs text-white/40 mb-2">{methodInstruction.label}</p>
              <pre className="text-xs font-mono bg-black/40 border border-white/10 rounded-lg p-3 text-emerald-300 overflow-x-auto whitespace-pre-wrap">
                {methodInstruction.code}
              </pre>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={verify}
              disabled={status === 'checking'}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
            >
              {status === 'checking' ? 'Checking...' : 'Check Verification'}
            </button>
            <button
              onClick={async () => {
                await fetch('/api/verify', {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ domain }),
                });
                setToken(null);
                setStatus('idle');
                setError(null);
              }}
              className="text-xs text-white/30 hover:text-white/60 transition-colors"
            >
              Reset
            </button>
          </div>

          {status === 'failed' && error && (
            <p className="text-xs text-orange-400 mt-2">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
