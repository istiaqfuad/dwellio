import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { BackButton, Button, Card, EmptyState, Field, Screen, SectionTitle, Subtitle, Title, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import { useCollection } from '@/lib/use-collection';
import { db } from '@/lib/firebase';

interface CalEvent {
  id: string;
  title: string;
  date: number;
  note?: string;
  createdBy?: string;
}

interface Dated {
  id: string;
  title: string;
  date: number;
  tag: string;
}

export default function CalendarScreen() {
  const p = usePalette();
  const { user } = useAuth();
  const { active, members, logActivity } = useHousehold();
  const hid = active?.id ?? '';
  const { items: events } = useCollection<CalEvent>(`households/${hid}/events`, [], !!hid);
  const { items: bills } = useCollection<Dated>(`households/${hid}/bills`, [], !!hid);
  const { items: tasks } = useCollection<Dated & { deadline?: number }>(`households/${hid}/tasks`, [], !!hid);
  const { items: assignments } = useCollection<Dated & { shopperUid?: string; date: number }>(`households/${hid}/assignments`, [], !!hid);

  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const upcoming = useMemo(() => {
    const now = Date.now();
    const out: (Dated & { sub?: string })[] = [];
    bills.forEach((b) => {
      if (b.date >= now - 86400000) out.push({ ...b, tag: 'Bill due' });
    });
    tasks.forEach((t) => {
      if (t.deadline && t.deadline >= now - 86400000) out.push({ id: t.id, title: t.title, date: t.deadline, tag: 'Task' });
    });
    assignments.forEach((a) => {
      const who = a.shopperUid ? members.find((m) => m.id === a.shopperUid)?.displayName ?? 'Member' : '';
      if (a.date >= now - 86400000) out.push({ id: a.id, title: `Shopping: ${who}`, date: a.date, tag: 'Shopping' });
    });
    events.forEach((e) => {
      if (e.date >= now - 86400000) out.push({ ...e, tag: 'Event' });
    });
    return out.sort((a, b) => a.date - b.date).slice(0, 40);
  }, [bills, tasks, assignments, events, members]);

  if (!active) {
    return (
      <Screen>
        <Title>Calendar</Title>
        <Subtitle>Join or create a household first.</Subtitle>
      </Screen>
    );
  }

  async function addEvent() {
    if (!user || busy) return;
    if (!title.trim()) {
      setFormError('Name the event first.');
      return;
    }
    if (!date.trim()) {
      setFormError('Pick a date (YYYY-MM-DD).');
      return;
    }
    const ts = new Date(`${date.trim()}T12:00:00`).getTime();
    if (Number.isNaN(ts)) {
      setFormError('That date does not look valid. Use YYYY-MM-DD.');
      return;
    }
    setFormError('');
    setBusy(true);
    try {
      await addDoc(collection(db, 'households', hid, 'events'), {
        title: title.trim(),
        date: ts,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      await logActivity('calendar', `${user.displayName ?? 'Someone'} added event: ${title.trim()}`);
      setTitle('');
      setDate('');
    } finally {
      setBusy(false);
    }
  }

  let lastDay = '';
  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 64 }}>
        <BackButton />
        <Title>Calendar</Title>
        <Subtitle>Deadlines, dues and plans in one place.</Subtitle>
        <SectionTitle>Upcoming</SectionTitle>
        {upcoming.length === 0 ? (
          <EmptyState title="Nothing scheduled" hint="Bills, task deadlines and events will appear here." />
        ) : (
          upcoming.map((e) => {
            const day = new Date(e.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            const header = day !== lastDay ? ((lastDay = day), true) : false;
            return (
              <View key={`${e.tag}-${e.id}`}>
                {header ? <Text style={{ fontWeight: '700', marginTop: 12, marginBottom: 4 }}>{day}</Text> : null}
                <Card>
                  <Text style={{ fontWeight: '700' }}>{e.title}</Text>
                  <Text style={{ fontSize: 13, color: '#5D6C61' }}>{e.tag}</Text>
                </Card>
              </View>
            );
          })
        )}
        <SectionTitle>Add event</SectionTitle>
        <Card>
          <Field
            label="Title"
            value={title}
            onChangeText={(v) => {
              setFormError('');
              setTitle(v);
            }}
            placeholder="Landlord visit"
          />
          <Field
            label="Date (YYYY-MM-DD)"
            value={date}
            onChangeText={(v) => {
              setFormError('');
              setDate(v);
            }}
            placeholder="2026-07-20"
          />
          {formError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{formError}</Text> : null}
          <Button label="Add to calendar" onPress={addEvent} variant="ghost" loading={busy} />
        </Card>
      </ScrollView>
    </Screen>
  );
}
