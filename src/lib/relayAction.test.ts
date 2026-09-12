import { describe, expect, it } from 'vitest';

import { CLAIM_TTL_MS } from '@/constants/config';
import { getRelayAction } from '@/lib/relayAction';
import type { Message, Thread } from '@/types/database';

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    group_id: 'group-1',
    thread_date: '2026-09-12',
    status: 'active',
    current_message_id: 'msg-1',
    last_claimed_by: null,
    consecutive_claims: 0,
    created_at: new Date().toISOString(),
    opening_claimed_by: null,
    opening_claimed_at: null,
    ...overrides,
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    thread_id: 'thread-1',
    sender_id: 'user-b',
    audio_path: 'path.m4a',
    sequence_number: 1,
    responded_to_message_id: null,
    claimed_by: null,
    claimed_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('getRelayAction', () => {
  it('matches claim when the clip is free', () => {
    expect(getRelayAction({ thread: thread(), message: message(), userId: 'user-a' }).kind).toBe(
      'claim',
    );
  });

  it('matches waiting when someone else holds a live claim', () => {
    const action = getRelayAction({
      thread: thread(),
      message: message({ claimed_by: 'user-c', claimed_at: new Date().toISOString() }),
      userId: 'user-a',
    });
    expect(action).toMatchObject({ kind: 'waiting', enabled: false });
  });

  it('matches listen when I hold the claim', () => {
    expect(
      getRelayAction({
        thread: thread(),
        message: message({ claimed_by: 'user-a', claimed_at: new Date().toISOString() }),
        userId: 'user-a',
      }).kind,
    ).toBe('listen');
  });

  it('matches waiting for my own clip', () => {
    expect(
      getRelayAction({
        thread: thread(),
        message: message({ sender_id: 'user-a' }),
        userId: 'user-a',
      }).kind,
    ).toBe('waiting');
  });

  it('matches waiting when it is too soon to go again', () => {
    expect(
      getRelayAction({
        thread: thread(),
        message: message({ responded_to_message_id: 'msg-0' }),
        userId: 'user-a',
        previousSenderId: 'user-a',
      }).kind,
    ).toBe('waiting');
  });

  it('matches record when I hold the opening claim', () => {
    expect(
      getRelayAction({
        thread: thread({
          current_message_id: null,
          opening_claimed_by: 'user-a',
          opening_claimed_at: new Date().toISOString(),
        }),
        message: null,
        userId: 'user-a',
      }).kind,
    ).toBe('record');
  });

  it('treats an expired claim as claimable again', () => {
    const expired = new Date(Date.now() - CLAIM_TTL_MS - 1000).toISOString();
    expect(
      getRelayAction({
        thread: thread(),
        message: message({ claimed_by: 'user-c', claimed_at: expired }),
        userId: 'user-a',
      }).kind,
    ).toBe('claim');
  });
});
