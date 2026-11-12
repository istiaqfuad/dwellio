import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';
import { BackButton, Button, Card, Field, Row, Screen, SectionTitle, Subtitle, Title, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import { db } from '@/lib/firebase';

export default function ProfileScreen() {
  const p = usePalette();
  const { user, logOut } = useAuth();
  const { households, selectHousehold, active } = useHousehold();
  const [name, setName] = useState(user?.displayName ?? '');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [nameError, setNameError] = useState('');

  async function run(key: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!user) return;
    if (!name.trim()) {
      setNameError('Type a display name first.');
      return;
    }
    setNameError('');
    setSaved(false);
    await updateDoc(doc(db, 'users', user.uid), { displayName: name.trim() });
    setSaved(true);
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 64 }}>
        <BackButton />
        <Title>Profile</Title>
        <Subtitle>{user?.email ?? ''}</Subtitle>

        <SectionTitle>Display name</SectionTitle>
        <Card>
          <Field
            label="How should housemates see you?"
            value={name}
            onChangeText={(v) => {
              setNameError('');
              setSaved(false);
              setName(v);
            }}
          />
          {nameError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{nameError}</Text> : null}
          <Button label="Save" onPress={() => run('save', save)} variant="ghost" loading={busy === 'save'} />
          {saved ? <Text style={{ color: p.primary, marginTop: 6 }}>Saved.</Text> : null}
        </Card>

        <SectionTitle>Your households</SectionTitle>
        {households.map((h) => (
          <Pressable key={h.id} onPress={() => selectHousehold(h.id)}>
            <Card style={active?.id === h.id ? { borderColor: p.primary } : undefined}>
              <Row>
                <Text style={{ flex: 1, color: p.ink, fontWeight: '600' }}>{h.name}</Text>
                {active?.id === h.id ? <Text style={{ color: p.primary }}>Current</Text> : null}
              </Row>
            </Card>
          </Pressable>
        ))}
        <Link href="/join-household" asChild>
          <Pressable
            style={{ borderWidth: 1, borderColor: p.line, borderRadius: 10, padding: 13, alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: p.primary, fontWeight: '700' }}>Join with an invite code</Text>
          </Pressable>
        </Link>
        <Link href="/create-household" asChild>
          <Pressable
            style={{ borderWidth: 1, borderColor: p.line, borderRadius: 10, padding: 13, alignItems: 'center' }}>
            <Text style={{ color: p.primary, fontWeight: '700' }}>Create another household</Text>
          </Pressable>
        </Link>

        <SectionTitle>Session</SectionTitle>
        <Button label="Sign out" onPress={() => run('signout', () => logOut())} variant="danger" loading={busy === 'signout'} />
      </ScrollView>
    </Screen>
  );
}
