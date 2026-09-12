import { Pressable, StyleSheet, Text } from 'react-native';

import { HomeColors } from '@/constants/homeTheme';
import type { RelayAction } from '@/lib/relayAction';

type Props = {
  action: RelayAction;
  claiming?: boolean;
  onPress: () => void;
};

export function RelayClaimButton({ action, claiming, onPress }: Props) {
  const enabled = Boolean(!claiming && action.enabled);
  const label = claiming ? 'Claiming…' : action.label;
  const backgroundColor =
    action.kind === 'waiting'
      ? HomeColors.waiting
      : action.kind === 'nudge'
        ? HomeColors.nudge
        : HomeColors.green;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.claim,
        { backgroundColor },
        pressed && enabled && styles.pressed,
      ]}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  claim: {
    alignSelf: 'center',
    borderRadius: 8,
    width: 250,
    height: 51,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  label: { color: '#FFFFFF', fontSize: 32, fontWeight: '600' },
});
