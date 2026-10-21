import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Field, Screen, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';

export default function SignInScreen() {
  const p = usePalette();
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const home = (next && typeof next === 'string' && !next.startsWith('sign-')) ? `/${next}` : '/';
  const { signIn, signInWithGoogle, resetPassword, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function onSignIn() {
    if (!email.trim() || !password) {
      setNotice('Enter your email and password first.');
      return;
    }
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await signIn(email, password);
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

  async function onReset() {
    if (!email.trim()) {
      setNotice('Enter your email above first, then tap Send reset link.');
      return;
    }
    try {
      await resetPassword(email);
      setNotice('Reset link sent. Check your inbox.');
    } catch {
      // error shown from context
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
          <Text style={[styles.heading, { color: p.ink }]}>Welcome back</Text>
          <Text style={[styles.subheading, { color: p.muted }]}>Sign in to manage your household.</Text>

          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {error ? <Text style={[styles.message, { color: p.danger }]}>{error}</Text> : null}
          {notice ? <Text style={[styles.message, { color: p.primary }]}>{notice}</Text> : null}

          <View style={styles.gap} />
          <Button label="Sign in" onPress={onSignIn} loading={busy} />

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: p.line }]} />
            <Text style={[styles.dividerText, { color: p.muted }]}>or</Text>
            <View style={[styles.dividerLine, { backgroundColor: p.line }]} />
          </View>

          <Button label="Continue with Google" onPress={onGoogle} variant="ghost" loading={busy} />

          <Pressable onPress={onReset} style={styles.reset}>
            <Text style={[styles.resetText, { color: p.primary }]}>Send reset link</Text>
          </Pressable>
        </View>

        <Link href="/sign-up" asChild>
          <Pressable style={styles.footer}>
            <Text style={[styles.footerText, { color: p.muted }]}>
              New here? <Text style={{ color: p.primary, fontWeight: '700' }}>Create an account</Text>
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
  reset: {
    marginTop: 14,
    alignItems: 'center',
  },
  resetText: {
    fontWeight: '600',
    fontSize: 14,
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
