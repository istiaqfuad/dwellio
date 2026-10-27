import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Tabs } from 'expo-router';
import { usePalette } from '@/components/ui';

type FeatherName = ComponentProps<typeof Feather>['name'];
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const TABS: { name: string; label: string; icon: FeatherName }[] = [
  { name: 'index', label: 'Home', icon: 'home' },
  { name: 'expenses', label: 'Expenses', icon: 'credit-card' },
  { name: 'meals', label: 'Meals', icon: 'coffee' },
  { name: 'groceries', label: 'Groceries', icon: 'shopping-cart' },
  { name: 'more', label: 'More', icon: 'menu' },
];

export function BottomTabBar({ state, descriptors, emitter, navigateToTab, insets }: TabBarProps) {
  const p = usePalette();
  const ordered = TABS.map((t) => state.routes.findIndex((r) => r.name === t.name)).filter(
    (i) => i >= 0,
  );

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: p.card,
          borderColor: p.line,
          bottom: Math.max(insets.bottom, 8) + 10,
          shadowColor: '#000',
        },
      ]}>
      {ordered.map((routeIndex) => {
        const route = state.routes[routeIndex]!;
        const tab = TABS.find((t) => t.name === route.name)!;
        const focused = state.index === routeIndex;
        const label = descriptors[route.key]?.options.title ?? tab.label;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            onPress={() => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                navigateToTab(route.key);
              }
            }}
            style={[styles.item, focused && { backgroundColor: `${p.primary}1F` }]}>
            <Feather name={tab.icon} size={22} color={focused ? p.primary : p.muted} />
            <Text
              style={{
                fontSize: 11,
                fontWeight: focused ? '700' : '500',
                color: focused ? p.primary : p.muted,
                marginTop: 3,
              }}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 560,
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 24,
    paddingVertical: 6,
    paddingHorizontal: 6,
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 16,
  },
});
