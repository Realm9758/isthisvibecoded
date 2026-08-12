import 'server-only';
import { supabase } from '@/lib/supabase';

export interface UsageReservation {
  key: string;
  limit: number;
}

export async function reserveUsageBatch(reservations: UsageReservation[]): Promise<{
  allowed: boolean;
  deniedKey: string | null;
  error: string | null;
}> {
  if (reservations.length === 0) return { allowed: true, deniedKey: null, error: null };
  const { data, error } = await supabase.rpc('consume_usage_batch', {
    usage_keys: reservations.map(item => item.key),
    usage_limits: reservations.map(item => item.limit),
  });
  if (error) return { allowed: false, deniedKey: null, error: error.message };
  const result = data as { allowed?: unknown; denied_key?: unknown } | null;
  return {
    allowed: result?.allowed === true,
    deniedKey: typeof result?.denied_key === 'string' ? result.denied_key : null,
    error: null,
  };
}
