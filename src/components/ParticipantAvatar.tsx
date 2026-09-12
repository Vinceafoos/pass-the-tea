import { StyleSheet, Text, View } from 'react-native';

type Props = {
  name: string;
};

export function ParticipantAvatar({ name }: Props) {
  const initial = name.trim().slice(0, 1).toUpperCase() || '?';
  return (
    <View style={styles.circle}>
      <Text style={styles.initial}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { color: '#fff', fontWeight: '700' },
});
