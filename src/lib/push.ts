import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export const PUSH_OPT_OUT_KEY = 'dwellio:push-opt-out';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerPushToken(hid: string, uid: string): Promise<string | null> {
  if (!Device.isDevice) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Dwellio updates',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const { status: existing } = await Notifications.getPermissionsAsync();
  const finalStatus = existing === 'granted' ? existing : (await Notifications.requestPermissionsAsync()).status;
  if (finalStatus !== 'granted') return null;
  const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  if (!projectId) return null;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await setDoc(doc(db, 'households', hid, 'pushTokens', uid), {
      token,
      platform: Platform.OS,
      updatedAt: serverTimestamp(),
    });
    return token;
  } catch {
    return null;
  }
}

export async function unregisterPushToken(hid: string, uid: string) {
  await deleteDoc(doc(db, 'households', hid, 'pushTokens', uid)).catch(() => {});
}

async function householdPushTokens(hid: string): Promise<{ uid: string; token: string }[]> {
  const snap = await getDocs(collection(db, 'households', hid, 'pushTokens'));
  const out: { uid: string; token: string }[] = [];
  for (const d of snap.docs) {
    const token = (d.data() as { token?: unknown }).token;
    if (typeof token === 'string' && token.length > 0) out.push({ uid: d.id, token });
  }
  return out;
}

async function sendPush(tokens: string[], title: string, body: string, data?: Record<string, string>) {
  const messages = tokens
    .filter((t) => t.length > 0)
    .map((to) => ({ to, title, body, data: data ?? {} }));
  // The Expo Push Service accepts up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
    } catch {
      // Best effort: a failed push must never break the action that triggered it.
    }
  }
}

export async function notifyHouseholdMember(
  hid: string,
  uid: string,
  title: string,
  body: string,
  data?: Record<string, string>,
) {
  try {
    const all = await householdPushTokens(hid);
    const target = all.find((t) => t.uid === uid);
    if (!target) return;
    await sendPush([target.token], title, body, data);
  } catch {
    // Best effort.
  }
}

export async function notifyHouseholdExcept(
  hid: string,
  exceptUid: string,
  title: string,
  body: string,
  data?: Record<string, string>,
) {
  try {
    const all = await householdPushTokens(hid);
    const tokens = all.filter((t) => t.uid !== exceptUid).map((t) => t.token);
    if (tokens.length === 0) return;
    await sendPush(tokens, title, body, data);
  } catch {
    // Best effort.
  }
}

export { Notifications };
