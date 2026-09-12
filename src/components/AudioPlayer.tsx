import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '@/lib/audio';

type Props = {
  uri: string | null;
};

export function AudioPlayer({ uri }: Props) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  if (!uri) {
    return <Text style={styles.muted}>No audio loaded.</Text>;
  }

  const duration = status.duration ?? 0;
  const current = status.currentTime ?? 0;
  const finished =
    Boolean(status.didJustFinish) ||
    (duration > 0 && current >= duration - 0.15 && !status.playing);

  async function togglePlayback() {
    if (status.playing) {
      player.pause();
      return;
    }
    if (finished) {
      await player.seekTo(0);
    }
    player.play();
  }

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.button} onPress={() => void togglePlayback()}>
        <Text style={styles.label}>
          {status.playing ? 'Pause' : finished ? 'Listen again' : 'Play'}
        </Text>
      </Pressable>
      <Text style={styles.time}>
        {formatDuration(current)} / {formatDuration(duration)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  button: {
    backgroundColor: '#111827',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  label: { color: '#fff', fontWeight: '600', fontSize: 16 },
  time: { textAlign: 'center', color: '#374151' },
  muted: { color: '#6B7280' },
});
