import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BackButton, Button, Card, Loading, Screen, Subtitle, Title, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import { joinWithInvite, lookupInvite, type InviteInfo } from '@/lib/invites';

export function generateStaticParams(): { code: string }[] {
  return [];
}

export default function JoinViaLinkScreen() {
  const p = usePalette();
  const router = useRouter();
  const { user } = useAuth();
  const { selectHousehold } = useHousehold();
  const { code } = useLocalSearchParams<{ code?: string | string[] }>();
  const raw = Array.isArray(code) ? code[0] ?? '' : code ?? '';

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const found = await lookupInvite(raw);
      if (!live) return;
      if (found.ok) setInvite(found.invite);
      else setError(found.error);
      setChecking(false);
    })();
    return () => {
      live = false;
    };
  }, [raw]);

  async function onJoin() {
    if (!user || !invite || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await joinWithInvite({
        invite,
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
          await selectHousehold(invite.householdId);
        } catch {
          // households list refreshes on its own; not fatal
        }
        router.replace('/');
      } else {
        setNotice('Request sent. An admin will approve it soon.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <BackButton />
        <Text style={{ fontSize: 15, fontWeight: '700', color: p.primary, marginTop: 32 }}>INVITE</Text>
        {checking ? (
          <Loading />
        ) : invite ? (
          <>
            <Title>You are invited</Title>
            <Subtitle>{invite.householdName}</Subtitle>
            <Text style={{ height: 18 }} />
            <Card>
              <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                <Text style={{ fontSize: 13, color: p.muted }}>Invite code</Text>
                <Text style={{ fontSize: 30, fontWeight: '800', letterSpacing: 6, color: p.ink, marginTop: 4 }}>
                  {invite.code}
                </Text>
                <Text style={{ fontSize: 13, color: p.muted, marginTop: 8 }}>
                  {invite.requiresApproval ? 'An admin approves new members.' : 'You can join right away.'}
                </Text>
              </View>
            </Card>
            {error ? <Text style={{ color: p.danger, marginVertical: 8 }}>{error}</Text> : null}
            {notice ? <Text style={{ color: p.primary, marginVertical: 8 }}>{notice}</Text> : null}
            {!notice && (
              <Button label={invite.requiresApproval ? 'Request to join' : 'Join household'} onPress={onJoin} loading={busy} />
            )}
          </>
        ) : (
          <>
            <Title>Invalid invitation</Title>
            <Subtitle>Ask the household for a fresh invite code.</Subtitle>
            <Text style={{ height: 18 }} />
            {error ? <Text style={{ color: p.danger, marginBottom: 12 }}>{error}</Text> : null}
            <Link href="/join-household" asChild>
              <Pressable style={{ borderWidth: 1, borderColor: p.line, borderRadius: 10, padding: 13, alignItems: 'center' }}>
                <Text style={{ color: p.primary, fontWeight: '700' }}>Enter a code manually</Text>
              </Pressable>
            </Link>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
