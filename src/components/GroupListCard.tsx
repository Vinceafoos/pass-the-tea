import { Pressable, StyleSheet, Text, View } from 'react-native';

import { InitialStack } from '@/components/InitialStack';
import { HomeColors } from '@/constants/homeTheme';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import type { Profile } from '@/types/database';

type Props = {
  name: string;
  members: Profile[];
  currentUserId?: string;
  activityAt: string | null;
  live?: boolean;
  selected?: boolean;
  onPress: () => void;
};

function memberLine(members: Profile[], currentUserId?: string) {
  return members
    .map((member) => (member.id === currentUserId ? 'You' : member.display_name.split(' ')[0]))
    .join(', ');
}

export function GroupListCard({
  name,
  members,
  currentUserId,
  activityAt,
  live,
  selected,
  onPress,
}: Props) {
  return (
    <Pressable onPress={onPress} style={[styles.card, selected && styles.selected]}>
      <View style={styles.icon}>
        <Text style={styles.glyph}>🎸</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          {live ? <View style={[styles.dot, { backgroundColor: HomeColors.green }]} /> : null}
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.time}>{formatRelativeTime(activityAt)}</Text>
        </View>
        <View style={styles.meta}>
          <Text style={styles.names} numberOfLines={1}>
            {memberLine(members, currentUserId)}
          </Text>
          <InitialStack members={members} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: HomeColors.card,
    borderRadius: 10,
    padding: 8,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: HomeColors.cardBorder,
  },
  selected: {
    borderColor: HomeColors.green,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: HomeColors.iconTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 20 },
  body: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { flex: 1, fontSize: 15, fontWeight: '600', color: HomeColors.ink },
  time: { color: HomeColors.muted, fontSize: 11 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  names: { flex: 1, color: HomeColors.names, fontSize: 11 },
});
