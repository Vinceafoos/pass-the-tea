import { StyleSheet, Text, View } from 'react-native';

import { INITIAL_CHIPS } from '@/constants/homeTheme';
import type { Profile } from '@/types/database';

type Props = {
  members: Profile[];
};

export function InitialStack({ members }: Props) {
  return (
    <View style={styles.row}>
      {members.slice(0, 4).map((member, index) => {
        const chip = INITIAL_CHIPS[index % INITIAL_CHIPS.length];
        return (
          <View
            key={member.id}
            style={[
              styles.chip,
              { backgroundColor: chip.bg, marginLeft: index === 0 ? 0 : -4 },
            ]}>
            <Text style={[styles.letter, { color: chip.fg }]}>
              {member.display_name.trim().slice(0, 1).toUpperCase() || '?'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  chip: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 0.64,
    borderColor: '#0B0B16',
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: { fontSize: 9, fontWeight: '700' },
});
