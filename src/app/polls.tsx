import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { BackButton, Button, Card, EmptyState, Field, Row, Screen, SectionTitle, Subtitle, Title, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import { useCollection } from '@/lib/use-collection';
import { db } from '@/lib/firebase';
import type { Poll } from '@/lib/models';

export default function PollsScreen() {
  const p = usePalette();
  const { user } = useAuth();
  const { active, members, isAdmin, logActivity } = useHousehold();
  const hid = active?.id ?? '';
  const { items: polls } = useCollection<Poll>(`households/${hid}/polls`, [], !!hid);

  const [title, setTitle] = useState('');
  const [options, setOptions] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  async function run(key: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  const nameOf = (uid: string) => members.find((m) => m.id === uid)?.displayName ?? 'Member';

  if (!active) {
    return (
      <Screen>
        <Title>Polls</Title>
        <Subtitle>Join or create a household first.</Subtitle>
      </Screen>
    );
  }

  async function createPoll() {
    if (!user) return;
    if (!title.trim()) {
      setFormError('Ask a question first.');
      return;
    }
    const opts = options.split('\n').map((o) => o.trim()).filter(Boolean).slice(0, 8);
    if (opts.length < 2) {
      setFormError('Add at least two options, one per line.');
      return;
    }
    setFormError('');
    await addDoc(collection(db, 'households', hid, 'polls'), {
      title: title.trim(),
      options: opts,
      votes: {},
      anonymous,
      allowChange: true,
      open: true,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
    await logActivity('poll', `${user.displayName ?? 'Someone'} started a poll: ${title.trim()}`);
    setTitle('');
    setOptions('');
    setShowForm(false);
  }

  async function vote(poll: Poll, idx: number) {
    if (!user || !poll.open) return;
    if (!poll.allowChange && poll.votes[user.uid] !== undefined) return;
    await updateDoc(doc(db, 'households', hid, 'polls', poll.id), {
      votes: { ...poll.votes, [user.uid]: idx },
    });
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 64 }}>
        <BackButton />
        <Title>Polls</Title>
        <Subtitle>Settle debates with a vote, not a group chat flood.</Subtitle>
        <Text style={{ height: 12 }} />

        {polls.length === 0 ? (
          <EmptyState title="No polls yet" hint="Ask the house: new sofa, trip dates, dinner rules." />
        ) : (
          [...polls].sort((a, b) => b.createdAt - a.createdAt).map((poll) => {
            const counts = poll.options.map((_, i) => Object.values(poll.votes).filter((v) => v === i).length);
            const total = Object.keys(poll.votes).length;
            return (
              <Card key={poll.id}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: p.ink, fontSize: 16 }}>{poll.title}</Text>
                    <Text style={{ fontSize: 13, color: p.muted }}>
                      {total} votes · {poll.anonymous ? 'anonymous' : 'names visible'} · {poll.open ? 'open' : 'closed'}
                    </Text>
                  </View>
                  {(poll.createdBy === user?.uid || isAdmin) && poll.open ? (
                    <Button
                      label="Close"
                      onPress={() => run(`close-${poll.id}`, () => updateDoc(doc(db, 'households', hid, 'polls', poll.id), { open: false }) as Promise<void>)}
                      variant="ghost"
                      size="sm"
                      loading={busy === `close-${poll.id}`}
                    />
                  ) : null}
                  {isAdmin ? (
                    <Button
                      label="Delete"
                      onPress={() =>
                        run(`del-${poll.id}`, async () => {
                          await deleteDoc(doc(db, 'households', hid, 'polls', poll.id));
                          await logActivity('poll', 'A poll was removed by an admin');
                        })
                      }
                      variant="danger"
                      size="sm"
                      loading={busy === `del-${poll.id}`}
                    />
                  ) : null}
                </Row>
                <Text style={{ height: 8 }} />
                {poll.options.map((opt, i) => (
                  <Pressable key={i} onPress={() => vote(poll, i)} disabled={!poll.open}>
                    <View style={{ marginBottom: 6, borderWidth: 1, borderColor: poll.votes[user?.uid ?? ''] === i ? p.primary : p.line, borderRadius: 10, padding: 10 }}>
                      <Row>
                        <Text style={{ flex: 1, color: p.ink, fontWeight: poll.votes[user?.uid ?? ''] === i ? '700' : '400' }}>{opt}</Text>
                        <Text style={{ color: p.muted }}>{counts[i]}</Text>
                      </Row>
                    </View>
                  </Pressable>
                ))}
                {!poll.anonymous && (
                  <Text style={{ fontSize: 12, color: p.muted }}>
                    {Object.entries(poll.votes).map(([uid, v]) => `${nameOf(uid)}: ${poll.options[v]}`).join('   ')}
                  </Text>
                )}
              </Card>
            );
          })
        )}

        <SectionTitle>New poll</SectionTitle>
        <Button label={showForm ? 'Close' : 'Start a poll'} onPress={() => setShowForm(!showForm)} variant={showForm ? 'ghost' : 'primary'} />
        {showForm && (
          <Card style={{ marginTop: 10 }}>
            <Field
              label="Question"
              value={title}
              onChangeText={(v) => {
                setFormError('');
                setTitle(v);
              }}
              placeholder="Which day for deep cleaning?"
            />
            <Field
              label="Options (one per line)"
              value={options}
              onChangeText={(v) => {
                setFormError('');
                setOptions(v);
              }}
              placeholder={'Friday\nSaturday\nSunday'}
              multiline
              numberOfLines={4}
            />
            <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginBottom: 6 }}>Voting style</Text>
            <Row gap={8}>
              {([true, false] as const).map((v) => (
                <Pressable
                  key={String(v)}
                  onPress={() => setAnonymous(v)}
                  style={{
                    paddingVertical: 7,
                    paddingHorizontal: 14,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: anonymous === v ? p.primary : p.line,
                    backgroundColor: anonymous === v ? `${p.primary}1F` : 'transparent',
                  }}>
                  <Text style={{ color: anonymous === v ? p.primary : p.ink, fontWeight: '600', fontSize: 13 }}>
                    {v ? 'Anonymous' : 'Names visible'}
                  </Text>
                </Pressable>
              ))}
            </Row>
            <Text style={{ height: 10 }} />
            {formError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{formError}</Text> : null}
            <Button label="Publish poll" onPress={() => run('publish', createPoll)} loading={busy === 'publish'} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
