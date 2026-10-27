import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { HouseholdProvider } from '@/lib/household-context';
import { Loading } from '@/components/ui';

SplashScreen.preventAutoHideAsync();

const AUTH_ROUTES = ['sign-in', 'sign-up'];

function Gate() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const onAuthScreen = segments.length > 0 && AUTH_ROUTES.includes(segments[0] as string);

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  // Single place for auth redirects. Per-screen redirect effects were
  // removed because they can fire from still-mounted screens after a
  // navigation and bounce the user back.
  // Single place for auth redirects. Per-screen redirect effects were
  // removed because they can fire from still-mounted screens after a
  // navigation and bounce the user back.
  //
  // When a signed-out user opens a deep link (e.g. a household invite),
  // the target path is carried through sign-in via the `next` param.
  useEffect(() => {
    if (loading) return;
    if (!user && !onAuthScreen) {
      const next = segments.join('/');
      router.replace({ pathname: '/sign-in', params: next ? { next } : undefined } as never);
    } else if (user && onAuthScreen) {
      router.replace('/');
    }
  }, [loading, user, onAuthScreen, router, segments]);

  if (loading) return <Loading />;
  return null;
}

function Shell() {
  // Do not mount any route until auth state resolves. Otherwise the
  // initial tab screen flashes for a frame before the gate redirects
  // to sign-in (or the home screen flashes before household data lands).
  const { loading } = useAuth();
  if (loading) return <Loading />;
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="create-household" />
      <Stack.Screen name="tasks" options={{ animation: 'fade', animationDuration: 320 }} />
      <Stack.Screen name="bills" options={{ animation: 'fade', animationDuration: 320 }} />
      <Stack.Screen name="polls" options={{ animation: 'fade', animationDuration: 320 }} />
      <Stack.Screen name="calendar" options={{ animation: 'fade', animationDuration: 320 }} />
      <Stack.Screen name="announcements" options={{ animation: 'fade', animationDuration: 320 }} />
      <Stack.Screen name="activity" options={{ animation: 'fade', animationDuration: 320 }} />
      <Stack.Screen name="join-household" />
      <Stack.Screen name="join/[code]" />
      <Stack.Screen name="reports" options={{ animation: 'fade', animationDuration: 320 }} />
      <Stack.Screen name="household" options={{ animation: 'fade', animationDuration: 320 }} />
      <Stack.Screen name="profile" options={{ animation: 'fade', animationDuration: 320 }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <HouseholdProvider>
        <Gate />
        <Shell />
      </HouseholdProvider>
    </AuthProvider>
  );
}
