import { describe, expect, it } from 'vitest';

import { createLockedClaimStore, decideClaim, type ClaimSnapshot } from './claimDecision';

const now = Date.parse('2026-09-11T12:00:00.000Z');

function base(overrides: Partial<ClaimSnapshot> = {}): ClaimSnapshot {
  return {
    messageId: 'msg-1',
    currentMessageId: 'msg-1',
    claimedBy: null,
    claimedAtMs: null,
    lastClaimedBy: null,
    consecutiveClaims: 0,
    senderId: 'user-seed',
    previousSenderId: null,
    isMember: true,
    threadStatus: 'active',
    ...overrides,
  };
}

describe('claimDecision', () => {
  it('User A claims unclaimed message -> success', () => {
    const result = decideClaim('user-a', base(), now);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.claimed_by).toBe('user-a');
    }
  });

  it('User B claims same message afterward -> already_claimed', () => {
    const snapshot = base({
      claimedBy: 'user-a',
      claimedAtMs: now,
      lastClaimedBy: 'user-a',
      consecutiveClaims: 1,
    });
    const result = decideClaim('user-b', snapshot, now + 1000);
    expect(result).toMatchObject({ success: false, reason: 'already_claimed', claimed_by: 'user-a' });
  });

  it('A and B claim simultaneously -> one success only', async () => {
    const store = createLockedClaimStore({
      ...base(),
      claimedAtMs: null,
    });
    const [a, b] = await Promise.all([
      store.claim('user-a', now),
      store.claim('user-b', now),
    ]);
    const wins = [a, b].filter((r) => r.success);
    const losses = [a, b].filter((r) => !r.success);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    if (!losses[0].success) {
      expect(losses[0].reason).toBe('already_claimed');
    }
    expect(store.snapshot().claimedBy).toBe(wins[0].success ? wins[0].claimed_by : null);
  });

  it('Expired claim -> another user may claim', () => {
    const elevenMinutes = 11 * 60 * 1000;
    const result = decideClaim(
      'user-b',
      base({ claimedBy: 'user-a', claimedAtMs: now, lastClaimedBy: 'user-a', consecutiveClaims: 1 }),
      now + elevenMinutes
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.claimed_by).toBe('user-b');
  });

  it('Non-group member -> rejected', () => {
    const result = decideClaim('outsider', base({ isMember: false }), now);
    expect(result).toMatchObject({ success: false, reason: 'not_group_member' });
  });

  it('Sender cannot claim their own message', () => {
    const result = decideClaim('user-a', base({ senderId: 'user-a' }), now);
    expect(result).toMatchObject({ success: false, reason: 'own_message' });
  });

  it('Previous sender cannot claim the reply to themselves', () => {
    const result = decideClaim(
      'user-a',
      base({ senderId: 'user-b', previousSenderId: 'user-a' }),
      now
    );
    expect(result).toMatchObject({ success: false, reason: 'too_soon' });
  });

  it('Original sender can claim after two other people have spoken', () => {
    const result = decideClaim(
      'user-a',
      base({ senderId: 'user-c', previousSenderId: 'user-b' }),
      now
    );
    expect(result.success).toBe(true);
  });

  it('Non-current message -> rejected', () => {
    const result = decideClaim('user-a', base({ currentMessageId: 'msg-other' }), now);
    expect(result).toMatchObject({ success: false, reason: 'not_current_message' });
  });
});
