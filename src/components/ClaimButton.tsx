import { Pressable, StyleSheet, Text } from 'react-native';

type Props = {
  title?: string;
  disabled?: boolean;
  onPress: () => void;
};

export function ClaimButton({ title = 'Claim & Listen', disabled, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text style={styles.label}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#111827',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
  label: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
