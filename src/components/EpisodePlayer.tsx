import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EPISODE_GAP_MS } from '@/constants/config';
import { HomeColors } from '@/constants/homeTheme';
import { formatDuration } from '@/lib/audio';

export type EpisodeTrack = {
  url: string;
  label: string;
};

type Props = {
  tracks: EpisodeTrack[];
};

function Clip({
  uri,
  onFinished,
}: {
  uri: string;
  onFinished: () => void;
}) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const started = useRef(false);
  const finished = useRef(false);

  useEffect(() => {
    started.current = false;
    finished.current = false;
    player.play();
  }, [uri, player]);

  useEffect(() => {
    if (status.playing) started.current = true;
  }, [status.playing]);

  useEffect(() => {
    if (!started.current || finished.current) return;
    const atEnd =
      status.didJustFinish ||
      ((status.duration ?? 0) > 0 &&
        !status.playing &&
        (status.currentTime ?? 0) >= (status.duration ?? 0) - 0.2);
    if (!atEnd) return;
    finished.current = true;
    onFinished();
  }, [
    status.didJustFinish,
    status.playing,
    status.currentTime,
    status.duration,
    onFinished,
  ]);

  async function toggle() {
    if (status.playing) {
      player.pause();
      return;
    }
    player.play();
  }

  return (
    <>
      <Pressable style={styles.button} onPress={() => void toggle()}>
        <Text style={styles.buttonLabel}>{status.playing ? '❚❚' : '▶'}</Text>
      </Pressable>
      <Text style={styles.time}>
        {formatDuration(status.currentTime ?? 0)} / {formatDuration(status.duration ?? 0)}
      </Text>
    </>
  );
}

export function EpisodePlayer({ tracks }: Props) {
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);
  indexRef.current = index;

  function startShow() {
    setIndex(0);
    indexRef.current = 0;
    setDone(false);
    setRunning(true);
  }

  const onClipFinished = useCallback(() => {
    const from = indexRef.current;
    if (from >= tracks.length - 1) {
      setRunning(false);
      setDone(true);
      return;
    }
    setTimeout(() => {
      if (indexRef.current !== from) return;
      const next = from + 1;
      indexRef.current = next;
      setIndex(next);
    }, EPISODE_GAP_MS);
  }, [tracks.length]);

  if (tracks.length === 0) {
    return <Text style={styles.muted}>No clips in this day yet.</Text>;
  }

  const current = tracks[index];

  return (
    <View style={styles.wrap}>
      <Text style={styles.now}>
        Clip {index + 1} of {tracks.length} · {current?.label}
      </Text>
      {running && current ? (
        <Clip key={`${index}-${current.url}`} uri={current.url} onFinished={onClipFinished} />
      ) : (
        <Pressable style={styles.button} onPress={startShow}>
          <Text style={styles.buttonLabel}>{done ? '▶' : '▶'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 16,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  now: { fontSize: 11, color: '#fff' },
  label: { fontSize: 18, fontWeight: '600' },
  button: {
    backgroundColor: HomeColors.forest,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  buttonLabel: { color: '#fff', fontWeight: '600', fontSize: 16 },
  time: { textAlign: 'center', color: 'rgba(255,255,255,0.85)', fontSize: 11 },
  muted: { color: 'rgba(255,255,255,0.8)' },
});
