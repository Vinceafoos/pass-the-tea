import { Pressable, StyleSheet, Text, View } from 'react-native';

import { InitialStack } from '@/components/InitialStack';
import { HomeColors } from '@/constants/homeTheme';
import type { Profile } from '@/types/database';

export type GroupRowKind = 'claim' | 'waiting' | 'nudge' | 'listen' | 'record' | 'recap';

type Props = {
  name: string;
  members: Profile[];
  kind: GroupRowKind;
  onPress: () => void;
};

const LABELS: Record<GroupRowKind, string> = {
  claim: 'Claim',
  waiting: 'Waiting...',
  nudge: 'Nudge',
  listen: 'Listen',
  record: 'Record',
  recap: 'Recap',
};

export function GroupsRow({ name, members, kind, onPress }: Props) {
  const dashed = kind === 'waiting' || kind === 'nudge';
  const pillColor =
    kind === 'claim' || kind === 'listen' || kind === 'record' || kind === 'recap'
      ? HomeColors.green
      : kind === 'waiting'
        ? HomeColors.waiting
        : HomeColors.nudge;

  return (
    <Pressable onPress={onPress} style={[styles.card, dashed && styles.dashed]}>
      <View style={styles.icon}>
        <Text style={styles.glyph}>🎸</Text>
      </View>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <View style={styles.dot} />
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <InitialStack members={members} />
      </View>
      <View style={[styles.pill, { backgroundColor: pillColor }]}>
        <Text style={styles.pillLabel}>{LABELS[kind]}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: HomeColors.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 8,
    height: 79,
    gap: 8,
    backgroundColor: HomeColors.cream,
  },
  dashed: {
    borderStyle: 'dashed',
  },
  icon: {
    width: 51,
    height: 51,
    borderRadius: 12,
    backgroundColor: HomeColors.iconTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 20 },
  copy: { flex: 1, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: HomeColors.redLive },
  name: { fontSize: 12, fontWeight: '600', color: HomeColors.ink, flex: 1 },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillLabel: { color: '#fff', fontSize: 12, fontWeight: '600' },
  chevron: { fontSize: 18, color: HomeColors.muted, paddingRight: 4 },
});
