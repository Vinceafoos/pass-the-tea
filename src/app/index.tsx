import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
import { GroupsRow } from '@/components/GroupsRow';
import { HomeTabBar, type HomeTab } from '@/components/HomeTabBar';
import { RelayClaimButton } from '@/components/RelayClaimButton';
import { WaveformBurst } from '@/components/WaveformBurst';
import { isSupabaseConfigured } from '@/constants/config';
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
import { getRelayAction, isClaimExpired } from '@/lib/relayAction';
import { supabase } from '@/lib/supabase';
import type { SavedPodcast } from '@/types/database';
import type { HomeGroupSnapshot } from '@/types/relay';

function memberLine(members: HomeGroupSnapshot['members'], currentUserId?: string) {
  const names = members.map((member) =>
    member.id === currentUserId ? 'You' : member.display_name.split(' ')[0]
  );
  const you = names.filter((name) => name === 'You');
  const others = names.filter((name) => name !== 'You');
  return [...others, ...you].join(', ');
}

function withLiveRelay(
  item: HomeGroupSnapshot,
  live: {
    groupId: string | undefined;
    thread: HomeGroupSnapshot['thread'];
    message: HomeGroupSnapshot['message'];
    previousSenderId: string | null;
  },
): HomeGroupSnapshot {
  if (item.group.id !== live.groupId || !live.thread) return item;
  const nextMessage = live.thread.current_message_id
    ? live.message && live.message.id === live.thread.current_message_id
      ? live.message
      : item.message
    : null;
  return {
    ...item,
    thread: live.thread,
    message: nextMessage,
    previousSenderId: nextMessage?.responded_to_message_id ? live.previousSenderId : null,
    activityAt: nextMessage?.created_at ?? item.activityAt,
  };
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

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user) {
      setGroups([]);
      setPodcasts([]);
      setLoading(false);
      return;
    }
    if (!opts?.silent) {
      setLoading(true);
      setError(null);
      setArchiveError(null);
    }
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
    if (!opts?.silent) {
      try {
        const nextPodcasts = await getSavedPodcasts();
        setPodcasts(nextPodcasts);
      } catch (err) {
        setArchiveError(err instanceof Error ? err.message : 'Could not load recaps');
      } finally {
        setLoading(false);
      }
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const groupIdsKey = groups.map((item) => item.group.id).sort().join(',');

  useEffect(() => {
    if (!user || !groupIdsKey) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const queue = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        void load({ silent: true });
      }, 250);
    };
    const channel = supabase.channel(`home-relay:${user.id}`);
    for (const groupId of groupIdsKey.split(',')) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'threads', filter: `group_id=eq.${groupId}` },
        queue,
      );
    }
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, queue);
    channel.subscribe();
    return () => {
      if (timeout) clearTimeout(timeout);
      void supabase.removeChannel(channel);
    };
  }, [user, groupIdsKey, load]);

  useEffect(() => {
    if (!message?.responded_to_message_id) {
      setPreviousSenderId(null);
      return;
    }
    void getMessage(message.responded_to_message_id).then((previous) => {
      setPreviousSenderId(previous?.sender_id ?? null);
    });
  }, [message?.responded_to_message_id]);

  const liveRelay = {
    groupId: selected?.group.id,
    thread,
    message,
    previousSenderId,
  };
  const featured = selected ? withLiveRelay(selected, liveRelay) : null;
  const featuredAction = getRelayAction({
    thread: featured?.thread,
    message: featured?.message,
    userId: user?.id,
    previousSenderId: featured?.previousSenderId,
  });

  async function onClaimPress(from?: HomeGroupSnapshot) {
    const target = from ?? featured;
    const targetThread = target?.thread;
    const targetMessage = target?.message;
    if (!target || !targetThread) return;
    setNotice(null);
    const action = getRelayAction({
      thread: targetThread,
      message: targetMessage,
      userId: user?.id,
      previousSenderId: target.previousSenderId,
    });

    if (action.kind === 'recap') {
      router.push(`/episode/${targetThread.id}`);
      return;
    }
    if (action.kind === 'record') {
      router.push({
        pathname: '/record/[threadId]',
        params: { threadId: targetThread.id, groupId: target.group.id, opening: '1' },
      });
      return;
    }
    if (action.kind === 'listen' && targetMessage) {
      router.push(`/listen/${targetMessage.id}`);
      return;
    }
    if (action.kind !== 'claim') return;

    setClaiming(true);
    try {
      const openingFree =
        !targetMessage &&
        (!targetThread.opening_claimed_by || isClaimExpired(targetThread.opening_claimed_at));

      if (openingFree) {
        const result = await claimOpening(targetThread.id);
        if (result.success) {
          await Promise.all([refreshThread(), load({ silent: true })]);
          router.push({
            pathname: '/record/[threadId]',
            params: { threadId: targetThread.id, groupId: target.group.id, opening: '1' },
          });
          return;
        }
        if (result.reason === 'already_claimed') {
          const profile = result.claimed_by ? await getProfile(result.claimed_by) : null;
          setNotice(`Too slow — ${profile?.display_name ?? 'someone else'} is recording`);
          await Promise.all([refreshThread(), load({ silent: true })]);
          return;
        }
        setNotice(result.reason);
        return;
      }

      if (!targetMessage) return;
      const result = await claimMessage(targetMessage.id);
      if (result.success) {
        await Promise.all([refreshThread(), refreshMessage(), load({ silent: true })]);
        router.push(`/listen/${targetMessage.id}`);
        return;
      }
      if (result.reason === 'already_claimed') {
        const profile = result.claimed_by ? await getProfile(result.claimed_by) : null;
        setNotice(`Too slow — claimed by ${profile?.display_name ?? 'someone else'}`);
        await Promise.all([refreshThread(), refreshMessage(), load({ silent: true })]);
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
            ) : featured ? (
              <>
                <Pressable
                  style={styles.featuredHeader}
                  onPress={() => router.push(`/group/${featured.group.id}`)}>
                  <View style={styles.icon}>
                    <Text style={styles.glyph}>🎸</Text>
                  </View>
                  <View style={styles.featuredCopy}>
                    <View style={styles.titleRow}>
                      <View
                        style={[
                          styles.dot,
                          {
                            backgroundColor:
                              featuredAction.kind === 'claim' || featuredAction.kind === 'listen'
                                ? HomeColors.orange
                                : HomeColors.green,
                          },
                        ]}
                      />
                      <Text style={styles.groupName}>{featured.group.name}</Text>
                    </View>
                    <Text style={styles.names} numberOfLines={1}>
                      {memberLine(featured.members, user.id)}
                    </Text>
                  </View>
                  <Text style={styles.time}>
                    {formatRelativeTime(featured.message?.created_at ?? featured.activityAt)}
                  </Text>
                </Pressable>

                <WaveformBurst members={featured.members} />

                <RelayClaimButton
                  action={featuredAction}
                  claiming={claiming}
                  onPress={() => void onClaimPress()}
                />
                {notice ? <Text style={styles.notice}>{notice}</Text> : null}

                <View style={styles.sheet}>
                  {groups.map((item) => {
                    const card = withLiveRelay(item, liveRelay);
                    return (
                      <GroupListCard
                        key={item.group.id}
                        name={card.group.name}
                        members={card.members}
                        currentUserId={user.id}
                        activityAt={card.activityAt}
                        live={
                          card.group.id === featured.group.id
                            ? featuredAction.kind === 'claim' || featuredAction.kind === 'listen'
                            : card.thread?.status === 'active'
                        }
                        selected={card.group.id === featured.group.id}
                        onPress={() => {
                          setNotice(null);
                          setSelectedGroupId(item.group.id);
                        }}
                      />
                    );
                  })}
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
            {groups.map((item) => {
              const row = withLiveRelay(item, liveRelay);
              const action = getRelayAction({
                thread: row.thread,
                message: row.message,
                userId: user.id,
                previousSenderId: row.previousSenderId,
              });
              return (
                <GroupsRow
                  key={item.group.id}
                  name={row.group.name}
                  members={row.members}
                  kind={action.kind}
                  onPress={() => {
                    if (action.kind === 'waiting' || action.kind === 'nudge') {
                      router.push(`/group/${item.group.id}`);
                      return;
                    }
                    void onClaimPress(row);
                  }}
                />
              );
            })}
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
