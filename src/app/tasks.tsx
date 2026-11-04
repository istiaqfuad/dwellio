import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { BackButton, Button, Card, EmptyState, Field, Row, Screen, SectionTitle, Subtitle, Title, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import { useCollection } from '@/lib/use-collection';
import { db } from '@/lib/firebase';
import type { TaskItem } from '@/lib/models';

export default function TasksScreen() {
  const p = usePalette();
  const { user } = useAuth();
  const { active, members, isAdmin, logActivity } = useHousehold();
  const hid = active?.id ?? '';
  const { items: tasks } = useCollection<TaskItem>(`households/${hid}/tasks`, [], !!hid);

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [approval, setApproval] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  async function run(key: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  const nameOf = (uid?: string) => (uid ? members.find((m) => m.id === uid)?.displayName ?? 'Member' : 'Unassigned');
  const eligible = members.filter((m) => !m.excludedFromTasks);
  const mine = tasks.filter((t) => t.assigneeId === user?.uid && t.status !== 'completed' && t.status !== 'cancelled');
  const open = tasks.filter((t) => !t.assigneeId && t.status === 'unassigned');
  const rest = tasks.filter((t) => t.assigneeId !== user?.uid && t.assigneeId);

  if (!active) {
    return (
      <Screen>
        <Title>Tasks</Title>
        <Subtitle>Join or create a household first.</Subtitle>
      </Screen>
    );
  }

  async function createTask() {
    if (!user) return;
    if (!title.trim()) {
      setFormError('Describe the task first.');
      return;
    }
    setFormError('');
    await addDoc(collection(db, 'households', hid, 'tasks'), {
      title: title.trim(),
      priority,
      status: assignee ? 'assigned' : 'unassigned',
      ...(assignee ? { assigneeId: assignee } : {}),
      approvalRequired: approval,
      recurrence: 'none',
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
    await logActivity('task', `${user.displayName ?? 'Someone'} created task: ${title.trim()}${assignee ? ` for ${nameOf(assignee)}` : ''}`);
    setTitle('');
    setAssignee('');
    setShowForm(false);
  }

  async function setStatus(t: TaskItem, status: TaskItem['status']) {
    await updateDoc(doc(db, 'households', hid, 'tasks', t.id), { status });
    await logActivity('task', `${t.title} is now ${status.replace('_', ' ')}`);
  }

  async function assign(t: TaskItem, uid: string) {
    await updateDoc(doc(db, 'households', hid, 'tasks', t.id), { assigneeId: uid, status: 'assigned' });
  }

  async function removeTask(t: TaskItem) {
    await deleteDoc(doc(db, 'households', hid, 'tasks', t.id));
    await logActivity('task', `Removed task: ${t.title}`);
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
        <BackButton />
        <Title>Tasks</Title>
        <Subtitle>Claim work, or get assigned. Approval keeps quality high.</Subtitle>

        <SectionTitle>My tasks ({mine.length})</SectionTitle>
        {mine.length === 0 ? (
          <EmptyState title="Nothing assigned" hint="Claim something from the open list below." />
        ) : (
          mine.map((t) => (
            <Card key={t.id}>
              <Text style={{ fontWeight: '700', color: p.ink }}>{t.title}</Text>
              <Text style={{ fontSize: 13, color: p.muted }}>{t.priority} · {t.status.replace('_', ' ')}</Text>
              <Text style={{ height: 8 }} />
              {t.status === 'in_progress' ? (
                <Button
                  label={t.approvalRequired ? 'Submit for review' : 'Mark complete'}
                  onPress={() => run(`done-${t.id}`, () => setStatus(t, t.approvalRequired ? 'awaiting_approval' : 'completed'))}
                  variant="ghost"
                  loading={busy === `done-${t.id}`}
                />
              ) : t.status === 'awaiting_approval' ? (
                <Text style={{ fontSize: 13, color: p.primary, fontWeight: '600' }}>Waiting for admin approval</Text>
              ) : (
                <Row gap={8}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Start"
                      onPress={() => run(`start-${t.id}`, () => setStatus(t, 'in_progress'))}
                      variant="ghost"
                      loading={busy === `start-${t.id}`}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={t.approvalRequired ? 'Submit for review' : 'Mark complete'}
                      onPress={() => run(`done-${t.id}`, () => setStatus(t, t.approvalRequired ? 'awaiting_approval' : 'completed'))}
                      variant="ghost"
                      loading={busy === `done-${t.id}`}
                    />
                  </View>
                </Row>
              )}
            </Card>
          ))
        )}

        <SectionTitle>Open for claiming ({open.length})</SectionTitle>
        {open.length === 0 ? (
          <EmptyState title="No open tasks" hint="Create one and let someone claim it." />
        ) : (
          open.map((t) => (
            <Card key={t.id}>
              <Row>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: p.ink }}>{t.title}</Text>
                  <Text style={{ fontSize: 13, color: p.muted }}>{t.priority}</Text>
                </View>
                <Button
                  label="Claim"
                  onPress={() => user && run(`claim-${t.id}`, () => assign(t, user.uid))}
                  size="sm"
                  loading={busy === `claim-${t.id}`}
                />
              </Row>
              {isAdmin && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {eligible.map((m) => (
                    <Pressable
                      key={m.id}
                      onPress={() => run(`assign-${t.id}`, () => assign(t, m.id))}
                      style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line }}>
                      <Text style={{ color: p.primary, fontWeight: '600', fontSize: 13 }}>Assign {m.displayName}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Card>
          ))
        )}

        <SectionTitle>Others ({rest.length})</SectionTitle>
        {rest.slice(0, 15).map((t) => (
          <Card key={t.id}>
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: p.ink }}>{t.title}</Text>
                <Text style={{ fontSize: 13, color: p.muted }}>
                  {nameOf(t.assigneeId)} · {t.status.replace('_', ' ')}
                </Text>
              </View>
              {t.status === 'awaiting_approval' && isAdmin ? (
                <Row gap={8}>
                  <Button
                    label="Approve"
                    onPress={() => run(`approve-${t.id}`, () => setStatus(t, 'completed'))}
                    size="sm"
                    loading={busy === `approve-${t.id}`}
                  />
                  <Button
                    label="Rework"
                    onPress={() => run(`rework-${t.id}`, () => setStatus(t, 'in_progress'))}
                    variant="ghost"
                    size="sm"
                    loading={busy === `rework-${t.id}`}
                  />
                </Row>
              ) : null}
            </Row>
            {isAdmin ? (
              <View style={{ marginTop: 10, alignItems: 'flex-start' }}>
                <Button
                  label="Delete task"
                  onPress={() => run(`del-${t.id}`, () => removeTask(t))}
                  variant="danger"
                  size="sm"
                  loading={busy === `del-${t.id}`}
                />
              </View>
            ) : null}
          </Card>
        ))}

        <SectionTitle>New task</SectionTitle>
        <Button label={showForm ? 'Close' : 'Create task'} onPress={() => setShowForm(!showForm)} variant={showForm ? 'ghost' : 'primary'} />
        {showForm && (
          <Card style={{ marginTop: 10 }}>
            <Field
              label="Title"
              value={title}
              onChangeText={(v) => {
                setFormError('');
                setTitle(v);
              }}
              placeholder="Clean the balcony"
            />
            <Row gap={8}>
              {(['low', 'medium', 'high'] as const).map((x) => (
                <Pressable
                  key={x}
                  onPress={() => setPriority(x)}
                  style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 16, backgroundColor: priority === x ? p.primary : p.surface }}>
                  <Text style={{ color: priority === x ? p.primaryInk : p.ink }}>{x}</Text>
                </Pressable>
              ))}
            </Row>
            <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginTop: 12, marginBottom: 6 }}>Approval on completion</Text>
            <Row gap={8}>
              {([true, false] as const).map((v) => (
                <Pressable
                  key={String(v)}
                  onPress={() => setApproval(v)}
                  style={{
                    paddingVertical: 7,
                    paddingHorizontal: 14,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: approval === v ? p.primary : p.line,
                    backgroundColor: approval === v ? `${p.primary}1F` : 'transparent',
                  }}>
                  <Text style={{ color: approval === v ? p.primary : p.ink, fontWeight: '600', fontSize: 13 }}>
                    {v ? 'Needs approval' : 'No approval'}
                  </Text>
                </Pressable>
              ))}
            </Row>
            {isAdmin && (
              <>
                <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginTop: 12, marginBottom: 6 }}>Assign to (optional)</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Pressable
                    onPress={() => setAssignee('')}
                    style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: assignee === '' ? p.primary : p.line, backgroundColor: assignee === '' ? `${p.primary}1F` : 'transparent' }}>
                    <Text style={{ color: assignee === '' ? p.primary : p.ink, fontWeight: '600', fontSize: 13 }}>Leave unassigned</Text>
                  </Pressable>
                  {eligible.map((m) => (
                    <Pressable
                      key={m.id}
                      onPress={() => setAssignee(m.id)}
                      style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: assignee === m.id ? p.primary : p.line, backgroundColor: assignee === m.id ? `${p.primary}1F` : 'transparent' }}>
                      <Text style={{ color: assignee === m.id ? p.primary : p.ink, fontWeight: '600', fontSize: 13 }}>{m.displayName}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            <Text style={{ height: 10 }} />
            {formError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{formError}</Text> : null}
            <Button label="Save task" onPress={() => run('save', createTask)} loading={busy === 'save'} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
