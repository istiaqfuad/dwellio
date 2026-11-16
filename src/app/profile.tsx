import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, updateDoc } from 'firebase/firestore';
import { BackButton, Button, Card, Field, Row, Screen, SectionTitle, Subtitle, Title, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import { db } from '@/lib/firebase';
import { PUSH_OPT_OUT_KEY, registerPushToken, unregisterPushToken } from '@/lib/push';

export default function ProfileScreen() {
  const p = usePalette();
  const { user, logOut } = useAuth();
  const { households, selectHousehold, active } = useHousehold();
  const [name, setName] = useState(user?.displayName ?? '');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [nameError, setNameError] = useState('');
  const [pushOn, setPushOn] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(PUSH_OPT_OUT_KEY)
      .then((v) => setPushOn(v !== '1'))
      .catch(() => {});
  }, []);

  async function togglePush(next: boolean) {
    setPushOn(next);
    if (!user) return;
    if (next) {
      await AsyncStorage.removeItem(PUSH_OPT_OUT_KEY).catch(() => {});
      for (const h of households) {
        await registerPushToken(h.id, user.uid);
      }
    } else {
      await AsyncStorage.setItem(PUSH_OPT_OUT_KEY, '1').catch(() => {});
      for (const h of households) {
        await unregisterPushToken(h.id, user.uid);
      }
    }
  }

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
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 64 }}>
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

        <SectionTitle>Notifications</SectionTitle>
        <Card>
          <Row gap={12}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: p.ink, fontSize: 15 }}>Push notifications</Text>
              <Text style={{ fontSize: 13, color: p.muted, marginTop: 2 }}>
                Payment requests, task assignments and announcements.
              </Text>
            </View>
            <Switch
              value={pushOn}
              onValueChange={(next) => run('push', () => togglePush(next))}
              disabled={busy === 'push'}
              trackColor={{ false: p.line, true: p.primary }}
              thumbColor={pushOn ? p.primaryInk : p.muted}
              ios_backgroundColor={p.line}
              style={{ opacity: busy === 'push' ? 0.5 : 1 }}
            />
          </Row>
        </Card>

        <SectionTitle>Session</SectionTitle>
        <Button label="Sign out" onPress={() => run('signout', () => logOut())} variant="danger" loading={busy === 'signout'} />
      </ScrollView>
    </Screen>
  );
}
