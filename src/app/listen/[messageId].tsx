import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatDuration } from '@/lib/audio';
import { formatListenStamp } from '@/lib/formatRelativeTime';
import { getMessage, getProfile, getSignedAudioUrl, getThread } from '@/lib/relay';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';

const WAVE_HEIGHTS = [
  28, 79, 36, 32, 30, 45, 52, 30, 61, 12, 47, 34, 39, 32, 46, 23, 35, 33, 42, 60, 45, 27, 61, 53,
  53, 34, 29, 26, 74, 60, 62, 59, 37, 78, 79, 51, 61, 27, 66, 38,
];

const Night = {
  bg: '#0B0B16',
  card: '#1A1A2B',
  border: '#2D2D45',
  muted: '#5A5978',
  dim: '#8B8AA8',
  text: '#F0EDFF',
  orange: '#F5A623',
};

export default function ListenScreen() {
  const { messageId } = useLocalSearchParams<{ messageId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [groupName, setGroupName] = useState('Group');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [sender, setSender] = useState<Profile | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!messageId || !user) return;
      setLoading(true);
      setError(null);
      try {
        const message = await getMessage(messageId);
        if (!message) throw new Error('Message not found');
        if (message.claimed_by !== user.id && message.sender_id !== user.id) {
          throw new Error('You cannot listen to this clip');
        }
        const [signed, thread, profile] = await Promise.all([
          getSignedAudioUrl(messageId),
          getThread(message.thread_id),
          message.sender_id ? getProfile(message.sender_id) : Promise.resolve(null),
        ]);
        if (thread) {
          const { data } = await supabase
            .from('groups')
            .select('name')
            .eq('id', thread.group_id)
            .maybeSingle();
          if (mounted) {
            if (data?.name) setGroupName(data.name);
            setGroupId(thread.group_id);
            setThreadId(thread.id);
          }
        }
        if (mounted) {
          setUrl(signed);
          setSender(profile);
          setSentAt(message.created_at);
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Could not load audio');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [messageId, user]);

  if (loading) {
    return (
      <View style={styles.center}>
        <StatusBar style="light" />
        <ActivityIndicator color={Night.orange} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <Pressable style={styles.iconBtn} onPress={() => router.back()}>
          <Text style={styles.iconBtnLabel}>←</Text>
        </Pressable>
        <View style={styles.centerTitle}>
          <Text style={styles.group}>{groupName}</Text>
          <Text style={styles.claimed}>YOU CLAIMED IT</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          Listen now · Max 10s · <Text style={styles.bannerWarn}>1 replay allowed</Text> · No
          scrubbing
        </Text>
      </View>

      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <ListenPlayer
          uri={url}
          sender={sender}
          groupName={groupName}
          sentAt={sentAt}
          onReply={
            threadId
              ? () =>
                  router.push({
                    pathname: '/record/[threadId]',
                    params: { threadId, groupId: groupId ?? '' },
                  })
              : undefined
          }
        />
      )}
    </SafeAreaView>
  );
}

function ListenPlayer({
  uri,
  sender,
  groupName,
  sentAt,
  onReply,
}: {
  uri: string | null;
  sender: Profile | null;
  groupName: string;
  sentAt: string | null;
  onReply?: () => void;
}) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const [replayUsed, setReplayUsed] = useState(false);

  if (!uri) return <Text style={styles.error}>No audio loaded.</Text>;

  const duration = status.duration ?? 0;
  const current = status.currentTime ?? 0;
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const playedBars = Math.round(progress * WAVE_HEIGHTS.length);
  const finished =
    Boolean(status.didJustFinish) ||
    (duration > 0 && current >= duration - 0.15 && !status.playing);

  async function onMainButton() {
    if (status.playing) {
      player.pause();
      return;
    }
    if (finished) {
      if (replayUsed) return;
      await player.seekTo(0);
      setReplayUsed(true);
      player.play();
      return;
    }
    player.play();
  }

  const showReplay = finished && !status.playing;
  const canReplay = showReplay && !replayUsed;
  const showReply = showReplay && Boolean(onReply);

  return (
    <View style={styles.body}>
      <View style={styles.sender}>
        <View style={styles.guitar}>
          <Text style={styles.guitarGlyph}>🎸</Text>
        </View>
        <Text style={styles.senderName}>{sender?.display_name.split(' ')[0] ?? 'Friend'}</Text>
        <Text style={styles.meta}>
          {formatListenStamp(sentAt)}
          {groupName ? ` · ${groupName}` : ''}
        </Text>
      </View>

      <View style={styles.player}>
        <View style={styles.waveRow}>
          {WAVE_HEIGHTS.map((height, index) => (
            <View
              key={index}
              style={[
                styles.bar,
                {
                  height,
                  backgroundColor: index < playedBars ? Night.orange : Night.border,
                  opacity: index < playedBars ? 0.9 : 0.4,
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.times}>
          <Text style={styles.time}>{formatDuration(current)}</Text>
          <Text style={styles.time}>{formatDuration(duration || 10)}</Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>

        <Pressable
          style={[styles.play, showReplay && !canReplay && styles.playDisabled]}
          disabled={showReplay && !canReplay}
          onPress={() => void onMainButton()}>
          <Text style={styles.playLabel}>
            {status.playing ? '❚❚' : canReplay ? '↩' : '▶'}
          </Text>
        </Pressable>
        {canReplay ? (
          <Text style={styles.replayHint}>
            Tap ↩ to replay <Text style={styles.bannerWarn}>(once only)</Text>
          </Text>
        ) : null}
      </View>

      {showReply ? (
        <Pressable style={styles.reply} onPress={onReply}>
          <Text style={styles.replyLabel}>Record your reply →</Text>
        </Pressable>
      ) : (
        <View style={styles.replySpacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Night.bg, paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: 'center', backgroundColor: Night.bg },
  top: { flexDirection: 'row', alignItems: 'center', paddingTop: 8, marginBottom: 8 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 0.64,
    borderColor: Night.border,
    backgroundColor: Night.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnLabel: { fontSize: 16, color: Night.dim },
  centerTitle: { flex: 1, alignItems: 'center' },
  group: { fontSize: 12, color: Night.muted },
  claimed: { fontSize: 11, color: Night.orange, marginTop: 2 },
  banner: {
    backgroundColor: Night.card,
    borderWidth: 0.64,
    borderColor: Night.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  bannerText: { color: Night.dim, fontSize: 12, textAlign: 'center' },
  bannerWarn: { color: Night.orange },
  error: { color: '#F87171', marginTop: 24, textAlign: 'center' },
  body: { flex: 1 },
  sender: { alignItems: 'center', paddingTop: 8, paddingBottom: 16 },
  guitar: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: Night.card,
    borderWidth: 1.9,
    borderColor: Night.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  guitarGlyph: { fontSize: 24 },
  senderName: { fontSize: 18, fontWeight: '600', color: Night.text },
  meta: { fontSize: 12, color: Night.muted, marginTop: 4 },
  player: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 80,
    width: '100%',
    marginBottom: 8,
  },
  bar: { flex: 1, borderRadius: 99, width: 4 },
  times: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  time: { fontSize: 12, color: Night.muted },
  track: {
    height: 4,
    width: '100%',
    backgroundColor: Night.border,
    borderRadius: 99,
    overflow: 'hidden',
    marginTop: 8,
    marginBottom: 24,
  },
  trackFill: { height: 4, backgroundColor: Night.orange },
  play: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Night.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playDisabled: { opacity: 0.35 },
  playLabel: { color: Night.bg, fontSize: 30 },
  replayHint: { color: Night.dim, fontSize: 12, marginTop: 16, textAlign: 'center' },
  reply: {
    backgroundColor: Night.orange,
    borderRadius: 16,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  replyLabel: { color: Night.bg, fontSize: 16, fontWeight: '600' },
  replySpacer: { height: 64 },
});
