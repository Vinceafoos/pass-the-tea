import { CLAIM_TTL_MS } from '@/constants/config';
import type { Message, Thread } from '@/types/database';

export type RelayActionKind = 'claim' | 'waiting' | 'listen' | 'record' | 'recap' | 'nudge';

export type RelayAction = {
  kind: RelayActionKind;
  label: string;
  enabled: boolean;
};

export function isClaimExpired(claimedAt: string | null | undefined) {
  if (!claimedAt) return true;
  return Date.now() - new Date(claimedAt).getTime() >= CLAIM_TTL_MS;
}

export function getRelayAction({
  thread,
  message,
  userId,
  previousSenderId,
}: {
  thread: Thread | null | undefined;
  message: Message | null | undefined;
  userId: string | undefined;
  previousSenderId?: string | null;
}): RelayAction {
  if (!thread) return { kind: 'nudge', label: 'Nudge', enabled: true };
  if (thread.status === 'closed') return { kind: 'recap', label: 'Play recap', enabled: true };

  const openingLive =
    !message && Boolean(thread.opening_claimed_by) && !isClaimExpired(thread.opening_claimed_at);
  if (openingLive && thread.opening_claimed_by === userId) {
    return { kind: 'record', label: 'Record', enabled: true };
  }
  if (openingLive) return { kind: 'waiting', label: 'Waiting...', enabled: false };
  if (!message) return { kind: 'claim', label: 'Claim', enabled: true };

  const liveClaim = Boolean(message.claimed_by) && !isClaimExpired(message.claimed_at);
  if (liveClaim && message.claimed_by === userId) {
    return { kind: 'listen', label: 'Listen', enabled: true };
  }
  if (liveClaim) return { kind: 'waiting', label: 'Waiting...', enabled: false };
  if (userId && message.sender_id === userId) {
    return { kind: 'waiting', label: 'Waiting...', enabled: false };
  }
  if (userId && previousSenderId === userId) {
    return { kind: 'waiting', label: 'Waiting...', enabled: false };
  }
  return { kind: 'claim', label: 'Claim', enabled: true };
}
