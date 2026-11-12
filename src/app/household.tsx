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

export default function HouseholdScreen() {
  const p = usePalette();
  const { user } = useAuth();
  const { active, archived, members, isAdmin, isOwner, logActivity, updateModules } = useHousehold();
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
    const kinds = ['expenses', 'settlements', 'tasks'];
    for (const kind of kinds) {
      const snap = await getDocs(query(collection(db, 'households', hid, kind), where('createdBy', '==', uid)));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    }
    await logActivity('member', 'Historical records of a former member were deleted by an admin');
    setConfirmDanger('');
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
    await deleteDoc(doc(db, 'households', hid));
    setConfirmDanger('');
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 64 }}>
        <BackButton />
        <Title>{active.name}</Title>
        <Subtitle>
          {currencySymbol(active.currency)} · {members.length} members · {isOwner ? 'Owner' : isAdmin ? 'Admin' : 'Member'}
        </Subtitle>
        {isAdmin ? (
          renaming ? (
            <Card style={{ marginTop: 12 }}>
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
            </Card>
          ) : (
            <View style={{ alignItems: 'flex-start', marginTop: 8 }}>
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

        <SectionTitle>Members</SectionTitle>
        {members.map((m) => (
          <Card key={m.id}>
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: p.ink }}>{m.displayName}</Text>
                <Text style={{ fontSize: 13, color: p.muted }}>
                  {m.role}
                  {isAdmin && m.id !== user?.uid ? ` · ${m.email || ''}` : ''}
                </Text>
              </View>
              {m.id === user?.uid ? <Text style={{ color: p.muted }}>You</Text> : null}
            </Row>
            {isAdmin && m.id !== user?.uid && (
              <View style={{ marginTop: 10, gap: 8 }}>
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
                Every payment stays pending until the receiver confirms it.
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
              {confirmDanger === 'wipe' ? (
                <Button label="Tap again to permanently delete" onPress={() => run('wipe', wipeHousehold)} variant="danger" loading={busy === 'wipe'} />
              ) : (
                <Button label="Delete permanently" onPress={() => setConfirmDanger('wipe')} variant="danger" />
              )}
              <Text style={{ fontSize: 12, color: p.muted, marginTop: 6 }}>
                Archiving makes the household read only. Deleting is permanent and needs your confirmation.
              </Text>
            </Card>
          </>
        )}

        {archived.length > 0 && isOwner && (
          <>
            <SectionTitle>Archived</SectionTitle>
            {archived.map((h) => (
              <Card key={h.id}>
                <Row>
                  <Text style={{ flex: 1, color: p.ink }}>{h.name}</Text>
                  <Button
                    label="Restore"
                    onPress={() => run(`restore-${h.id}`, () => updateDoc(doc(db, 'households', h.id), { archived: false }) as Promise<void>)}
                    variant="ghost"
                    size="sm"
                    loading={busy === `restore-${h.id}`}
                  />
                </Row>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
