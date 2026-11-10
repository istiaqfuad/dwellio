import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { limit, orderBy } from 'firebase/firestore';
import { BackButton, Card, EmptyState, Row, Screen, SectionTitle, Subtitle, Title, usePalette } from '@/components/ui';
import { useHousehold } from '@/lib/household-context';
import { useCollection } from '@/lib/use-collection';
import { formatDateTime, toMillis } from '@/lib/finance';
import type { ActivityEntry } from '@/lib/models';

const KINDS = ['all', 'expense', 'settlement', 'meal', 'grocery', 'task', 'bill', 'poll', 'announcement', 'member', 'household', 'calendar'];

export default function ActivityScreen() {
  const p = usePalette();
  const { active, members } = useHousehold();
  const hid = active?.id ?? '';
  const { items } = useCollection<ActivityEntry>(
    `households/${hid}/activity`,
    [orderBy('createdAt', 'desc'), limit(150)],
    !!hid,
  );
  const [kind, setKind] = useState('all');
  const [who, setWho] = useState('all');

  const nameOf = (uid: string) => members.find((m) => m.id === uid)?.displayName ?? 'Member';

  const filtered = useMemo(
    () =>
      [...items]
        .filter((a) => (kind === 'all' ? true : a.kind === kind))
        .filter((a) => (who === 'all' ? true : a.actorId === who))
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
        .slice(0, 150),
    [items, kind, who],
  );

  if (!active) {
    return (
      <Screen>
        <Title>Activity</Title>
        <Subtitle>Join or create a household first.</Subtitle>
      </Screen>
    );
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 64 }}>
        <BackButton />
        <Title>Activity</Title>
        <Subtitle>Auditable history of what changed and who did it.</Subtitle>
        <SectionTitle>Type</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row gap={8}>
            {KINDS.map((k) => (
              <Pressable
                key={k}
                onPress={() => setKind(k)}
                style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: kind === k ? p.primary : p.surface }}>
                <Text style={{ color: kind === k ? p.primaryInk : p.ink, fontSize: 13 }}>{k}</Text>
              </Pressable>
            ))}
          </Row>
        </ScrollView>
        <SectionTitle>Member</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row gap={8}>
            <Pressable
              onPress={() => setWho('all')}
              style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: who === 'all' ? p.primary : p.surface }}>
              <Text style={{ color: who === 'all' ? p.primaryInk : p.ink, fontSize: 13 }}>Everyone</Text>
            </Pressable>
            {members.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => setWho(m.id)}
                style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: who === m.id ? p.primary : p.surface }}>
                <Text style={{ color: who === m.id ? p.primaryInk : p.ink, fontSize: 13 }}>{m.displayName}</Text>
              </Pressable>
            ))}
          </Row>
        </ScrollView>
        <Text style={{ height: 12 }} />
        {filtered.length === 0 ? (
          <EmptyState title="No matches" hint="Try a different filter." />
        ) : (
          filtered.map((a) => (
            <Card key={a.id}>
              <Text style={{ color: p.ink }}>{a.text}</Text>
              <Text style={{ fontSize: 12, color: p.muted }}>
                {nameOf(a.actorId)} · {a.kind} · {formatDateTime(a.createdAt)}
              </Text>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
