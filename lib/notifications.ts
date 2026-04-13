import { randomBytes } from 'crypto';
import { supabase } from './supabase';

export type NotificationType = 'comment' | 'reply' | 'popular' | 'security' | 'system';

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  description: string;
  link: string | null;
  read: boolean;
  createdAt: number;
}

function genId() {
  return randomBytes(8).toString('base64url');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToNotification(row: any): AppNotification {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: row.type as NotificationType,
    title: row.title as string,
    description: row.description as string,
    link: row.link as string | null,
    read: row.read as boolean,
    createdAt: row.created_at as number,
  };
}

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  description: string,
  link?: string,
): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    id: genId(),
    user_id: userId,
    type,
    title,
    description,
    link: link ?? null,
    read: false,
    created_at: Date.now(),
  });
  if (error) console.error('[notifications] failed to create:', error.message);
}

export async function getUserNotifications(userId: string): Promise<AppNotification[]> {
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? []).map(rowToNotification);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);
  return count ?? 0;
}

export async function markNotificationRead(id: string, userId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', userId);
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
}
