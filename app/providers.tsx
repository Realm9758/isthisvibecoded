'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import { ConsentModal } from '@/components/ConsentModal';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ConsentModal />
      {children}
    </AuthProvider>
  );
}
