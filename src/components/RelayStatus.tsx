import { StyleSheet, Text, View } from 'react-native';

import type { ClaimUiState } from '@/types/relay';

type Props = {
  status: ClaimUiState;
};

export function RelayStatus({ status }: Props) {
  if (status.kind === 'unclaimed') {
    return (
      <View>
        <Text style={styles.headline}>New voice note</Text>
        <Text style={styles.body}>First person to claim it gets to listen.</Text>
      </View>
    );
  }
  if (status.kind === 'claimed_by_me') {
    return (
      <View>
        <Text style={styles.headline}>You got it</Text>
        <Text style={styles.body}>You claimed this message. Listen, then respond.</Text>
      </View>
    );
  }
  if (status.kind === 'claimed_by_other') {
    return (
      <View>
        <Text style={styles.headline}>Too slow</Text>
        <Text style={styles.body}>
          {status.claimantName ?? 'Someone'} claimed this one. You&apos;ll hear it later.
        </Text>
      </View>
    );
  }
  if (status.kind === 'own_message') {
    return (
      <View>
        <Text style={styles.headline}>You sent this</Text>
        <Text style={styles.body}>You cannot respond to yourself. Wait for someone else.</Text>
      </View>
    );
  }
  if (status.kind === 'too_soon') {
    return (
      <View>
        <Text style={styles.headline}>Pass the mic</Text>
        <Text style={styles.body}>
          That was a reply to you. Two other people need to talk before you can go again.
        </Text>
      </View>
    );
  }
  if (status.kind === 'empty') {
    return <Text style={styles.body}>No active voice note in this group yet.</Text>;
  }
  return <Text style={styles.body}>Loading relay…</Text>;
}

const styles = StyleSheet.create({
  headline: { fontSize: 22, fontWeight: '700', marginBottom: 6 },
  body: { fontSize: 16, color: '#374151', lineHeight: 22 },
});
