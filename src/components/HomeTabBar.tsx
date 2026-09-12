import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeColors } from '@/constants/homeTheme';

export type HomeTab = 'recaps' | 'home' | 'groups' | 'host';

type Props = {
  tab: HomeTab;
  onChange: (tab: HomeTab) => void;
};

export function HomeTabBar({ tab, onChange }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <TabItem
        label="Recaps"
        active={tab === 'recaps'}
        onPress={() => onChange('recaps')}
        ios="play.square.fill"
        android="play_arrow"
        web="play_arrow"
      />
      <TabItem
        label="Home"
        active={tab === 'home'}
        onPress={() => onChange('home')}
        ios="house.fill"
        android="home"
        web="home"
      />
      <TabItem
        label="Groups"
        active={tab === 'groups'}
        onPress={() => onChange('groups')}
        ios="person.2.fill"
        android="group"
        web="group"
      />
      <TabItem
        label="AI Host"
        active={tab === 'host'}
        onPress={() => onChange('host')}
        ios="mic.fill"
        android="mic"
        web="mic"
      />
    </View>
  );
}

function TabItem({
  label,
  active,
  onPress,
  ios,
  android,
  web,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  ios: 'play.square.fill' | 'house.fill' | 'person.2.fill' | 'mic.fill';
  android: 'play_arrow' | 'home' | 'group' | 'mic';
  web: 'play_arrow' | 'home' | 'group' | 'mic';
}) {
  const color = active ? HomeColors.tabActive : HomeColors.tabIdle;
  return (
    <Pressable style={styles.item} onPress={onPress}>
      <SymbolView name={{ ios, android, web }} size={22} tintColor={color} />
      <Text style={[styles.label, { color, opacity: active ? 1 : 0.7 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: HomeColors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HomeColors.tabBorder,
    paddingTop: 12,
  },
  item: { flex: 1, alignItems: 'center', gap: 4 },
  label: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
