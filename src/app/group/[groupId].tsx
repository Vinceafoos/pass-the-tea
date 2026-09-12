import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActiveMessageCard } from '@/components/ActiveMessageCard';
import { ParticipantAvatar } from '@/components/ParticipantAvatar';
import { RelayClaimButton } from '@/components/RelayClaimButton';
import { RelayStatus } from '@/components/RelayStatus';
import { HomeColors } from '@/constants/homeTheme';
import { useActiveMessage } from '@/hooks/useActiveMessage';
import { useActiveThread } from '@/hooks/useActiveThread';
import { useAuth } from '@/hooks/useAuth';
import { claimMessage, claimOpening, endDay, getMessage, getProfile, startNextDay } from '@/lib/relay';
import { getRelayAction, isClaimExpired } from '@/lib/relayAction';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';
import type { ClaimUiState } from '@/types/relay';

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

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void refreshMessage();
    }, [refresh, refreshMessage]),
  );

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
    if (!message?.claimed_by || isClaimExpired(message.claimed_at)) {
      setClaimant(null);
      return;
    }
    void getProfile(message.claimed_by).then(setClaimant);
  }, [message?.claimed_by, message?.claimed_at]);

  useEffect(() => {
    const liveOpening =
      Boolean(thread?.opening_claimed_by) && !isClaimExpired(thread?.opening_claimed_at);
    if (!liveOpening || !thread?.opening_claimed_by) {
      setOpeningClaimant(null);
      return;
    }
    void getProfile(thread.opening_claimed_by).then(setOpeningClaimant);
  }, [thread?.opening_claimed_by, thread?.opening_claimed_at]);

  const action = getRelayAction({
    thread,
    message,
    userId: user?.id,
    previousSenderId,
  });

  const status: ClaimUiState = (() => {
    if (action.kind === 'recap' || !message) return { kind: 'empty' };
    if (action.kind === 'listen') return { kind: 'claimed_by_me' };
    if (action.kind === 'waiting' && message.claimed_by && message.claimed_by !== user?.id) {
      return { kind: 'claimed_by_other', claimantName: claimant?.display_name ?? 'a friend' };
    }
    if (user?.id && message.sender_id === user.id) return { kind: 'own_message' };
    if (user?.id && previousSenderId === user.id) return { kind: 'too_soon' };
    if (action.kind === 'claim') return { kind: 'unclaimed' };
    return { kind: 'empty' };
  })();

  async function onPrimary() {
    if (!thread) return;
    setNotice(null);
    if (action.kind === 'recap') {
      router.push(`/episode/${thread.id}`);
      return;
    }
    if (action.kind === 'record') {
      router.push({
        pathname: '/record/[threadId]',
        params: { threadId: thread.id, groupId, opening: '1' },
      });
      return;
    }
    if (action.kind === 'listen' && message) {
      router.push(`/listen/${message.id}`);
      return;
    }
    if (action.kind !== 'claim') return;

    setClaiming(true);
    try {
      const openingFree =
        !message && (!thread.opening_claimed_by || isClaimExpired(thread.opening_claimed_at));
      if (openingFree) {
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
        return;
      }

      if (!message) return;
      const result = await claimMessage(message.id);
      if (result.success) {
        await Promise.all([refresh(), refreshMessage()]);
        router.push(`/listen/${message.id}`);
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

  const statusLabel =
    action.kind === 'recap'
      ? 'Day closed'
      : action.kind === 'claim'
        ? 'Unclaimed'
        : action.kind === 'listen'
          ? 'You claimed this'
          : action.kind === 'record'
            ? 'You claimed the first note'
            : action.kind === 'waiting'
              ? claimant?.display_name
                ? `Claimed by ${claimant.display_name}`
                : openingClaimant?.display_name
                  ? `${openingClaimant.display_name} is recording`
                  : 'Waiting'
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

      {action.kind === 'recap' ? (
        <Text style={styles.body}>
          This day is closed. Play the recap to hear every note in order.
        </Text>
      ) : message ? (
        <RelayStatus status={status} />
      ) : action.kind === 'waiting' ? (
        <Text style={styles.body}>
          {openingClaimant?.display_name ?? 'Someone'} is recording the first note.
        </Text>
      ) : action.kind === 'record' ? (
        <Text style={styles.body}>You claimed the first note. Record it before the claim expires.</Text>
      ) : (
        <Text style={styles.body}>No active voice note yet. Claim to record the first one.</Text>
      )}

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {threadError ? <Text style={styles.notice}>{threadError}</Text> : null}

      <RelayClaimButton action={action} claiming={claiming} onPress={() => void onPrimary()} />

      {thread && action.kind !== 'recap' ? (
        <Pressable style={styles.danger} onPress={() => void onEndDay()} disabled={endingDay}>
          <Text style={styles.primaryLabel}>{endingDay ? 'Closing…' : 'End day (hackathon)'}</Text>
        </Pressable>
      ) : null}

      {thread && action.kind === 'recap' ? (
        <Pressable style={styles.secondary} onPress={() => void onStartNextDay()} disabled={startingDay}>
          <Text style={styles.secondaryLabel}>
            {startingDay ? 'Starting…' : 'Start a new day'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, gap: 16, backgroundColor: HomeColors.background },
  center: { flex: 1, justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  groupName: { fontSize: 24, fontWeight: '700' },
  body: { fontSize: 16, color: '#374151' },
  notice: { color: '#B91C1C' },
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
