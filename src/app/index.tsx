import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GroupListCard } from '@/components/GroupListCard';
import { GroupsRow, type GroupRowKind } from '@/components/GroupsRow';
import { HomeTabBar, type HomeTab } from '@/components/HomeTabBar';
import { WaveformBurst } from '@/components/WaveformBurst';
import { CLAIM_TTL_MS, isSupabaseConfigured } from '@/constants/config';
import { HomeColors } from '@/constants/homeTheme';
import { useActiveMessage } from '@/hooks/useActiveMessage';
import { useActiveThread } from '@/hooks/useActiveThread';
import { useAuth } from '@/hooks/useAuth';
import { signOut } from '@/lib/auth';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import {
  claimMessage,
  claimOpening,
  getHomeGroups,
  getMessage,
  getProfile,
  getSavedPodcasts,
} from '@/lib/relay';
import type { SavedPodcast } from '@/types/database';
import type { ClaimUiState, HomeGroupSnapshot } from '@/types/relay';

function isExpired(claimedAt: string | null) {
  if (!claimedAt) return true;
  return Date.now() - new Date(claimedAt).getTime() >= CLAIM_TTL_MS;
}

function memberLine(members: HomeGroupSnapshot['members'], currentUserId?: string) {
  const names = members.map((member) =>
    member.id === currentUserId ? 'You' : member.display_name.split(' ')[0]
  );
  const you = names.filter((name) => name === 'You');
  const others = names.filter((name) => name !== 'You');
  return [...others, ...you].join(', ');
}

