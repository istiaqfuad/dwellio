import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Field, Screen, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';

export default function SignUpScreen() {
  const p = usePalette();
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const home = (next && typeof next === 'string' && !next.startsWith('sign-')) ? `/${next}` : '/';
  const { signUp, signInWithGoogle, error } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function onSignUp() {
    if (!name.trim() || !email.trim()) {
      setNotice('Enter your name and email first.');
      return;
    }
    if (password.length < 6) {
      setNotice('Pick a password with at least 6 characters.');
      return;
    }
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await signUp(name, email, password);
      router.replace(home as never);
    } catch {
      // error shown from context
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await signInWithGoogle();
      router.replace(home as never);
    } catch {
      // error shown from context
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.brand}>
          <Image source={require('@/assets/images/icon.png')} style={styles.mark} />
          <Text style={[styles.wordmark, { color: p.ink }]}>DWELLIO</Text>
          <Text style={[styles.tagline, { color: p.muted }]}>Shared living, settled fairly.</Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: p.card, borderColor: p.line },
          ]}>
          <Text style={[styles.heading, { color: p.ink }]}>Create your account</Text>
          <Text style={[styles.subheading, { color: p.muted }]}>One account works across all your households.</Text>

          <Field label="Full name" value={name} onChangeText={setName} />
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Field label="Password (min 6 characters)" value={password} onChangeText={setPassword} secureTextEntry />
          {error ? <Text style={[styles.message, { color: p.danger }]}>{error}</Text> : null}
          {notice ? <Text style={[styles.message, { color: p.primary }]}>{notice}</Text> : null}

          <View style={styles.gap} />
          <Button label="Create account" onPress={onSignUp} loading={busy} />

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: p.line }]} />
            <Text style={[styles.dividerText, { color: p.muted }]}>or</Text>
            <View style={[styles.dividerLine, { backgroundColor: p.line }]} />
          </View>

          <Button label="Continue with Google" onPress={onGoogle} variant="ghost" loading={busy} />
        </View>

        <Link href="/sign-in" asChild>
          <Pressable style={styles.footer}>
            <Text style={[styles.footerText, { color: p.muted }]}>
              Have an account? <Text style={{ color: p.primary, fontWeight: '700' }}>Sign in</Text>
            </Text>
          </Pressable>
        </Link>
        </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 24,
  },
  brand: {
    alignItems: 'center',
    marginBottom: 22,
  },
  mark: {
    width: 60,
    height: 60,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  markLetter: {
    fontSize: 30,
    fontWeight: '800',
  },
  wordmark: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 3,
  },
  tagline: {
    fontSize: 14,
    marginTop: 6,
  },
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
  },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subheading: {
    fontSize: 14,
    marginTop: 4,
    marginBottom: 16,
  },
  message: {
    fontSize: 13,
    marginBottom: 8,
  },
  gap: {
    height: 6,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 12,
    marginHorizontal: 12,
  },
  footer: {
    marginTop: 18,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
