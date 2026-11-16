import { useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { BackButton, Button, Card, EmptyState, Field, Row, Screen, SectionTitle, Subtitle, Title, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import { useCollection } from '@/lib/use-collection';
import { currencySymbol } from '@/lib/finance';
import { db } from '@/lib/firebase';
import { ALL_MODULES, type HouseholdModules } from '@/lib/models';

const MODULE_LABELS: { key: keyof HouseholdModules; label: string }[] = [
  { key: 'expenses', label: 'Expenses' },
  { key: 'meals', label: 'Meals' },
  { key: 'groceries', label: 'Groceries' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'bills', label: 'Bills' },
  { key: 'polls', label: 'Polls' },
  { key: 'announcements', label: 'Announcements' },
];

function makeCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const ALL_SUBCOLLECTIONS = [
  'members',
  'invites',
  'joinRequests',
  'expenses',
  'settlements',
  'categories',
  'mealTypes',
  'optOuts',
  'skippedDays',
  'mealAdjustments',
  'flags',
  'guests',
  'billingPeriods',
  'lists',
  'assignments',
  'purchases',
  'tasks',
  'announcements',
  'bills',
  'polls',
  'events',
  'activity',
];

function MemberAvatar({ name }: { name: string }) {
  const p = usePalette();
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  return (
    <View
      style={{
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: `${p.primary}1F`,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ color: p.primary, fontWeight: '800', fontSize: 17 }}>{initial}</Text>
    </View>
  );
}

function RolePill({ role }: { role: string }) {
  const p = usePalette();
  const style =
    role === 'owner'
      ? { color: p.primary, bg: `${p.primary}1F`, label: 'Owner' }
      : role === 'admin'
        ? { color: p.accent, bg: `${p.accent}1F`, label: 'Admin' }
        : { color: p.muted, bg: p.surface, label: 'Member' };
  return (
    <View style={{ paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12, backgroundColor: style.bg }}>
      <Text style={{ color: style.color, fontWeight: '700', fontSize: 12 }}>{style.label}</Text>
    </View>
  );
}

export default function HouseholdScreen() {
  const p = usePalette();
  const { user } = useAuth();
  const { active, archived, households, members, isAdmin, isOwner, logActivity, selectHousehold, updateModules } = useHousehold();
  const hid = active?.id ?? '';

  const { items: pendingInvites } = useCollection<{
    id: string;
    status: string;
    expiresAt?: number;
    requiresApproval?: boolean;
    createdBy?: string;
    householdName?: string;
  }>(`households/${hid}/invites`, [], !!hid);

  const [needsApproval, setNeedsApproval] = useState(true);
  const [confirmDanger, setConfirmDanger] = useState('');
  const [copiedCode, setCopiedCode] = useState('');
  const [inviteNotice, setInviteNotice] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [houseName, setHouseName] = useState('');
  const [nameError, setNameError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  const visibleInvites = pendingInvites.filter((i) => i.status === 'pending');
  const nameOf = (uid?: string) =>
    members.find((m) => m.id === uid)?.displayName ?? 'a housemate';

  function expiryLabel(expiresAt?: number): string {
    if (typeof expiresAt !== 'number') return 'No expiry set';
    const days = Math.ceil((expiresAt - Date.now()) / 86400000);
    if (days <= 0) return 'Expired';
    if (days === 1) return 'Expires tomorrow';
    return `Expires in ${days} days`;
  }

  const { items: joinRequests } = useCollection<{ id: string; displayName?: string; status: string }>(
    `households/${hid}/joinRequests`,
    [],
    !!hid && isAdmin,
  );
  const pendingRequests = joinRequests.filter((r) => r.status === 'pending');

  async function approveRequest(uid: string, displayName?: string) {
    await setDoc(doc(db, 'households', hid, 'members', uid), {
      role: 'member',
      displayName: displayName ?? 'Member',
      photoURL: '',
      email: '',
      joinedAt: serverTimestamp(),
      excludedFromTasks: false,
    });
    await updateDoc(doc(db, 'households', hid), { memberIds: arrayUnion(uid) });
    await updateDoc(doc(db, 'households', hid, 'joinRequests', uid), { status: 'accepted' });
    await logActivity('member', `${displayName ?? 'Someone'} joined the household`);
  }

  async function rejectRequest(uid: string) {
    await updateDoc(doc(db, 'households', hid, 'joinRequests', uid), { status: 'rejected' });
  }

  if (!active) {
    return (
      <Screen>
        <Title>Household</Title>
        <Subtitle>Join or create a household first.</Subtitle>
      </Screen>
    );
  }

  async function createInvite() {
    if (!user) return;
    const code = makeCode();
    const payload = {
      householdId: hid,
      householdName: active?.name ?? 'Household',
      status: 'pending',
      requiresApproval: needsApproval,
      createdBy: user.uid,
      expiresAt: Date.now() + 7 * 86400000,
      createdAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'households', hid, 'invites', code), payload);
    await setDoc(doc(db, 'inviteCodes', code), {
      householdId: hid,
      householdName: active?.name ?? 'Household',
      status: 'pending',
      requiresApproval: needsApproval,
      createdBy: user.uid,
      expiresAt: payload.expiresAt,
    });
    await logActivity('member', `${user.displayName ?? 'Someone'} created an invitation`);
  }

  async function invalidateInvite(code: string) {
    await deleteDoc(doc(db, 'households', hid, 'invites', code));
    try {
      await deleteDoc(doc(db, 'inviteCodes', code));
    } catch {
      // index entry may already be gone; household copy is the source of truth
    }
    await logActivity('member', 'An invitation code was invalidated');
    if (confirmDanger === `invite:${code}`) setConfirmDanger('');
  }

  function inviteMessage(code: string): string {
    const link = `dwellio://join/${code}`;
    return `Join "${active?.name ?? 'my household'}" on Dwellio! Open this link on your phone: ${link} (or enter the code ${code} in the app under Profile > Join with an invite code). The code expires in 7 days.`;
  }

  async function copyInvite(code: string) {
    await Clipboard.setStringAsync(code);
    setCopiedCode(code);
    setInviteNotice('');
  }

  async function shareInvite(code: string) {
    setInviteNotice('');
    try {
      await Share.share({ message: inviteMessage(code) });
    } catch {
      await Clipboard.setStringAsync(inviteMessage(code));
      setInviteNotice('Sharing is not available here, so the invite was copied instead.');
    }
  }

  async function setRole(uid: string, role: 'admin' | 'member') {
    await updateDoc(doc(db, 'households', hid, 'members', uid), { role });
    await logActivity('member', `Role updated for a member (${role})`);
  }

  async function removeMember(uid: string) {
    await deleteDoc(doc(db, 'households', hid, 'members', uid));
    await updateDoc(doc(db, 'households', hid), { memberIds: arrayRemove(uid) });
    await logActivity('member', 'A member was removed. Their past records stay visible.');
    setConfirmDanger('');
  }

  async function transferOwnership(uid: string) {
    if (!user) return;
    await updateDoc(doc(db, 'households', hid), { ownerId: uid });
    await updateDoc(doc(db, 'households', hid, 'members', uid), { role: 'owner' });
    await updateDoc(doc(db, 'households', hid, 'members', user.uid), { role: 'admin' });
    await logActivity('member', 'Ownership was transferred');
  }

  async function eraseHistory(uid: string) {
    // Top-level docs keyed by author. Bills track responsibleId instead of createdBy.
    const byField: [string, string][] = [
      ['expenses', 'createdBy'],
      ['settlements', 'createdBy'],
      ['tasks', 'createdBy'],
      ['polls', 'createdBy'],
      ['announcements', 'createdBy'],
      ['events', 'createdBy'],
      ['purchases', 'recordedBy'],
      ['bills', 'responsibleId'],
      ['activity', 'actorId'],
      ['guests', 'uid'],
      ['optOuts', 'uid'],
      ['mealAdjustments', 'uid'],
    ];
    for (const [kind, field] of byField) {
      const snap = await getDocs(query(collection(db, 'households', hid, kind), where(field, '==', uid)));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    }
    // Grocery items they added, across every list.
    const listsSnap = await getDocs(collection(db, 'households', hid, 'lists'));
    await Promise.all(
      listsSnap.docs.map(async (l) => {
        const itemsSnap = await getDocs(
          query(collection(db, 'households', hid, 'lists', l.id, 'items'), where('addedBy', '==', uid)),
        );
        await Promise.all(itemsSnap.docs.map((d) => deleteDoc(d.ref)));
      }),
    );
    // Comments they left, including on announcements that are being erased.
    const annSnap = await getDocs(collection(db, 'households', hid, 'announcements'));
    await Promise.all(
      annSnap.docs.map(async (a) => {
        const keep = (a.data() as { createdBy?: string }).createdBy !== uid;
        const csnap = await getDocs(
          query(collection(db, 'households', hid, 'announcements', a.id, 'comments'), where('authorId', '==', uid)),
        );
        await Promise.all(csnap.docs.map((d) => deleteDoc(d.ref)));
        if (!keep) await deleteDoc(a.ref);
      }),
    );
    await logActivity('member', 'Historical records of a former member were deleted by an admin');
    setConfirmDanger('');
  }

  async function deleteDocsAt(path: string) {
    const snap = await getDocs(collection(db, path));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }

  async function wipeSubcollections(targetHid: string, keepMembership: boolean) {
    // Phase 1: nested docs and invite codes while membership is intact.
    const [invitesSnap, listsSnap, annSnap] = await Promise.all([
      getDocs(collection(db, `households/${targetHid}/invites`)),
      getDocs(collection(db, `households/${targetHid}/lists`)),
      getDocs(collection(db, `households/${targetHid}/announcements`)),
    ]);
    await Promise.all([
      ...listsSnap.docs.map((l) => deleteDocsAt(`households/${targetHid}/lists/${l.id}/items`)),
      ...annSnap.docs.map((a) => deleteDocsAt(`households/${targetHid}/announcements/${a.id}/comments`)),
    ]);
    // Phase 2: every subcollection. Membership docs stay until last so every
    // delete in this batch still passes the admin check.
    const skip = keepMembership ? ['members', 'invites'] : [];
    await Promise.all(
      ALL_SUBCOLLECTIONS.filter((c) => !skip.includes(c)).map((c) => deleteDocsAt(`households/${targetHid}/${c}`)),
    );
    if (!keepMembership) {
      await Promise.all(invitesSnap.docs.map((d) => deleteDoc(doc(db, 'inviteCodes', d.id)).catch(() => {})));
    }
  }

  async function deleteMembershipAndRoot(targetHid: string) {
    // Other members first, then the household doc, then our own member doc
    // (self-delete needs no admin check, so it works after the household is gone).
    const memSnap = await getDocs(collection(db, `households/${targetHid}/members`));
    await Promise.all(memSnap.docs.filter((d) => d.id !== user?.uid).map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'households', targetHid));
    if (user) await deleteDoc(doc(db, 'households', targetHid, 'members', user.uid)).catch(() => {});
  }

  async function renameHousehold() {
    const next = houseName.trim();
    if (!next) {
      setNameError('Type the new house name first.');
      return;
    }
    setNameError('');
    await updateDoc(doc(db, 'households', hid), { name: next });
    await logActivity('household', `Household renamed to ${next}`);
    setRenaming(false);
    setHouseName('');
  }

  async function leaveHousehold() {
    if (!user || isOwner) return;
    await logActivity('member', `${user.displayName ?? 'Someone'} left the household`);
    await deleteDoc(doc(db, 'households', hid, 'members', user.uid));
    await updateDoc(doc(db, 'households', hid), { memberIds: arrayRemove(user.uid) });
    await updateDoc(doc(db, 'users', user.uid), { activeHouseholdId: '' });
    setConfirmDanger('');
  }

  async function setArchived(value: boolean) {
    await updateDoc(doc(db, 'households', hid), { archived: value });
  }

  async function wipeHousehold() {
    if (!active) return;
    const snap = await getDoc(doc(db, 'households', hid));
    if (!snap.exists()) return;
    await wipeSubcollections(hid, false);
    await deleteMembershipAndRoot(hid);
    const others = households.filter((h) => h.id !== hid);
    await selectHousehold(others[0]?.id ?? '');
    setConfirmDanger('');
  }

  async function clearHousehold() {
    if (!active) return;
    await wipeSubcollections(hid, true);
    await logActivity('household', `${user?.displayName ?? 'Someone'} cleared all household content`);
    setConfirmDanger('');
  }

  async function wipeArchivedHousehold(targetHid: string) {
    await wipeSubcollections(targetHid, false);
    await deleteMembershipAndRoot(targetHid);
    setConfirmDanger('');
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 64 }}>
        <BackButton />
        <Card>
          <Row gap={12}>
            <MemberAvatar name={active.name} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: p.ink, fontSize: 20 }}>{active.name}</Text>
              <Text style={{ fontSize: 13, color: p.muted, marginTop: 2 }}>
                {currencySymbol(active.currency)} · {members.length} member{members.length === 1 ? '' : 's'}
              </Text>
            </View>
            <RolePill role={isOwner ? 'owner' : isAdmin ? 'admin' : 'member'} />
          </Row>
          {isAdmin ? (
            renaming ? (
              <View style={{ marginTop: 12 }}>
                <Field
                  label="House name"
                  value={houseName}
                  onChangeText={(v) => {
                    setNameError('');
                    setHouseName(v);
                  }}
                  placeholder={active.name}
                  maxLength={120}
                />
                {nameError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{nameError}</Text> : null}
                <Row gap={8}>
                  <View style={{ flex: 1 }}>
                    <Button label="Save name" onPress={() => run('rename', renameHousehold)} size="sm" loading={busy === 'rename'} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Cancel"
                      onPress={() => {
                        setRenaming(false);
                        setNameError('');
                      }}
                      variant="ghost"
                      size="sm"
                    />
                  </View>
                </Row>
              </View>
            ) : (
              <View style={{ marginTop: 10, alignItems: 'flex-start' }}>
                <Button
                  label="Rename house"
                  onPress={() => {
                    setNameError('');
                    setHouseName(active.name);
                    setRenaming(true);
                  }}
                  variant="ghost"
                  size="sm"
                />
              </View>
            )
          ) : null}
        </Card>

        <SectionTitle>My households</SectionTitle>
        <Card>
          {households.map((h) => {
            const isCurrent = h.id === hid;
            const role = h.ownerId === user?.uid ? 'Owner' : 'Member';
            return (
              <View key={h.id} style={{ paddingVertical: 8 }}>
                <Row gap={12}>
                  <MemberAvatar name={h.name} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: p.ink }}>{h.name}</Text>
                    <Text style={{ fontSize: 13, color: p.muted, marginTop: 2 }}>
                      {h.memberIds.length} member{h.memberIds.length === 1 ? '' : 's'} · {role}
                    </Text>
                  </View>
                  {isCurrent ? (
                    <View style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: `${p.primary}1F` }}>
                      <Text style={{ color: p.primary, fontWeight: '700', fontSize: 13 }}>Active</Text>
                    </View>
                  ) : (
                    <Button
                      label="Switch"
                      onPress={() => run(`switch-${h.id}`, () => selectHousehold(h.id))}
                      variant="ghost"
                      size="sm"
                      loading={busy === `switch-${h.id}`}
                    />
                  )}
                </Row>
              </View>
            );
          })}
        </Card>

        {isAdmin && (
          <>
            <SectionTitle>Invite people</SectionTitle>
            <Card>
              <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginBottom: 6 }}>New codes join as</Text>
              <Row gap={8}>
                {(['approval', 'direct'] as const).map((m) => {
                  const selectedMode = needsApproval ? m === 'approval' : m === 'direct';
                  return (
                    <Pressable
                      key={m}
                      onPress={() => setNeedsApproval(m === 'approval')}
                      style={{
                        paddingVertical: 7,
                        paddingHorizontal: 14,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: selectedMode ? p.primary : p.line,
                        backgroundColor: selectedMode ? `${p.primary}1F` : 'transparent',
                      }}>
                      <Text style={{ color: selectedMode ? p.primary : p.ink, fontWeight: '600', fontSize: 13 }}>
                        {m === 'approval' ? 'Needs approval' : 'Direct join'}
                      </Text>
                    </Pressable>
                  );
                })}
              </Row>
              <Text style={{ height: 10 }} />
              <Button label="Create invite code" onPress={() => run('create-invite', createInvite)} loading={busy === 'create-invite'} />
            </Card>
            {visibleInvites.map((inv) => {
              const expired = typeof inv.expiresAt === 'number' && inv.expiresAt < Date.now();
              const canManage = isAdmin || inv.createdBy === user?.uid;
              const confirming = confirmDanger === `invite:${inv.id}`;
              return (
                <Card key={inv.id}>
                  <Text style={{ fontSize: 13, color: p.muted }}>
                    {inv.requiresApproval === false ? 'Direct join' : 'Needs approval'} · created by {nameOf(inv.createdBy)}
                  </Text>
                  <Text style={{ fontSize: 28, fontWeight: '800', letterSpacing: 6, color: p.ink, marginVertical: 6 }}>
                    {inv.id}
                  </Text>
                  <Text style={{ fontSize: 13, color: expired ? p.danger : p.muted, marginBottom: 10 }}>
                    {expiryLabel(inv.expiresAt)}
                  </Text>
                  {copiedCode === inv.id ? (
                    <Text style={{ fontSize: 13, color: p.primary, fontWeight: '600', marginBottom: 8 }}>Copied to clipboard.</Text>
                  ) : null}
                  {canManage ? (
                    <Row gap={8}>
                      <View style={{ flex: 1 }}>
                        <Button label="Copy" onPress={() => copyInvite(inv.id)} variant="ghost" size="sm" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button label="Share" onPress={() => shareInvite(inv.id)} variant="ghost" size="sm" />
                      </View>
                      <View style={{ flex: 1 }}>
                        {confirming ? (
                          <Button
                            label="Confirm"
                            onPress={() => run(`invalidate-${inv.id}`, () => invalidateInvite(inv.id))}
                            variant="danger"
                            size="sm"
                            loading={busy === `invalidate-${inv.id}`}
                          />
                        ) : (
                          <Button label="Invalidate" onPress={() => setConfirmDanger(`invite:${inv.id}`)} variant="ghost" size="sm" />
                        )}
                      </View>
                    </Row>
                  ) : null}
                </Card>
              );
            })}
            {inviteNotice ? <Text style={{ color: p.primary, fontSize: 13 }}>{inviteNotice}</Text> : null}
            {visibleInvites.length === 0 ? (
              <EmptyState title="No active codes" hint="Create one above and share it with your roommates." />
            ) : null}
          </>
        )}

        <SectionTitle>Members ({members.length})</SectionTitle>
        {members.map((m) => (
          <Card key={m.id}>
            <Row gap={12}>
              <MemberAvatar name={m.displayName} />
              <View style={{ flex: 1 }}>
                <Row gap={8}>
                  <Text style={{ flex: 1, fontWeight: '700', color: p.ink }}>
                    {m.displayName}
                    {m.id === user?.uid ? ' · you' : ''}
                  </Text>
                  <RolePill role={m.role} />
                </Row>
                {isAdmin && m.email ? (
                  <Text style={{ fontSize: 13, color: p.muted, marginTop: 2 }}>{m.email}</Text>
                ) : null}
              </View>
            </Row>
            {isAdmin && m.id !== user?.uid && (
              <View style={{ marginTop: 12, gap: 8 }}>
                <Row gap={8}>
                  {m.role === 'member' ? (
                    <Button
                      label="Make admin"
                      onPress={() => run(`role-${m.id}`, () => setRole(m.id, 'admin'))}
                      variant="ghost"
                      size="sm"
                      loading={busy === `role-${m.id}`}
                    />
                  ) : m.role === 'admin' ? (
                    <Button
                      label="Make member"
                      onPress={() => run(`role-${m.id}`, () => setRole(m.id, 'member'))}
                      variant="ghost"
                      size="sm"
                      loading={busy === `role-${m.id}`}
                    />
                  ) : null}
                  {isOwner && m.role !== 'owner' ? (
                    <Button
                      label="Transfer ownership"
                      onPress={() => run(`transfer-${m.id}`, () => transferOwnership(m.id))}
                      variant="ghost"
                      size="sm"
                      loading={busy === `transfer-${m.id}`}
                    />
                  ) : null}
                </Row>
                <Row gap={8}>
                  {confirmDanger === `remove-${m.id}` ? (
                    <Button
                      label="Confirm remove"
                      onPress={() => run(`remove-${m.id}`, () => removeMember(m.id))}
                      variant="danger"
                      size="sm"
                      loading={busy === `remove-${m.id}`}
                    />
                  ) : (
                    <Button label="Remove" onPress={() => setConfirmDanger(`remove-${m.id}`)} variant="ghost" size="sm" />
                  )}
                  {confirmDanger === m.id ? (
                    <Button
                      label="Confirm erase history"
                      onPress={() => run(`erase-${m.id}`, () => eraseHistory(m.id))}
                      variant="danger"
                      size="sm"
                      loading={busy === `erase-${m.id}`}
                    />
                  ) : (
                    <Button label="Erase history" onPress={() => setConfirmDanger(m.id)} variant="ghost" size="sm" />
                  )}
                </Row>
                <Text style={{ fontSize: 12, color: p.muted }}>
                  Erase history removes everything they created: expenses, purchases, bills, tasks, polls, announcements, activity, guests and grocery items.
                </Text>
              </View>
            )}
            {isAdmin && m.role !== 'owner' && (
              <>
                <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginTop: 10, marginBottom: 6 }}>Tasks module</Text>
                <Row gap={8}>
                  {([false, true] as const).map((excluded) => {
                    const selected = m.excludedFromTasks === excluded;
                    return (
                      <Pressable
                        key={String(excluded)}
                        onPress={() => updateDoc(doc(db, 'households', hid, 'members', m.id), { excludedFromTasks: excluded })}
                        style={{
                          paddingVertical: 7,
                          paddingHorizontal: 14,
                          borderRadius: 16,
                          borderWidth: 1,
                          borderColor: selected ? p.primary : p.line,
                          backgroundColor: selected ? `${p.primary}1F` : 'transparent',
                        }}>
                        <Text style={{ color: selected ? p.primary : p.ink, fontWeight: '600', fontSize: 13 }}>
                          {excluded ? 'Excluded' : 'Included'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </Row>
              </>
            )}
          </Card>
        ))}

        {!isOwner && (
          <>
            <SectionTitle>Membership</SectionTitle>
            <Card>
              {confirmDanger === 'leave' ? (
                <Button label="Tap again to leave this household" onPress={() => run('leave', leaveHousehold)} variant="danger" loading={busy === 'leave'} />
              ) : (
                <Button label="Leave household" onPress={() => setConfirmDanger('leave')} variant="ghost" />
              )}
              <Text style={{ fontSize: 12, color: p.muted, marginTop: 6 }}>
                Leaving removes you from members and bills. Past records with your name stay.
              </Text>
            </Card>
          </>
        )}

        {isAdmin && pendingRequests.length > 0 && (
          <>
            <SectionTitle>Join requests ({pendingRequests.length})</SectionTitle>
            {pendingRequests.map((r) => (
              <Card key={r.id}>
                <Text style={{ color: p.ink, fontWeight: '600', marginBottom: 10 }}>{r.displayName ?? 'Someone'} wants to join</Text>
                <Row gap={8}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Approve"
                      onPress={() => run(`approve-${r.id}`, () => approveRequest(r.id, r.displayName))}
                      size="sm"
                      loading={busy === `approve-${r.id}`}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Reject"
                      onPress={() => run(`reject-${r.id}`, () => rejectRequest(r.id))}
                      variant="ghost"
                      size="sm"
                      loading={busy === `reject-${r.id}`}
                    />
                  </View>
                </Row>
              </Card>
            ))}
          </>
        )}


        {isAdmin && (
          <>
            <SectionTitle>Modules</SectionTitle>
            <Card>
              {MODULE_LABELS.map((m) => {
                const on = active.modules[m.key] ?? (ALL_MODULES[m.key] as boolean);
                return (
                  <Pressable
                    key={m.key}
                    onPress={() => updateModules({ ...active.modules, [m.key]: !on })}
                    style={{ paddingVertical: 8 }}>
                    <Row>
                      <Text style={{ flex: 1, color: p.ink, fontWeight: '600' }}>{m.label}</Text>
                      <Text style={{ color: on ? p.primary : p.muted, fontWeight: '700' }}>{on ? 'On' : 'Off'}</Text>
                    </Row>
                  </Pressable>
                );
              })}
              <Text style={{ fontSize: 12, color: p.muted, marginTop: 4 }}>Turning a module off hides it but keeps its data.</Text>
            </Card>

            <SectionTitle>Policies</SectionTitle>
            <Card>
              <Text style={{ fontWeight: '600', color: p.ink, marginBottom: 6 }}>Settlement confirmations</Text>
              <Text style={{ fontSize: 13, color: p.muted }}>
                {active.settlementPolicy === 'immediate'
                  ? 'Payments complete right away. Change this from the Expenses screen.'
                  : 'Every payment stays pending until the receiver confirms it. Change this from the Expenses screen.'}
              </Text>
              <Text style={{ fontSize: 13, color: p.muted, marginTop: 6 }}>
                Guest meals are paid by the host by default. Pick others while registering a guest to split that bill.
              </Text>
            </Card>
          </>
        )}

        {isOwner && (
          <>
            <SectionTitle>Danger zone</SectionTitle>
            <Card>
              <Button
                label="Archive household"
                onPress={() => run('archive', () => setArchived(true))}
                variant="ghost"
                loading={busy === 'archive'}
              />
              <Text style={{ height: 8 }} />
              {confirmDanger === 'clear' ? (
                <Button label="Tap again to clear everything" onPress={() => run('clear', clearHousehold)} variant="danger" loading={busy === 'clear'} />
              ) : (
                <Button label="Clear all content" onPress={() => setConfirmDanger('clear')} variant="danger" />
              )}
              <Text style={{ fontSize: 12, color: p.muted, marginTop: 6 }}>
                Clearing removes every expense, bill, task, grocery item, poll and announcement, but keeps the house and its members.
              </Text>
              <Text style={{ height: 8 }} />
              {confirmDanger === 'wipe' ? (
                <Button label="Tap again to permanently delete" onPress={() => run('wipe', wipeHousehold)} variant="danger" loading={busy === 'wipe'} />
              ) : (
                <Button label="Delete permanently" onPress={() => setConfirmDanger('wipe')} variant="danger" />
              )}
              <Text style={{ fontSize: 12, color: p.muted, marginTop: 6 }}>
                Archiving makes the household read only. Deleting removes the house and everything in it, and needs your confirmation.
              </Text>
            </Card>
          </>
        )}

        {archived.length > 0 && isOwner && (
          <>
            <SectionTitle>Archived</SectionTitle>
            {archived.map((h) => (
              <Card key={h.id}>
                <Row gap={8}>
                  <Text style={{ flex: 1, color: p.ink }}>{h.name}</Text>
                  <Button
                    label="Restore"
                    onPress={() => run(`restore-${h.id}`, () => updateDoc(doc(db, 'households', h.id), { archived: false }) as Promise<void>)}
                    variant="ghost"
                    size="sm"
                    loading={busy === `restore-${h.id}`}
                  />
                  {confirmDanger === `wipe-archived-${h.id}` ? (
                    <Button
                      label="Confirm delete"
                      onPress={() => run(`wipe-archived-${h.id}`, () => wipeArchivedHousehold(h.id))}
                      variant="danger"
                      size="sm"
                      loading={busy === `wipe-archived-${h.id}`}
                    />
                  ) : (
                    <Button
                      label="Delete"
                      onPress={() => setConfirmDanger(`wipe-archived-${h.id}`)}
                      variant="ghost"
                      size="sm"
                    />
                  )}
                </Row>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
