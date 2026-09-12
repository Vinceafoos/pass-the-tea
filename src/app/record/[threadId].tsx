import {
  RecordingPresets,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MAX_RECORDING_SECONDS } from '@/constants/config';
import { formatDuration, prepareAudioMode, requestMicPermission } from '@/lib/audio';
import { createOpening, createResponse, getThread } from '@/lib/relay';
import { supabase } from '@/lib/supabase';

const Night = {
  bg: '#0B0B16',
  card: '#1A1A2B',
  border: '#2D2D45',
  muted: '#5A5978',
  dim: '#8B8AA8',
  text: '#F0EDFF',
  orange: '#F5A623',
  mint: '#2DD4A0',
};

const IDLE_DOTS = 32;
const LIVE_BARS = [86, 43, 70, 46, 39, 47, 22, 63];

export default function RecordScreen() {
  const { threadId, groupId, opening } = useLocalSearchParams<{
    threadId: string;
    groupId?: string;
    opening?: string;
  }>();
  const isOpening = opening === '1';
  const router = useRouter();
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    numberOfChannels: 1,
  });
  const recorderState = useAudioRecorderState(recorder, 50);
  const [prepared, setPrepared] = useState(false);
  const [hasClip, setHasClip] = useState(false);
  const [atLimit, setAtLimit] = useState(false);
  const [lockedElapsed, setLockedElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [groupName, setGroupName] = useState('Group');
  const [usedSlots, setUsedSlots] = useState(0);
  const busyRef = useRef(false);
  const atLimitRef = useRef(false);

  useEffect(() => {
    void prepareAudioMode();
  }, []);

  useEffect(() => {
    if (!threadId) return;
    void getThread(threadId).then(async (thread) => {
      if (!thread) return;
      setUsedSlots(Math.min(3, thread.consecutive_claims ?? 0));
      const { data } = await supabase
        .from('groups')
        .select('name')
        .eq('id', thread.group_id)
        .maybeSingle();
      if (data?.name) setGroupName(data.name);
    });
  }, [threadId]);

  async function lockAtLimit() {
    if (atLimitRef.current) return;
    atLimitRef.current = true;
    const elapsedSec = Math.min(
      MAX_RECORDING_SECONDS,
      recorder.getStatus().durationMillis / 1000,
    );
    setLockedElapsed(elapsedSec);
    setAtLimit(true);
    setHasClip(true);
    try {
      if (recorder.isRecording) {
        await recorder.stop();
      } else if (recorder.uri) {
        await recorder.stop();
      }
    } catch {
      /* already stopped by forDuration */
    }
    setPrepared(false);
  }

  useEffect(() => {
    if (recorderState.durationMillis / 1000 >= MAX_RECORDING_SECONDS) {
      void lockAtLimit();
    }
  }, [recorderState.durationMillis]);

  async function ensurePrepared() {
    if (prepared) return true;
    const granted = await requestMicPermission();
    if (!granted) {
      setError('Microphone permission is required.');
      return false;
    }
    await prepareAudioMode();
    await recorder.prepareToRecordAsync();
    setPrepared(true);
    return true;
  }

  async function toggleRecording() {
    if (busyRef.current || atLimitRef.current || sending) return;
    busyRef.current = true;
    setError(null);
    try {
      const status = recorder.getStatus();
      if (status.isRecording) {
        recorder.pause();
        setHasClip(true);
        if (status.durationMillis / 1000 >= MAX_RECORDING_SECONDS) {
          await lockAtLimit();
        }
        return;
      }
      const remaining = MAX_RECORDING_SECONDS - status.durationMillis / 1000;
      if (remaining <= 0.05) {
        await lockAtLimit();
        return;
      }
      const ok = await ensurePrepared();
      if (!ok || atLimitRef.current) return;
      const latest = recorder.getStatus();
      const leftover = MAX_RECORDING_SECONDS - latest.durationMillis / 1000;
      if (leftover <= 0.05) {
        await lockAtLimit();
        return;
      }
      recorder.record({ forDuration: leftover });
    } finally {
      busyRef.current = false;
    }
  }

  async function send() {
    if (!threadId) {
      setError('Missing thread. Open Record after claiming.');
      return;
    }
    if (recorder.isRecording) {
      await recorder.stop();
      setHasClip(true);
    } else if (hasClip && recorder.uri && prepared) {
      try {
        await recorder.stop();
      } catch {
        /* already finalized */
      }
    }
    const uri = recorder.uri;
    if (!uri) {
      setError('Tap the mic to record first.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const result = isOpening
        ? await createOpening({ threadId, groupId, localAudioUri: uri })
        : await createResponse({ threadId, groupId, localAudioUri: uri });
      if (!result.success) throw new Error(result.reason);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  const elapsed = Math.min(
    MAX_RECORDING_SECONDS,
    lockedElapsed ?? recorderState.durationMillis / 1000,
  );
  const remaining = Math.max(0, MAX_RECORDING_SECONDS - elapsed);
  const progress = Math.min(1, elapsed / MAX_RECORDING_SECONDS);
  const canSend = hasClip || recorderState.isRecording || atLimit;
  const liveBars = Math.max(1, Math.round(progress * IDLE_DOTS));
  const hint = atLimit
    ? "Time's up · ✓ to send"
    : recorderState.isRecording
      ? 'Recording… tap to pause'
      : hasClip
        ? 'Tap to resume · ✓ to send'
        : 'Tap to start · tap again to pause · ✓ to send';

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <Pressable style={styles.iconBtn} onPress={() => router.back()}>
          <Text style={styles.iconBtnLabel}>←</Text>
        </Pressable>
        <View style={styles.centerTitle}>
          <Text style={styles.group}>{groupName}</Text>
          <Text style={styles.replyLabel}>YOUR REPLY</Text>
        </View>
        <Pressable
          style={[styles.iconBtn, canSend ? styles.sendOn : styles.sendOff]}
          disabled={!canSend || sending}
          onPress={() => void send()}>
          <Text style={[styles.check, canSend && styles.checkOn]}>{sending ? '…' : '✓'}</Text>
        </Pressable>
      </View>

      <View style={styles.allowance}>
        <View style={styles.allowanceRow}>
          <Text style={styles.allowanceLabel}>RELAY ALLOWANCE</Text>
          <Text style={styles.allowanceValue}>{usedSlots} / 3 used</Text>
        </View>
        <View style={styles.slots}>
          {[0, 1, 2].map((index) => (
            <View
              key={index}
              style={[styles.slot, index < usedSlots && styles.slotUsed]}
            />
          ))}
        </View>
      </View>

      <View style={styles.timerWrap}>
        <View style={styles.timerPill}>
          <Text style={styles.timer}>{formatDuration(remaining)}</Text>
        </View>
      </View>

      <View style={styles.stage}>
        <View style={styles.waveRow}>
          {Array.from({ length: IDLE_DOTS }).map((_, index) => {
            const active = recorderState.isRecording && index < liveBars;
            const recorded = !recorderState.isRecording && hasClip && index < liveBars;
            const height =
              active || recorded ? LIVE_BARS[index % LIVE_BARS.length] : 5;
            return (
              <View
                key={index}
                style={[
                  styles.dot,
                  (active || recorded) && styles.dotLive,
                  { height, width: 5 },
                ]}
              />
            );
          })}
        </View>
        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
        <View style={styles.times}>
          <Text style={styles.time}>0:00</Text>
          {hasClip || recorderState.isRecording ? (
            <Text style={styles.time}>{elapsed.toFixed(1)}s recorded</Text>
          ) : (
            <View />
          )}
          <Text style={styles.time}>0:10</Text>
        </View>

        <Pressable
          disabled={atLimit || sending}
          onPress={() => void toggleRecording()}
          style={({ pressed }) => [
            styles.mic,
            recorderState.isRecording && styles.micLive,
            atLimit && styles.micLocked,
            pressed && !atLimit && styles.micHeld,
          ]}>
          <Text style={styles.micGlyph}>🎙</Text>
        </Pressable>
        <Text style={styles.hint}>{hint}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Night.bg, paddingHorizontal: 20 },
  top: { flexDirection: 'row', alignItems: 'center', paddingTop: 8, marginBottom: 16 },
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
  sendOff: { opacity: 0.3 },
  sendOn: { backgroundColor: Night.mint, borderColor: Night.mint, opacity: 1 },
  check: { color: Night.muted, fontWeight: '700', fontSize: 14 },
  checkOn: { color: Night.bg },
  centerTitle: { flex: 1, alignItems: 'center' },
  group: { fontSize: 12, color: Night.muted },
  replyLabel: { fontSize: 11, color: Night.mint, marginTop: 2 },
  allowance: {
    backgroundColor: Night.card,
    borderWidth: 0.64,
    borderColor: Night.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  allowanceRow: { flexDirection: 'row', justifyContent: 'space-between' },
  allowanceLabel: { fontSize: 12, color: Night.dim },
  allowanceValue: { fontSize: 12, color: Night.mint, fontWeight: '500' },
  slots: { flexDirection: 'row', gap: 6, marginTop: 8 },
  slot: { flex: 1, height: 6, borderRadius: 99, backgroundColor: Night.border },
  slotUsed: { backgroundColor: Night.mint },
  timerWrap: { alignItems: 'center', marginBottom: 8 },
  timerPill: {
    backgroundColor: Night.card,
    borderWidth: 0.64,
    borderColor: Night.border,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  timer: { fontSize: 30, color: Night.text, fontWeight: '500' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 96,
    width: '100%',
    marginBottom: 24,
  },
  dot: { width: 5, height: 5, borderRadius: 99, backgroundColor: Night.border },
  dotLive: { backgroundColor: 'rgba(245,166,35,0.5)' },
  track: {
    height: 6,
    width: '100%',
    backgroundColor: Night.border,
    borderRadius: 99,
    overflow: 'hidden',
  },
  trackFill: { height: 6, backgroundColor: Night.orange },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 4,
    marginBottom: 28,
  },
  time: { fontSize: 11, color: Night.muted },
  mic: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Night.orange,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Night.orange,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  micHeld: { transform: [{ scale: 0.96 }] },
  micLive: { backgroundColor: Night.mint, shadowColor: Night.mint },
  micLocked: { opacity: 0.35, backgroundColor: Night.card, shadowOpacity: 0 },
  micGlyph: { fontSize: 30 },
  hint: { color: Night.muted, fontSize: 12, textAlign: 'center', marginTop: 20 },
  error: { color: '#F87171', marginTop: 12, textAlign: 'center' },
});
