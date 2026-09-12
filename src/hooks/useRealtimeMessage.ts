import { useActiveMessage } from '@/hooks/useActiveMessage';

export function useRealtimeMessage(messageId: string | null | undefined) {
  return useActiveMessage(messageId);
}