function rowKind(item: HomeGroupSnapshot, userId: string | undefined): GroupRowKind {
  const thread = item.thread;
  const message = item.message;
  if (!thread) return 'nudge';
  if (thread.status === 'closed') return 'recap';
  const openingLive =
    !message && Boolean(thread.opening_claimed_by) && !isExpired(thread.opening_claimed_at);
  if (openingLive && thread.opening_claimed_by === userId) return 'listen';
  if (openingLive) return 'waiting';
  if (!message) return 'claim';
  const liveClaim = Boolean(message.claimed_by) && !isExpired(message.claimed_at);
  if (liveClaim && message.claimed_by === userId) return 'listen';
  if (liveClaim) return 'waiting';
  if (userId && message.sender_id === userId) return 'waiting';
  return 'claim';
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<HomeTab>('home');
  const [groups, setGroups] = useState<HomeGroupSnapshot[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [podcasts, setPodcasts] = useState<SavedPodcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [previousSenderId, setPreviousSenderId] = useState<string | null>(null);

  const selected = groups.find((item) => item.group.id === selectedGroupId) ?? groups[0] ?? null;
  const { thread, refresh: refreshThread } = useActiveThread(selected?.group.id);
  const {
    message,
    refresh: refreshMessage,
  } = useActiveMessage(thread?.current_message_id);

  const load = useCallback(async () => {
    if (!user) {
      setGroups([]);
      setPodcasts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setArchiveError(null);
    try {
      const nextGroups = await getHomeGroups();
      setGroups(nextGroups);
      setSelectedGroupId((current) => {
        if (current && nextGroups.some((item) => item.group.id === current)) return current;
        return nextGroups[0]?.group.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load groups');
    }
    try {
      const nextPodcasts = await getSavedPodcasts();
      setPodcasts(nextPodcasts);
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Could not load recaps');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    if (!message?.responded_to_message_id) {
      setPreviousSenderId(null);
      return;
    }
    void getMessage(message.responded_to_message_id).then((previous) => {
      setPreviousSenderId(previous?.sender_id ?? null);
    });
  }, [message?.responded_to_message_id]);

  const dayClosed = thread?.status === 'closed';
  const openingClaimLive =
    !message &&
    Boolean(thread?.opening_claimed_by) &&
    !isExpired(thread?.opening_claimed_at ?? null);
  const iHoldOpening = openingClaimLive && thread?.opening_claimed_by === user?.id;

  const status: ClaimUiState = useMemo(() => {
    if (!thread) return { kind: 'empty' };
    if (dayClosed) return { kind: 'empty' };
    if (!message) return { kind: 'empty' };
    const liveClaim = Boolean(message.claimed_by) && !isExpired(message.claimed_at);
    if (liveClaim && message.claimed_by === user?.id) return { kind: 'claimed_by_me' };
    if (liveClaim) return { kind: 'claimed_by_other' };
    if (user?.id && message.sender_id === user.id) return { kind: 'own_message' };
    if (user?.id && previousSenderId === user.id) return { kind: 'too_soon' };
    return { kind: 'unclaimed' };
  }, [thread, dayClosed, message, user?.id, previousSenderId]);

  const claimable = status.kind === 'unclaimed' && Boolean(message);
  const canClaimOpening = !dayClosed && !message && Boolean(thread) && !openingClaimLive;

  const claimLabel = claiming
    ? 'Claiming…'
    : dayClosed
      ? 'Play recap'
      : iHoldOpening
        ? 'Record'
        : status.kind === 'claimed_by_me'
          ? 'Listen'
          : canClaimOpening
            ? 'Claim'
            : claimable
              ? 'Claim'
              : status.kind === 'claimed_by_other' ||
                  status.kind === 'own_message' ||
                  status.kind === 'too_soon' ||
                  (openingClaimLive && !iHoldOpening)
                ? 'Waiting...'
                : 'Claim';

  const claimEnabled =
    !claiming &&
    (dayClosed ||
      iHoldOpening ||
      status.kind === 'claimed_by_me' ||
      canClaimOpening ||
      claimable);

  const claimTone: 'claim' | 'waiting' | 'nudge' =
    claimLabel === 'Waiting...' || status.kind === 'claimed_by_other'
      ? 'waiting'
      : claimEnabled || claiming
        ? 'claim'
        : 'nudge';

  async function onClaimPress(from?: HomeGroupSnapshot) {
    const target = from ?? selected;
    const targetThread = from ? from.thread : thread;
    const targetMessage = from ? from.message : message;
    if (!target || !targetThread) return;
    setNotice(null);
    const targetClosed = targetThread.status === 'closed';
    const targetOpeningLive =
      !targetMessage &&
      Boolean(targetThread.opening_claimed_by) &&
      !isExpired(targetThread.opening_claimed_at);
    const targetIHoldOpening = targetOpeningLive && targetThread.opening_claimed_by === user?.id;
    const targetLiveClaim =
      Boolean(targetMessage?.claimed_by) && !isExpired(targetMessage?.claimed_at ?? null);
    const targetClaimedByMe = targetLiveClaim && targetMessage?.claimed_by === user?.id;
    const targetCanOpening = !targetClosed && !targetMessage && !targetOpeningLive;

    if (targetClosed) {
      router.push(`/episode/${targetThread.id}`);
      return;
    }
    if (targetIHoldOpening) {
      router.push({
        pathname: '/record/[threadId]',
        params: { threadId: targetThread.id, groupId: target.group.id, opening: '1' },
      });
      return;
    }
    if (targetClaimedByMe && targetMessage) {
      router.push(`/listen/${targetMessage.id}`);
      return;
    }

    setClaiming(true);
    try {
      if (targetCanOpening) {
        const result = await claimOpening(targetThread.id);
        if (result.success) {
          await refreshThread();
          router.push({
            pathname: '/record/[threadId]',
            params: { threadId: targetThread.id, groupId: target.group.id, opening: '1' },
          });
          return;
        }
        if (result.reason === 'already_claimed') {
          const profile = result.claimed_by ? await getProfile(result.claimed_by) : null;
          setNotice(`Too slow — ${profile?.display_name ?? 'someone else'} is recording`);
          await refreshThread();
          return;
        }
        setNotice(result.reason);
        return;
      }

      if (!targetMessage) return;
      const result = await claimMessage(targetMessage.id);
      if (result.success) {
        await Promise.all([refreshThread(), refreshMessage(), load()]);
        router.push(`/listen/${targetMessage.id}`);
        return;
      }
      if (result.reason === 'already_claimed') {
        const profile = result.claimed_by ? await getProfile(result.claimed_by) : null;
        setNotice(`Too slow — claimed by ${profile?.display_name ?? 'someone else'}`);
        await Promise.all([refreshThread(), refreshMessage()]);
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

  if (!isSupabaseConfigured()) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Add Supabase keys</Text>
        <Text style={styles.body}>
          Copy `.env.example` to `.env` and set EXPO_PUBLIC_SUPABASE_URL and
          EXPO_PUBLIC_SUPABASE_ANON_KEY.
        </Text>
      </View>
    );
  }

  if (authLoading || loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  const live = claimable || canClaimOpening;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.bodyWrap}>
        {tab === 'home' ? (
          <ScrollView contentContainerStyle={styles.home} showsVerticalScrollIndicator={false}>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {groups.length === 0 ? (
              <Text style={styles.body}>
                Signed in as {user.email ?? 'unknown'}, but this account is not in a group yet.
              </Text>
            ) : selected ? (
              <>
                <Pressable
                  style={styles.featuredHeader}
                  onPress={() => router.push(`/group/${selected.group.id}`)}>
                  <View style={styles.icon}>
                    <Text style={styles.glyph}>🎸</Text>
                  </View>
                  <View style={styles.featuredCopy}>
                    <View style={styles.titleRow}>
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: live ? HomeColors.orange : HomeColors.green },
                        ]}
                      />
                      <Text style={styles.groupName}>{selected.group.name}</Text>
                    </View>
                    <Text style={styles.names} numberOfLines={1}>
                      {memberLine(selected.members, user.id)}
                    </Text>
                  </View>
                  <Text style={styles.time}>
                    {formatRelativeTime(message?.created_at ?? selected.activityAt)}
                  </Text>
                </Pressable>

                <WaveformBurst members={selected.members} />

                <Pressable
                  accessibilityRole="button"
                  disabled={!claimEnabled}
                  onPress={() => void onClaimPress()}
                  style={({ pressed }) => [
                    styles.claim,
                    {
                      backgroundColor:
                        claimTone === 'waiting'
                          ? HomeColors.waiting
                          : claimTone === 'nudge'
                            ? HomeColors.nudge
                            : HomeColors.green,
                    },
                    pressed && claimEnabled && styles.claimPressed,
                  ]}>
                  <Text style={styles.claimLabel}>{claimLabel}</Text>
                </Pressable>
                {notice ? <Text style={styles.notice}>{notice}</Text> : null}

                <View style={styles.sheet}>
                  {groups.map((item) => (
                    <GroupListCard
                      key={item.group.id}
                      name={item.group.name}
                      members={item.members}
                      currentUserId={user.id}
                      activityAt={item.activityAt}
                      live={item.group.id === selected.group.id ? live : item.thread?.status === 'active'}
                      selected={item.group.id === selected.group.id}
                      onPress={() => {
                        setNotice(null);
                        setSelectedGroupId(item.group.id);
                      }}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>
        ) : null}

        {tab === 'recaps' ? (
          <ScrollView contentContainerStyle={styles.pane}>
            <Text style={styles.paneKicker}>▶  Recaps archive</Text>
            {archiveError ? <Text style={styles.error}>{archiveError}</Text> : null}
            {podcasts.length === 0 ? (
              <Text style={styles.body}>
                After a day is closed, open the recap and tap Save to archive. Those days show up here.
              </Text>
            ) : (
              podcasts.map((podcast) => {
                const members =
                  groups.find((item) => item.group.id === podcast.group_id)?.members ?? [];
                return (
                  <GroupListCard
                    key={podcast.thread_id}
                    name={podcast.group_name}
                    members={members}
                    currentUserId={user.id}
                    activityAt={podcast.thread_date}
                    onPress={() => router.push(`/episode/${podcast.thread_id}`)}
                  />
                );
              })
            )}
          </ScrollView>
        ) : null}

        {tab === 'groups' ? (
          <ScrollView contentContainerStyle={styles.pane}>
            <Text style={styles.paneKicker}>GROUPS</Text>
            {groups.map((item) => (
              <GroupsRow
                key={item.group.id}
                name={item.group.name}
                members={item.members}
                kind={rowKind(item, user.id)}
                onPress={() => {
                  const kind = rowKind(item, user.id);
                  if (kind === 'waiting' || kind === 'nudge') {
                    router.push(`/group/${item.group.id}`);
                    return;
                  }
                  void onClaimPress(item);
                }}
              />
            ))}
            <Pressable style={styles.signOut} onPress={() => void signOut()}>
              <Text style={styles.signOutLabel}>Sign out</Text>
            </Pressable>
          </ScrollView>
        ) : null}

        {tab === 'host' ? (
          <View style={styles.pane}>
            <Text style={styles.paneKicker}>AI HOST</Text>
            <Text style={styles.body}>
              The daily recap is still the raw notes in order. An AI host is not part of this build yet.
            </Text>
          </View>
        ) : null}
      </View>
      <HomeTabBar tab={tab} onChange={setTab} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: HomeColors.background },
  bodyWrap: { flex: 1 },
  home: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  center: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: HomeColors.background },
  featuredHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: HomeColors.iconTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 20 },
  featuredCopy: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  groupName: { fontSize: 18, fontWeight: '700', color: HomeColors.ink },
  names: { color: HomeColors.names, fontSize: 13 },
  time: { color: HomeColors.muted, fontSize: 13 },
  claim: {
    alignSelf: 'center',
    borderRadius: 8,
    width: 250,
    height: 51,
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimPressed: { opacity: 0.85 },
  claimLabel: { color: '#FFFFFF', fontSize: 32, fontWeight: '600' },
  notice: { color: '#B91C1C', textAlign: 'center', marginTop: 8 },
  sheet: {
    marginTop: 18,
    gap: 16,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  pane: { padding: 20, gap: 16 },
  paneKicker: {
    fontSize: 18,
    fontWeight: '500',
    color: HomeColors.forest,
    letterSpacing: 0.4,
  },
  paneTitle: { fontSize: 28, fontWeight: '700', color: HomeColors.ink },
  body: { fontSize: 16, color: '#374151', lineHeight: 22 },
  emptyTitle: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  error: { color: '#B91C1C' },
  row: { padding: 16, backgroundColor: HomeColors.card, borderRadius: 16, gap: 4 },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTitle: { fontSize: 18, fontWeight: '600', color: HomeColors.ink },
  signOut: { marginTop: 24, padding: 14, alignItems: 'center' },
  signOutLabel: { color: HomeColors.muted, fontWeight: '600' },
});
