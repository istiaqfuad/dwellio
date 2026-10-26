import { arrayUnion, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { db } from './firebase';

export interface InviteInfo {
  code: string;
  householdId: string;
  householdName: string;
  requiresApproval: boolean;
  status: string;
  expiresAt: number;
}

export interface JoinResult {
  ok: boolean;
  joined?: boolean;
  error?: string;
}

/** Look up an invite code. Reads only the public inviteCodes index so it works before joining. */
export async function lookupInvite(code: string): Promise<{ ok: true; invite: InviteInfo } | { ok: false; error: string }> {
  const clean = code.trim().toUpperCase();
  if (!clean) return { ok: false, error: 'Enter the 6 character code first.' };
  let snap;
  try {
    snap = await getDoc(doc(db, 'inviteCodes', clean));
  } catch {
    return { ok: false, error: 'Could not look up that code. Check your connection and try again.' };
  }
  if (!snap.exists()) return { ok: false, error: 'That code did not match any invitation.' };
  const d = snap.data();
  if (typeof d.expiresAt === 'number' && d.expiresAt < Date.now()) {
    return { ok: false, error: 'This invitation has expired. Ask for a fresh code.' };
  }
  if (d.status !== 'pending') return { ok: false, error: 'This invitation is no longer valid.' };
  return {
    ok: true,
    invite: {
      code: clean,
      householdId: (d.householdId as string) ?? '',
      householdName: (d.householdName as string) ?? 'a household',
      requiresApproval: d.requiresApproval !== false,
      status: d.status as string,
      expiresAt: (d.expiresAt as number) ?? 0,
    },
  };
}

function toError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  if (code === 'permission-denied') return 'Joining was blocked.';
  if (code.includes('unavailable') || code.includes('network')) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return 'Something went wrong while joining. Please try again.';
}

/**
 * Join (or request to join) the household from a valid invite.
 * Never throws; reports { ok, joined } where joined=false means a join request is pending approval.
 */
export async function joinWithInvite(args: {
  invite: InviteInfo;
  uid: string;
  displayName: string;
  photoURL?: string;
  email?: string;
}): Promise<JoinResult> {
  const { invite, uid, displayName } = args;
  const hid = invite.householdId;
  try {
    if (invite.requiresApproval) {
      try {
        await setDoc(doc(db, 'households', hid, 'joinRequests', uid), {
          displayName,
          status: 'pending',
          createdAt: serverTimestamp(),
        });
      } catch (e: unknown) {
        return { ok: false, error: `The join request was blocked. ${needFreshCode(toError(e))}` };
      }
      return { ok: true, joined: false };
    }
    try {
      await setDoc(doc(db, 'households', hid, 'members', uid), {
        role: 'member',
        displayName,
        photoURL: args.photoURL ?? '',
        email: args.email ?? '',
        joinedAt: serverTimestamp(),
        excludedFromTasks: false,
      });
    } catch (e: unknown) {
      return { ok: false, error: `Could not add you as a member. ${needFreshCode(toError(e))}` };
    }
    try {
      await updateDoc(doc(db, 'households', hid), { memberIds: arrayUnion(uid) });
    } catch (e: unknown) {
      return { ok: false, error: `Could not add you to the roster. ${needFreshCode(toError(e))}` };
    }
    // Invite codes stay usable until they expire or an admin invalidates
    // them, so the whole household can join with the same code.
    try {
      await setDoc(
        doc(db, 'users', uid),
        { activeHouseholdId: hid, updatedAt: serverTimestamp() },
        { merge: true },
      );
    } catch {
      // Membership is already recorded; the app picks the household anyway.
    }
    try {
      await setDoc(doc(collection(db, 'households', hid, 'activity')), {
        kind: 'member',
        text: `${displayName} joined the household`,
        actorId: uid,
        createdAt: serverTimestamp(),
      });
    } catch {
      // activity history is best effort; joining already succeeded
    }
    return { ok: true, joined: true };
  } catch (e: unknown) {
    return { ok: false, error: needFreshCode(toError(e)) };
  }
}

function needFreshCode(detail: string): string {
  return `${detail} Ask the household for a fresh code if this keeps happening.`;
}
