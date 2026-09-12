import { StyleSheet, Text, View } from 'react-native';

type Props = {
  groupName: string;
  senderName?: string | null;
  sentAt?: string | null;
  statusLabel: string;
};

export function ActiveMessageCard({ groupName, senderName, sentAt, statusLabel }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>{groupName}</Text>
      <Text style={styles.title}>Current relay</Text>
      <Text style={styles.row}>Sender: {senderName ?? 'Unknown'}</Text>
      <Text style={styles.row}>Time sent: {sentAt ? new Date(sentAt).toLocaleString() : '—'}</Text>
      <Text style={styles.row}>Status: {statusLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F3F4F6',
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  kicker: { fontSize: 13, color: '#6B7280', textTransform: 'uppercase' },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  row: { fontSize: 16, color: '#111827' },
});
