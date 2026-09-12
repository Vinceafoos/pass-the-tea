import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EpisodePlayer, type EpisodeTrack } from '@/components/EpisodePlayer';
import { InitialStack } from '@/components/InitialStack';
import { PodcastDiscussion } from '@/components/PodcastDiscussion';
import { HomeColors } from '@/constants/homeTheme';
import { getEpisodeTracks, getHomeGroups, getThread, isPodcastSaved, savePodcast, unsavePodcast } from '@/lib/relay';
import { supabase } from '@/lib/supabase';
import type { Profile, Thread } from '@/types/database';

export default function EpisodeScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();
  const [thread, setThread] = useState<Thread | null>(null);
  const [tracks, setTracks] = useState<EpisodeTrack[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('Recap');
  const [members, setMembers] = useState<Profile[]>([]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!threadId) return;
      setLoading(true);
      setError(null);
      try {
        const nextThread = await getThread(threadId);
        if (!nextThread) throw new Error('Thread not found');
        if (nextThread.status !== 'closed') {
          throw new Error('End the day first to generate today’s recap.');
        }
        const [nextTracks, alreadySaved, { data: group }, homes] = await Promise.all([
          getEpisodeTracks(threadId),
          isPodcastSaved(threadId),
          supabase.from('groups').select('name').eq('id', nextThread.group_id).maybeSingle(),
          getHomeGroups(),
        ]);
        if (!mounted) return;
        setThread(nextThread);
        setTracks(nextTracks);
        setSaved(alreadySaved);
        if (group?.name) setGroupName(group.name);
        setMembers(homes.find((item) => item.group.id === nextThread.group_id)?.members ?? []);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Could not load recap');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [threadId]);

  async function onToggleSave() {
    if (!threadId) return;
    setSaving(true);
    setNotice(null);
    try {
      if (saved) {
        const result = await unsavePodcast(threadId);
        if (!result.success) throw new Error(result.reason ?? 'Could not remove');
        setSaved(false);
        setNotice('Removed from archive');
      } else {
        const result = await savePodcast(threadId);
        if (!result.success) throw new Error(result.reason ?? 'Could not save');
        setSaved(true);
        setNotice('Saved to archive');
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Archive update failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  const dateLabel = thread?.thread_date
    ? new Date(`${thread.thread_date}T12:00:00`).toDateString().toUpperCase()
    : '';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
          <View style={styles.topRow}>
            <Pressable onPress={() => router.back()}>
              <Text style={styles.kicker}>▶  YOUR RECAP IS READY</Text>
            </Pressable>
            <Pressable style={styles.spark} onPress={() => void onToggleSave()} disabled={saving}>
              <Text>{saved ? '★' : '✨'}</Text>
            </Pressable>
          </View>
          <View style={styles.heading}>
            <View style={styles.icon}>
              <Text>🎸</Text>
            </View>
            <Text style={styles.title}>{groupName}</Text>
            <InitialStack members={members} />
          </View>
          <Text style={styles.meta}>
            {dateLabel}
            {saved ? ' · IN ARCHIVE' : ''}
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : <EpisodePlayer tracks={tracks} />}
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {threadId && !error ? <PodcastDiscussion threadId={threadId} /> : null}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: HomeColors.forestMid },
  screen: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', backgroundColor: HomeColors.forestMid },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { color: '#fff', fontSize: 16, fontWeight: '500' },
  spark: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 0.64,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 16 },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: HomeColors.iconTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 24, fontWeight: '600', color: '#fff' },
  meta: { color: '#fff', fontSize: 12, marginTop: 8, marginBottom: 16 },
  error: { color: '#FECACA', fontSize: 16 },
  notice: { color: '#fff', marginTop: 8 },
});
