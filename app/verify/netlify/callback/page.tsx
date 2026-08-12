'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPath } from '@/lib/site';
import { MUTATION_GUARD_HEADER, MUTATION_GUARD_VALUE } from '@/lib/request-security-constants';

export default function NetlifyVerificationCallback() {
  const router = useRouter();
  const [message, setMessage] = useState('Confirming the domain with Netlify...');

  useEffect(() => {
    const values = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = values.get('access_token');
    const state = values.get('state');
    history.replaceState(null, '', window.location.pathname);
    if (!accessToken || !state) {
      const timer = window.setTimeout(
        () => setMessage('Netlify did not return a usable verification token.'),
        0,
      );
      return () => window.clearTimeout(timer);
    }
    fetch(apiPath('/api/verify/oauth/netlify/complete'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [MUTATION_GUARD_HEADER]: MUTATION_GUARD_VALUE,
      },
      body: JSON.stringify({ accessToken, state }),
    })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Netlify verification failed');
        router.replace(`/dashboard?domain=${encodeURIComponent(result.domain)}&intent=verified&provider=netlify`);
      })
      .catch(error => setMessage(error instanceof Error ? error.message : 'Netlify verification failed'));
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-lg border p-8" style={{ borderColor: 'var(--border)', background: 'var(--surface)', borderRadius: 6 }}>
        <p className="label mb-3">Netlify verification</p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{message}</p>
      </div>
    </main>
  );
}
