import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, GOOGLE_WEB_CLIENT_ID } from './firebase';
import {
  GoogleNativeUnavailableError,
  signInWithGoogleNativeIdToken,
  signOutNative,
} from './google-native';

interface AuthState {
  user: User | null;
  loading: boolean;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logOut: () => Promise<void>;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

async function ensureUserDoc(user: User, name?: string) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  const fallbackName = (name ?? user.displayName ?? 'Member').trim() || 'Member';
  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: fallbackName,
      email: user.email ?? '',
      photoURL: user.photoURL ?? '',
      activeHouseholdId: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }
  // Repair docs written before createdAt/displayName became required:
  // without them every later profile write is denied and joins report blocked.
  const d = snap.data() as Record<string, unknown>;
  const displayName = typeof d.displayName === 'string' && d.displayName.trim() ? d.displayName : fallbackName;
  if (typeof d.displayName !== 'string' || !d.displayName.trim() || !d.createdAt) {
    await setDoc(ref, {
      displayName,
      email: typeof d.email === 'string' ? d.email : (user.email ?? ''),
      photoURL: typeof d.photoURL === 'string' ? d.photoURL : (user.photoURL ?? ''),
      activeHouseholdId: typeof d.activeHouseholdId === 'string' ? d.activeHouseholdId : '',
      createdAt: d.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    setError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: name.trim() });
      await ensureUserDoc(cred.user, name.trim());
    } catch (e: unknown) {
      setError(friendly(e));
      throw e;
    }
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await ensureUserDoc(cred.user);
    } catch (e: unknown) {
      setError(friendly(e));
      throw e;
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    try {
      if (Platform.OS === 'web') {
        const provider = new GoogleAuthProvider();
        const cred = await signInWithPopup(auth, provider);
        await ensureUserDoc(cred.user);
        return;
      }
      if (!GOOGLE_WEB_CLIENT_ID) {
        throw new Error('Google sign in is not configured in this build.');
      }
      const idToken = await signInWithGoogleNativeIdToken(GOOGLE_WEB_CLIENT_ID);
      if (!idToken) return;
      const cred = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
      await ensureUserDoc(cred.user);
    } catch (e: unknown) {
      setError(friendly(e));
      throw e;
    }
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (e: unknown) {
      setError(friendly(e));
      throw e;
    }
  }, []);

  const logOut = useCallback(async () => {
    await signOut(auth);
    if (Platform.OS !== 'web') {
      await signOutNative();
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo(
    () => ({ user, loading, signUp, signIn, signInWithGoogle, resetPassword, logOut, error, clearError }),
    [user, loading, signUp, signIn, signInWithGoogle, resetPassword, logOut, error, clearError],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

function friendly(e: unknown): string {
  if (e instanceof GoogleNativeUnavailableError) return e.message;
  const code = (e as { code?: string })?.code ?? '';
  if (code === 'auth/email-already-in-use') return 'That email is already registered. Try signing in.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password')
    return 'Email or password is incorrect.';
  if (code === 'auth/weak-password') return 'Password should be at least 6 characters.';
  if (code === 'auth/invalid-email') return 'That email address looks invalid.';
  if (code === 'auth/network-request-failed') return 'Network problem. Check your connection and retry.';
  if ((e as Error)?.message?.includes('ID token')) return 'Google sign in was cancelled or failed. Try again.';
  return 'Something went wrong. Please try again.';
}
