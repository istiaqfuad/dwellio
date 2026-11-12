import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Card, Row, Screen, SectionTitle, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';

const LINKS: { route: string; title: string; hint: string; module?: string }[] = [
  { route: '/household', title: 'Household settings', hint: 'Members, invites and modules' },
  { route: '/tasks', title: 'Tasks and responsibilities', hint: 'Assign, claim and track chores', module: 'tasks' },
  { route: '/bills', title: 'Utility bills', hint: 'Due dates, reminders and history', module: 'bills' },
  { route: '/polls', title: 'Polls and decisions', hint: 'Vote on shared choices', module: 'polls' },
  { route: '/calendar', title: 'Calendar', hint: 'Deadlines and events in one view', module: 'calendar' },
  { route: '/announcements', title: 'Announcements', hint: 'News from admins', module: 'announcements' },
  { route: '/activity', title: 'Activity history', hint: 'Everything that happened' },
  { route: '/reports', title: 'Reports', hint: 'Spending, meals and tasks' },
  { route: '/profile', title: 'Profile', hint: 'Account and preferences' },
];

export default function MoreScreen() {
  const p = usePalette();
  const router = useRouter();
  const { user, logOut } = useAuth();
  const { active } = useHousehold();

  const visible = LINKS.filter((l) => {
    if (!l.module || !active) return true;
    return (active.modules as unknown as Record<string, boolean>)[l.module] !== false;
  });

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 112 }}>
        <Pressable
          onPress={() => router.push('/profile' as never)}
          style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}>
          <Card>
            <Row>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  backgroundColor: p.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Text style={{ color: p.primaryInk, fontWeight: '800', fontSize: 20 }}>
                  {(user?.displayName ?? user?.email ?? 'M').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', color: p.ink, fontSize: 17 }}>{user?.displayName ?? 'Member'}</Text>
                <Text style={{ fontSize: 13, color: p.muted }}>{active?.name ?? user?.email ?? ''}</Text>
              </View>
              <Text style={{ color: p.muted, fontSize: 20 }}>›</Text>
            </Row>
          </Card>
        </Pressable>
        <SectionTitle>Sections</SectionTitle>
        {visible.map((l) => (
          <Pressable
            key={l.route}
            onPress={() => router.push(l.route as never)}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
            <Card>
              <Row>
                <Text style={{ flex: 1, fontWeight: '700', color: p.ink, fontSize: 15 }}>{l.title}</Text>
                <Text style={{ color: p.muted }}>›</Text>
              </Row>
              <Text style={{ fontSize: 13, color: p.muted }}>{l.hint}</Text>
            </Card>
          </Pressable>
        ))}
        <SectionTitle>Session</SectionTitle>
        <Pressable
          onPress={() => logOut()}
          style={{ borderWidth: 1, borderColor: p.line, borderRadius: 10, padding: 13, alignItems: 'center' }}>
          <Text style={{ color: p.danger, fontWeight: '700' }}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
