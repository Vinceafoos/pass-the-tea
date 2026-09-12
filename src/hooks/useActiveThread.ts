import { useCallback, useEffect, useRef, useState } from 'react';

import { getLatestThread } from '@/lib/relay';
import { supabase } from '@/lib/supabase';
import type { Thread } from '@/types/database';

export function useActiveThread(groupId: string | undefined) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setThread(null);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const next = await getLatestThread(groupId);
      setThread(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load thread');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!groupId) return;

    const channel = supabase
      .channel(`threads:${groupId}:${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'threads', filter: `group_id=eq.${groupId}` },
        () => {
          void refreshRef.current();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId]);

  return { thread, loading, error, refresh };
}
