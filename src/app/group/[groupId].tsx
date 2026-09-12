import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActiveMessageCard } from '@/components/ActiveMessageCard';
import { ClaimButton } from '@/components/ClaimButton';
import { ParticipantAvatar } from '@/components/ParticipantAvatar';
import { RelayStatus } from '@/components/RelayStatus';
import { CLAIM_TTL_MS } from '@/constants/config';
import { useActiveMessage } from '@/hooks/useActiveMessage';
import { useActiveThread } from '@/hooks/useActiveThread';
import { useAuth } from '@/hooks/useAuth';
import { claimMessage, claimOpening, endDay, getMessage, getProfile, startNextDay } from '@/lib/relay';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';
import type { ClaimUiState } from '@/types/relay';

function isExpired(claimedAt: string | null) {
  if (!claimedAt) return true;
  return Date.now() - new Date(claimedAt).getTime() >= CLAIM_TTL_MS;
}

export default function GroupScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { thread, loading: threadLoading, error: threadError, refresh } = useActiveThread(groupId);
  const {
    message,
    loading: messageLoading,
    refresh: refreshMessage,
  } = useActiveMessage(thread?.current_message_id);
  const [sender, setSender] = useState<Profile | null>(null);
  const [claimant, setClaimant] = useState<Profile | null>(null);
  const [openingClaimant, setOpeningClaimant] = useState<Profile | null>(null);
  const [previousSenderId, setPreviousSenderId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('Group');
  const [claiming, setClaiming] = useState(false);
  const [endingDay, setEndingDay] = useState(false);
  const [startingDay, setStartingDay] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!groupId) return;
    supabase
      .from('groups')
      .select('name')
      .eq('id', groupId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.name) setGroupName(data.name);
      });
  }, [groupId]);

  useEffect(() => {
    if (!message?.sender_id) {
      setSender(null);
      return;
    }
    void getProfile(message.sender_id).then(setSender);
  }, [message?.sender_id]);

  useEffect(() => {
    if (!message?.responded_to_message_id) {
      setPreviousSenderId(null);
      return;
    }
    void getMessage(message.responded_to_message_id).then((previous) => {
      setPreviousSenderId(previous?.sender_id ?? null);
    });
  }, [message?.responded_to_message_id]);

  useEffect(() => {
    if (!message?.claimed_by || isExpired(message.claimed_at)) {
      setClaimant(null);
      return;
    }
    void getProfile(message.claimed_by).then(setClaimant);
  }, [message?.claimed_by, message?.claimed_at]);

  useEffect(() => {
    const liveOpening =
      Boolean(thread?.opening_claimed_by) && !isExpired(thread?.opening_claimed_at ?? null);
    if (!liveOpening || !thread?.opening_claimed_by) {
      setOpeningClaimant(null);
      return;
    }
    void getProfile(thread.opening_claimed_by).then(setOpeningClaimant);
  }, [thread?.opening_claimed_by, thread?.opening_claimed_at]);

  const dayClosed = thread?.status === 'closed';
  const openingClaimLive =
    !message &&
    Boolean(thread?.opening_claimed_by) &&
    !isExpired(thread?.opening_claimed_at ?? null);
  const iHoldOpening = openingClaimLive && thread?.opening_claimed_by === user?.id;

  const status: ClaimUiState = useMemo(() => {
    if (dayClosed) return { kind: 'empty' };
    if (!message) return { kind: 'empty' };
    const liveClaim = Boolean(message.claimed_by) && !isExpired(message.claimed_at);
    if (liveClaim && message.claimed_by === user?.id) return { kind: 'claimed_by_me' };
    if (liveClaim) {
      return {
        kind: 'claimed_by_other',
        claimantName: claimant?.display_name ?? 'a friend',
      };
    }
    if (user?.id && message.sender_id === user.id) return { kind: 'own_message' };
    if (user?.id && previousSenderId === user.id) return { kind: 'too_soon' };
    return { kind: 'unclaimed' };
  }, [message, user?.id, claimant?.display_name, previousSenderId, dayClosed]);

  async function onClaim() {
    if (!message) return;
    setClaiming(true);
    setNotice(null);
    try {
      const result = await claimMessage(message.id);
      if (result.success) {
        await Promise.all([refresh(), refreshMessage()]);
        return;
      }
      if (result.reason === 'already_claimed') {
        const profile = result.claimed_by ? await getProfile(result.claimed_by) : null;
        setNotice(`Too slow — claimed by ${profile?.display_name ?? 'someone else'}`);
        await Promise.all([refresh(), refreshMessage()]);
        return;
      }
      if (result.reason === 'own_message') {
        setNotice('You cannot respond to yourself.');
        return;
      }
      if (result.reason === 'too_soon') {
        setNotice('Two other people need to talk before you can go again.');
        return;
      }
      setNotice(result.reason);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setClaiming(false);
    }
  }

  async function onClaimOpening() {
    if (!thread) return;
    setClaiming(true);
    setNotice(null);
    try {
      const result = await claimOpening(thread.id);
      if (result.success) {
        await refresh();
        router.push({
          pathname: '/record/[threadId]',
          params: { threadId: thread.id, groupId, opening: '1' },
        });
        return;
      }
      if (result.reason === 'already_claimed') {
        const profile = result.claimed_by ? await getProfile(result.claimed_by) : null;
        setNotice(`Too slow — ${profile?.display_name ?? 'someone else'} is recording the first note`);
        await refresh();
        return;
      }
      setNotice(result.reason);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not claim the first note');
    } finally {
      setClaiming(false);
    }
  }

  async function onEndDay() {
    if (!thread) return;
    setEndingDay(true);
    setNotice(null);
    try {
      const result = await endDay(thread.id);
      if (!result.success) throw new Error(result.reason);
      await refresh();
      router.push(`/episode/${thread.id}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not end the day');
    } finally {
      setEndingDay(false);
    }
  }

  async function onStartNextDay() {
    if (!groupId) return;
    setStartingDay(true);
    setNotice(null);
    try {
      const result = await startNextDay(groupId);
      if (!result.success) throw new Error(result.reason);
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not start a new day');
    } finally {
      setStartingDay(false);
    }
  }

  if (threadLoading || messageLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const statusLabel = dayClosed
    ? 'Day closed'
    : status.kind === 'unclaimed'
      ? 'Unclaimed'
      : status.kind === 'claimed_by_me'
        ? 'You claimed this'
        : status.kind === 'claimed_by_other'
          ? `Claimed by ${claimant?.display_name ?? 'someone'}`
          : status.kind === 'own_message'
            ? 'Waiting for someone else'
            : status.kind === 'too_soon'
              ? 'Waiting for two other people'
              : 'No message';

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <ParticipantAvatar name={groupName} />
        <Text style={styles.groupName}>{groupName}</Text>
      </View>

      <ActiveMessageCard
        groupName={groupName}
        senderName={sender?.display_name}
        sentAt={message?.created_at}
        statusLabel={statusLabel}
      />

      {!dayClosed ? <RelayStatus status={status} /> : null}

      {dayClosed ? (
        <Text style={styles.body}>
          This day is closed. Play the recap to hear every note in order.
        </Text>
      ) : null}

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {threadError ? <Text style={styles.notice}>{threadError}</Text> : null}

      {!dayClosed && !message && thread && !openingClaimLive ? (
        <Pressable style={styles.primary} onPress={() => void onClaimOpening()} disabled={claiming}>
          <Text style={styles.primaryLabel}>
            {claiming ? 'Claiming…' : 'Record first note'}
          </Text>
        </Pressable>
      ) : null}

      {!dayClosed && !message && thread && iHoldOpening ? (
        <View style={styles.actions}>
          <Text style={styles.body}>You claimed the first note. Record it before the claim expires.</Text>
          <Pressable
            style={styles.primary}
            onPress={() =>
              router.push({
                pathname: '/record/[threadId]',
                params: { threadId: thread.id, groupId, opening: '1' },
              })
            }>
            <Text style={styles.primaryLabel}>Record</Text>
          </Pressable>
        </View>
      ) : null}

      {!dayClosed && !message && thread && openingClaimLive && !iHoldOpening ? (
        <Text style={styles.body}>
          {openingClaimant?.display_name ?? 'Someone'} is recording the first note. Wait until they send it.
        </Text>
      ) : null}

      {!dayClosed && status.kind === 'unclaimed' && message ? (
        <ClaimButton disabled={claiming} onPress={() => void onClaim()} />
      ) : null}

      {!dayClosed && status.kind === 'claimed_by_other' ? (
        <Text style={styles.body}>
          Too slow — claimed by {claimant?.display_name ?? 'a friend'}
        </Text>
      ) : null}

      {!dayClosed && status.kind === 'claimed_by_me' && message && thread ? (
        <View style={styles.actions}>
          <Text style={styles.body}>You claimed this message</Text>
          <Pressable
            style={styles.secondary}
            onPress={() => router.push(`/listen/${message.id}`)}>
            <Text style={styles.secondaryLabel}>Listen</Text>
          </Pressable>
          <Pressable
            style={styles.primary}
            onPress={() =>
              router.push({
                pathname: '/record/[threadId]',
                params: { threadId: thread.id, groupId },
              })
            }>
            <Text style={styles.primaryLabel}>Respond</Text>
          </Pressable>
        </View>
      ) : null}

      {thread && !dayClosed ? (
        <Pressable style={styles.danger} onPress={() => void onEndDay()} disabled={endingDay}>
          <Text style={styles.primaryLabel}>{endingDay ? 'Closing…' : 'End day (hackathon)'}</Text>
        </Pressable>
      ) : null}

      {thread && dayClosed ? (
        <View style={styles.actions}>
          <Pressable style={styles.primary} onPress={() => router.push(`/episode/${thread.id}`)}>
            <Text style={styles.primaryLabel}>Play today’s recap</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={() => void onStartNextDay()} disabled={startingDay}>
            <Text style={styles.secondaryLabel}>
              {startingDay ? 'Starting…' : 'Start a new day'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, gap: 16, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  groupName: { fontSize: 24, fontWeight: '700' },
  body: { fontSize: 16, color: '#374151' },
  notice: { color: '#B91C1C' },
  actions: { gap: 10 },
  primary: {
    backgroundColor: '#111827',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryLabel: { color: '#fff', fontWeight: '600', fontSize: 16 },
  secondary: {
    backgroundColor: '#E5E7EB',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryLabel: { color: '#111827', fontWeight: '600', fontSize: 16 },
  danger: {
    backgroundColor: '#B91C1C',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
});
