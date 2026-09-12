import { CLAIM_TTL_MS } from '@/constants/config';
import type { ClaimRpcResult } from '@/types/database';

export type ClaimSnapshot = {
  messageId: string;
  currentMessageId: string | null;
  claimedBy: string | null;
  claimedAtMs: number | null;
  lastClaimedBy: string | null;
  consecutiveClaims: number;
  senderId: string | null;
  previousSenderId: string | null;
  isMember: boolean;
  threadStatus: 'active' | 'closed';
};

export function isClaimExpired(claimedAtMs: number | null, nowMs: number) {
  return claimedAtMs === null || nowMs - claimedAtMs >= CLAIM_TTL_MS;
}

/**
 * Mirrors public.claim_message so the race rules can be unit-tested
 * without a live database. Postgres remains the source of truth.
 */
export function decideClaim(
  userId: string | null,
  snapshot: ClaimSnapshot,
  nowMs: number
): ClaimRpcResult {
  if (!userId) {
    return { success: false, reason: 'unauthenticated' };
  }
  if (!snapshot.isMember) {
    return { success: false, reason: 'not_group_member' };
  }
  if (snapshot.threadStatus !== 'active') {
    return { success: false, reason: 'thread_closed' };
  }
  if (snapshot.currentMessageId !== snapshot.messageId) {
    return { success: false, reason: 'not_current_message' };
  }

  const expired =
    snapshot.claimedBy === null || isClaimExpired(snapshot.claimedAtMs, nowMs);

  if (snapshot.claimedBy && !expired && snapshot.claimedBy !== userId) {
    return {
      success: false,
      reason: 'already_claimed',
      claimed_by: snapshot.claimedBy,
    };
  }

  if (snapshot.claimedBy === userId && !expired) {
    return {
      success: true,
      message_id: snapshot.messageId,
      claimed_by: userId,
      claimed_at: new Date(snapshot.claimedAtMs ?? nowMs).toISOString(),
    };
  }

  if (snapshot.senderId === userId) {
    return { success: false, reason: 'own_message' };
  }

  if (snapshot.previousSenderId === userId) {
    return { success: false, reason: 'too_soon' };
  }

  return {
    success: true,
    message_id: snapshot.messageId,
    claimed_by: userId,
    claimed_at: new Date(nowMs).toISOString(),
  };
}

export type MutableRelay = ClaimSnapshot & {
  claimedAtMs: number | null;
};

export function applyClaim(
  store: MutableRelay,
  userId: string | null,
  nowMs: number
): ClaimRpcResult {
  const result = decideClaim(userId, store, nowMs);
  if (!result.success) return result;

  const isSelfRefresh = store.claimedBy === userId;
  store.claimedBy = result.claimed_by;
  store.claimedAtMs = nowMs;

  if (isSelfRefresh) {
    return result;
  }
  if (store.lastClaimedBy === userId) {
    store.consecutiveClaims += 1;
  } else {
    store.lastClaimedBy = userId;
    store.consecutiveClaims = 1;
  }
  return result;
}

class Mutex {
  private queue = Promise.resolve();

  runExclusive<T>(fn: () => T): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

export function createLockedClaimStore(initial: MutableRelay) {
  const mutex = new Mutex();
  return {
    snapshot: () => ({ ...initial }),
    claim(userId: string | null, nowMs: number) {
      return mutex.runExclusive(() => applyClaim(initial, userId, nowMs));
    },
  };
}
