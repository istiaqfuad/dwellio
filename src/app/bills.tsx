import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { BackButton, Button, Card, EmptyState, Field, Row, Screen, SectionTitle, Subtitle, Title, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import { useCollection } from '@/lib/use-collection';
import { currencySymbol, formatMoney } from '@/lib/finance';
import { db } from '@/lib/firebase';
import type { Bill } from '@/lib/models';

export default function BillsScreen() {
  const p = usePalette();
  const { user } = useAuth();
  const { active, members, logActivity } = useHousehold();
  const hid = active?.id ?? '';
  const { items: bills } = useCollection<Bill>(`households/${hid}/bills`, [], !!hid);

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState('');
  const [responsible, setResponsible] = useState('');
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

  const nameOf = (uid: string) => members.find((m) => m.id === uid)?.displayName ?? 'Member';
  const sorted = [...bills].sort((a, b) => a.dueDate - b.dueDate);

  if (!active) {
    return (
      <Screen>
        <Title>Bills</Title>
        <Subtitle>Join or create a household first.</Subtitle>
      </Screen>
    );
  }

  async function addBill() {
    if (!user) return;
    if (!title.trim()) {
      setFormError('Give the bill a title first.');
      return;
    }
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) {
      setFormError('Enter the bill amount.');
      return;
    }
    setFormError('');
    const parsed = due ? new Date(`${due}T12:00:00`).getTime() : NaN;
    const dueDate = Number.isNaN(parsed) ? Date.now() + 7 * 86400000 : parsed;
    await addDoc(collection(db, 'households', hid, 'bills'), {
      title: title.trim(),
      amount: amt,
      dueDate,
      status: 'unpaid',
      responsibleId: responsible || user.uid,
      createdAt: serverTimestamp(),
    });
    await logActivity('bill', `${user.displayName ?? 'Someone'} added bill: ${title.trim()}`);
    setTitle('');
    setAmount('');
    setDue('');
    setShowForm(false);
  }

  async function markPaid(b: Bill) {
    await updateDoc(doc(db, 'households', hid, 'bills', b.id), { status: 'paid' });
    if (user && b.amount > 0) {
      await addDoc(collection(db, 'households', hid, 'expenses'), {
        title: b.title,
        amount: b.amount,
        category: 'Other',
        date: Date.now(),
        payerId: user.uid,
        participantIds: active!.memberIds,
        splitMethod: 'equal',
        shares: Object.fromEntries(active!.memberIds.map((id) => [id, +(b.amount / active!.memberIds.length).toFixed(2)])),
        status: 'normal',
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'households', hid, 'bills', b.id), { status: 'paid' });
    }
    await logActivity('bill', `${b.title} marked paid`);
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 64 }}>
        <BackButton />
        <Title>Utility bills</Title>
        <Subtitle>Never miss a due date. Paying a bill can post it as a shared expense.</Subtitle>

        <SectionTitle>Upcoming</SectionTitle>
        {sorted.filter((b) => b.status !== 'paid').length === 0 ? (
          <EmptyState title="All clear" hint="No unpaid bills right now." />
        ) : (
          sorted
            .filter((b) => b.status !== 'paid')
            .map((b) => (
              <Card key={b.id}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: p.ink }}>{b.title}</Text>
                    <Text style={{ fontSize: 13, color: b.dueDate < Date.now() ? p.danger : p.muted }}>
                      Due {new Date(b.dueDate).toLocaleDateString()} · {nameOf(b.responsibleId)}
                      {b.dueDate < Date.now() ? ' · overdue' : ''}
                    </Text>
                  </View>
                  <Text style={{ fontWeight: '800', color: p.ink }}>{formatMoney(b.amount, active.currency)}</Text>
                </Row>
                <Text style={{ height: 8 }} />
                <Button
                  label="Mark paid (posts as expense)"
                  onPress={() => run(`paid-${b.id}`, () => markPaid(b))}
                  variant="ghost"
                  loading={busy === `paid-${b.id}`}
                />
              </Card>
            ))
        )}

        <SectionTitle>History</SectionTitle>
        {sorted.filter((b) => b.status === 'paid').length === 0 ? (
          <EmptyState title="No history" hint="Paid bills will appear here." />
        ) : (
          sorted
            .filter((b) => b.status === 'paid')
            .slice(0, 15)
            .map((b) => (
              <Card key={b.id}>
                <Row>
                  <Text style={{ flex: 1, color: p.ink }}>{b.title}</Text>
                  <Text style={{ color: p.primary, fontWeight: '700' }}>{formatMoney(b.amount, active.currency)}</Text>
                </Row>
              </Card>
            ))
        )}

        <SectionTitle>New bill</SectionTitle>
        <Button label={showForm ? 'Close' : 'Add bill'} onPress={() => setShowForm(!showForm)} variant={showForm ? 'ghost' : 'primary'} />
        {showForm && (
          <Card style={{ marginTop: 10 }}>
            <Field
              label="Title"
              value={title}
              onChangeText={(v) => {
                setFormError('');
                setTitle(v);
              }}
              placeholder="Electricity, July"
            />
            <Field
              label={`Amount (${currencySymbol(active.currency)})`}
              value={amount}
              onChangeText={(v) => {
                setFormError('');
                setAmount(v);
              }}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
            <Field label="Due date (YYYY-MM-DD)" value={due} onChangeText={setDue} placeholder="2026-07-10" />
            <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginBottom: 6 }}>Responsible</Text>
            <Row gap={8}>
              {members.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setResponsible(m.id)}
                  style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: (responsible || user?.uid) === m.id ? p.primary : p.surface }}>
                  <Text style={{ color: (responsible || user?.uid) === m.id ? p.primaryInk : p.ink, fontSize: 13 }}>{m.displayName}</Text>
                </Pressable>
              ))}
            </Row>
            <Text style={{ height: 8 }} />
            {formError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{formError}</Text> : null}
            <Button label="Save bill" onPress={() => run('save', addBill)} loading={busy === 'save'} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
