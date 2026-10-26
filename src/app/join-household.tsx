import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { BackButton, Button, Screen, Subtitle, Title, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import { joinWithInvite, lookupInvite } from '@/lib/invites';

export default function JoinHouseholdScreen() {
  const p = usePalette();
  const router = useRouter();
  const { user } = useAuth();
  const { selectHousehold } = useHousehold();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function join() {
    if (!user || busy) return;
    const clean = code.trim().toUpperCase();
    if (!clean) {
      setError('Enter the 6 character code your roommate shared.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const found = await lookupInvite(clean);
      if (!found.ok) {
        setError(found.error);
        return;
      }
      const res = await joinWithInvite({
        invite: found.invite,
        uid: user.uid,
        displayName: user.displayName ?? 'Member',
        photoURL: user.photoURL ?? '',
        email: user.email ?? '',
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not join this household.');
        return;
      }
      if (res.joined) {
        try {
          await selectHousehold(found.invite.householdId);
        } catch {
          // households list refreshes on its own; not fatal
        }
        router.replace('/');
      } else {
        setNotice(`Request sent to ${found.invite.householdName}. An admin will approve it soon.`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <BackButton />
        <Text style={{ fontSize: 15, fontWeight: '700', color: p.primary, marginTop: 32 }}>JOIN</Text>
        <Title>Have an invite code?</Title>
        <Subtitle>Enter the 6 character code your roommate shared.</Subtitle>
        <Text style={{ height: 18 }} />
        <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginBottom: 6 }}>Invite code</Text>
        <TextInput
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          placeholder="A3K9QT"
          placeholderTextColor={p.muted}
          style={{
            borderWidth: 1,
            borderColor: error ? p.danger : p.line,
            borderRadius: 12,
            paddingVertical: 13,
            paddingHorizontal: 14,
            fontSize: 22,
            fontWeight: '700',
            letterSpacing: 6,
            textAlign: 'center',
            color: p.ink,
            backgroundColor: p.card,
          }}
        />
        <View style={{ height: 14 }} />
        {error ? <Text style={{ color: p.danger, marginBottom: 8 }}>{error}</Text> : null}
        {notice ? <Text style={{ color: p.primary, marginBottom: 8 }}>{notice}</Text> : null}
        <Button label="Join household" onPress={join} loading={busy} />
      </ScrollView>
    </Screen>
  );
}
