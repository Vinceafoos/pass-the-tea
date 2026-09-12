import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HomeColors } from '@/constants/homeTheme';
import { PODCAST_EMOJIS } from '@/constants/config';
import { useAuth } from '@/hooks/useAuth';
import {
  addPodcastComment,
  getPodcastComments,
  getPodcastReactions,
  togglePodcastReaction,
} from '@/lib/relay';
import { supabase } from '@/lib/supabase';
import type { PodcastCommentView, PodcastReaction } from '@/types/database';

type Props = {
  threadId: string;
};

function formatCommentTime(iso: string) {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function PodcastDiscussion({ threadId }: Props) {
  const { user } = useAuth();
  const [comments, setComments] = useState<PodcastCommentView[]>([]);
  const [reactions, setReactions] = useState<PodcastReaction[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function refresh() {
    const [nextComments, nextReactions] = await Promise.all([
      getPodcastComments(threadId),
      getPodcastReactions(threadId),
    ]);
    setComments(nextComments);
    setReactions(nextReactions);
  }

  useEffect(() => {
    let mounted = true;
    refresh().catch((err) => {
      if (mounted) setError(err instanceof Error ? err.message : 'Could not load discussion');
    });
    return () => {
      mounted = false;
    };
  }, [threadId]);

  useEffect(() => {
    const channel = supabase
      .channel(`podcast-talk:${threadId}:${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'podcast_comments', filter: `thread_id=eq.${threadId}` },
        () => {
          void refresh().catch(() => undefined);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'podcast_reactions', filter: `thread_id=eq.${threadId}` },
        () => {
          void refresh().catch(() => undefined);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [threadId]);

  const counts = useMemo(() => {
    const next: Record<string, { count: number; mine: boolean }> = {};
    for (const emoji of PODCAST_EMOJIS) {
      const matching = reactions.filter((row) => row.emoji === emoji);
      next[emoji] = {
        count: matching.length,
        mine: matching.some((row) => row.user_id === user?.id),
      };
    }
    return next;
  }, [reactions, user?.id]);

  async function onToggle(emoji: string) {
    setError(null);
    try {
      await togglePodcastReaction(threadId, emoji);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not react');
    }
  }

  async function onSend() {
    setSending(true);
    setError(null);
    try {
      await addPodcastComment(threadId, draft);
      setDraft('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not comment');
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.kicker}>REACTIONS</Text>
      <View style={styles.emojiRow}>
        {PODCAST_EMOJIS.map((emoji) => {
          const stat = counts[emoji];
          return (
            <Pressable
              key={emoji}
              onPress={() => void onToggle(emoji)}
              style={[styles.emojiBtn, stat?.mine && styles.emojiMine]}>
              <Text style={styles.emoji}>{emoji}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.sheet}>
        <Text style={styles.commentsLabel}>COMMENTS</Text>
        {comments.length === 0 ? (
          <Text style={styles.muted}>No comments yet. Be the first.</Text>
        ) : (
          comments.map((comment) => (
            <View key={comment.id} style={styles.comment}>
              <View style={styles.avatar}>
                <Text style={styles.avatarLetter}>
                  {comment.display_name.trim().slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.commentBody}>
                <View style={styles.commentMeta}>
                  <Text style={styles.commentName}>{comment.display_name}</Text>
                  <Text style={styles.commentTime}>{formatCommentTime(comment.created_at)}</Text>
                </View>
                <Text style={styles.commentText}>{comment.body}</Text>
              </View>
            </View>
          ))
        )}

        <View style={styles.composer}>
          <TextInput
            placeholder="Add a comment..."
            placeholderTextColor="rgba(80,80,80,0.5)"
            value={draft}
            onChangeText={setDraft}
            style={styles.input}
            maxLength={500}
          />
          <Pressable style={styles.send} onPress={() => void onSend()} disabled={sending}>
            <Text style={styles.sendLabel}>{sending ? '…' : '→'}</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, paddingTop: 8 },
  kicker: {
    fontSize: 12,
    fontWeight: '500',
    color: '#fff',
    letterSpacing: 1.2,
  },
  emojiRow: { flexDirection: 'row', gap: 8, paddingBottom: 8 },
  emojiBtn: {
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderWidth: 0.64,
    borderColor: 'rgba(255,255,255,0.5)',
    width: 43,
    height: 45,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiMine: { backgroundColor: 'rgba(255,255,255,0.85)' },
  emoji: { fontSize: 18 },
  sheet: {
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 12,
    marginHorizontal: -20,
  },
  commentsLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#9A9A9A',
    letterSpacing: 1.2,
  },
  muted: { color: '#6F6F6F', fontSize: 12 },
  comment: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(155,93,229,0.13)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: '#9B5DE5', fontWeight: '700', fontSize: 12 },
  commentBody: { flex: 1, gap: 2 },
  commentMeta: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  commentName: { fontWeight: '600', fontSize: 12 },
  commentTime: { fontSize: 10, color: '#000' },
  commentText: { color: '#6F6F6F', fontSize: 12 },
  composer: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 8 },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 0.64,
    borderColor: '#C4C4C4',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    height: 41,
  },
  send: {
    backgroundColor: HomeColors.forest,
    width: 46,
    height: 41,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendLabel: { color: '#fff', fontSize: 16, fontWeight: '500' },
  error: { color: '#B91C1C' },
});
