import { useCallback, useEffect, useRef, useState } from 'react';

import { getMessage } from '@/lib/relay';
import { supabase } from '@/lib/supabase';
import type { Message } from '@/types/database';

export function useActiveMessage(messageId: string | null | undefined) {
  const [message, setMessage] = useState<Message | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!messageId) {
      setMessage(null);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const next = await getMessage(messageId);
      setMessage(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load message');
    } finally {
      setLoading(false);
    }
  }, [messageId]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!messageId) return;

    const channel = supabase
      .channel(`messages:${messageId}:${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `id=eq.${messageId}` },
        (payload) => {
          if (payload.new && typeof payload.new === 'object') {
            setMessage(payload.new as Message);
          } else {
            void refreshRef.current();
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [messageId]);

  return { message, loading, error, refresh };
}
