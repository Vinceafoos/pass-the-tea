import { StyleSheet, View } from 'react-native';

import { MemberAvatar } from '@/components/MemberAvatar';
import type { Profile } from '@/types/database';

/** Bar heights from Figma Group 3 (Home waveform), scaled to ~62px. */
const BAR_HEIGHTS = [
  26, 62, 28, 20, 62, 33, 39, 21, 47, 6, 35, 27, 28, 24, 33, 13, 26, 24, 30, 44, 33, 20, 47, 41,
  37, 24, 30, 16, 59, 48, 53, 44, 24, 59, 62, 37, 47, 16, 51, 26,
];

const RING_SLOTS = [
  { top: 12, left: 18 },
  { top: 8, right: 12 },
  { bottom: 40, right: 2 },
  { bottom: 12, left: 32 },
];

type Props = {
  members: Profile[];
};

export function WaveformBurst({ members }: Props) {
  const shown = members.slice(0, 4);
  return (
    <View style={styles.stage}>
      <View style={styles.blobGlow} />
      <View style={styles.blob} />
      <View style={styles.wave}>
        {BAR_HEIGHTS.map((height, index) => (
          <View key={index} style={[styles.bar, { height }]} />
        ))}
      </View>
      {shown.map((member, index) => (
        <View key={member.id} style={[styles.slot, RING_SLOTS[index]]}>
          <MemberAvatar
            name={member.display_name}
            uri={member.avatar_url}
            size={index === 2 ? 66 : 78}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    height: 300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blobGlow: {
    position: 'absolute',
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(237, 220, 190, 0.45)',
  },
  blob: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: '#E8D5B5',
  },
  wave: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2.5,
    height: 62,
    zIndex: 1,
  },
  bar: {
    width: 3.5,
    borderRadius: 8,
    backgroundColor: '#264E36',
  },
  slot: {
    position: 'absolute',
    zIndex: 2,
  },
});
