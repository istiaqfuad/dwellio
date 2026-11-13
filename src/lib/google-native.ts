export class GoogleNativeUnavailableError extends Error {
  constructor() {
    super('Google sign in needs a development build. Email sign in works here.');
    this.name = 'GoogleNativeUnavailableError';
  }
}

interface NativeSigninResult {
  data?: { idToken?: string | null } | null;
}

interface NativeGoogleSignin {
  configure: (opts: { webClientId: string; offlineAccess: boolean }) => void;
  hasPlayServices: (opts?: { showPlayServicesUpdateDialog?: boolean }) => Promise<boolean>;
  signIn: () => Promise<NativeSigninResult>;
  signOut: () => Promise<void>;
}

export type GoogleNativeLoader = () => { GoogleSignin: NativeGoogleSignin };

function defaultLoader(): { GoogleSignin: NativeGoogleSignin } {
  // Lazy so Expo Go (no native module) can still load this file.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-google-signin/google-signin') as {
    GoogleSignin: NativeGoogleSignin;
  };
}

function isCancel(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? '';
  return code === 'SIGN_IN_CANCELLED' || code === 'IN_PROGRESS';
}

function isMissingNativeModule(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('RNGoogleSignin');
}

let configuredFor: string | null = null;

/**
 * Returns the Google ID token, null when the user cancels,
 * or throws GoogleNativeUnavailableError when the native module
 * is absent (Expo Go) instead of crashing the app.
 */
export async function signInWithGoogleNativeIdToken(
  webClientId: string,
  loader: GoogleNativeLoader = defaultLoader,
): Promise<string | null> {
  let GoogleSignin: NativeGoogleSignin;
  try {
    GoogleSignin = loader().GoogleSignin;
  } catch (e: unknown) {
    if (isMissingNativeModule(e)) throw new GoogleNativeUnavailableError();
    throw e;
  }
  try {
    if (configuredFor !== webClientId) {
      GoogleSignin.configure({ webClientId, offlineAccess: false });
      configuredFor = webClientId;
    }
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const info = await GoogleSignin.signIn();
    return info.data?.idToken ?? null;
  } catch (e: unknown) {
    if (isCancel(e)) return null;
    if (isMissingNativeModule(e)) throw new GoogleNativeUnavailableError();
    throw e;
  }
}

export async function signOutNative(
  loader: GoogleNativeLoader = defaultLoader,
): Promise<void> {
  try {
    await loader().GoogleSignin.signOut();
  } catch {
    // best effort; native sign out must never break email sign out
  }
}
