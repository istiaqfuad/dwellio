import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  type Auth,
  type Persistence,
  type ReactNativeAsyncStorage,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { Platform } from 'react-native';

// Exposed by the react-native bundler condition of firebase/auth.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getReactNativePersistence } = require('firebase/auth') as {
  getReactNativePersistence?: (storage: ReactNativeAsyncStorage) => Persistence;
};

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID ?? '',
};

export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

let app: FirebaseApp;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0]!;
}

let auth: Auth;
if (Platform.OS === 'web') {
  auth = getAuth(app);
} else {
  if (getReactNativePersistence) {
    try {
      auth = initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    } catch {
      auth = getAuth(app);
    }
  } else {
    auth = getAuth(app);
  }
}

const db: Firestore = getFirestore(app);

export { app, auth, db };
