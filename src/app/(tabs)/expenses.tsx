import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { BackButton, Button, Card, EmptyState, Field, Row, ListRow, Screen, SectionTitle, Subtitle, Title, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import { useCollection } from '@/lib/use-collection';
import { computeBalances, currencySymbol, equalShares, formatMoney, suggestSettlements } from '@/lib/finance';
import { db } from '@/lib/firebase';
import type { Expense, Settlement } from '@/lib/models';

const DEFAULT_CATEGORIES = ['Rent', 'Groceries', 'Electricity', 'Gas', 'Water', 'Internet', 'Cleaning Supplies', 'Household Maintenance', 'Other'];

export default function ExpensesScreen() {
  const p = usePalette();
  const { user } = useAuth();
  const { active, members, isAdmin, logActivity } = useHousehold();
  const hid = active?.id ?? '';

  const { items: expenses, loading: expensesLoading } = useCollection<Expense>(`households/${hid}/expenses`, [], !!hid);
  const { items: settlements, loading: settlementsLoading } = useCollection<Settlement>(`households/${hid}/settlements`, [], !!hid);
  const { items: customCats } = useCollection<{ id: string; name: string }>(`households/${hid}/categories`, [], !!hid);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [formError, setFormError] = useState('');
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
  const [category, setCategory] = useState('Groceries');
  const [payer, setPayer] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [splitMethod, setSplitMethod] = useState<'equal' | 'custom'>('equal');
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState('');
  const [dispute, setDispute] = useState('');
  const [settleFor, setSettleFor] = useState('');
  const [suggestFor, setSuggestFor] = useState<number | null>(null);
  const [suggestAmt, setSuggestAmt] = useState('');
  const [suggestTo, setSuggestTo] = useState('');
  const [suggestError, setSuggestError] = useState('');

  const categories = useMemo(
    () => [...DEFAULT_CATEGORIES, ...customCats.map((c) => c.name)],
    [customCats],
  );

  const balances = useMemo(
    () => (active ? computeBalances(expenses, settlements, active.memberIds) : []),
    [expenses, settlements, active],
  );
  const suggestions = useMemo(() => suggestSettlements(balances), [balances]);
  const nameOf = (uid: string) => members.find((m) => m.id === uid)?.displayName ?? 'Member';
  const sorted = useMemo(() => [...expenses].sort((a, b) => b.date - a.date).slice(0, 60), [expenses]);
  const pendingSettlements = settlements.filter((s) => s.status === 'pending');
  const balancesLoading = expensesLoading || settlementsLoading;
  const userOwes = suggestions.some((s) => s.from === user?.uid);

  if (!active) {
    return (
      <Screen>
        <Title>Expenses</Title>
        <Subtitle>Join or create a household first.</Subtitle>
      </Screen>
    );
  }

  const togglePick = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function saveExpense() {
    if (!user) return;
    if (!title.trim()) {
      setFormError('Give the expense a title first.');
      return;
    }
    const total = parseFloat(amount);
    if (Number.isNaN(total) || total <= 0) {
      setFormError('Enter the amount.');
      return;
    }
    const parts = picked.length > 0 ? picked : active!.memberIds;
    const shares =
      splitMethod === 'equal'
        ? equalShares(total, parts)
        : Object.fromEntries(parts.map((id) => [id, parseFloat(custom[id] ?? '0') || 0]));
    const sum = Object.values(shares).reduce((s, v) => s + v, 0);
    if (Math.abs(sum - total) > 0.02) {
      setFormError('Custom shares must add up to the total.');
      return;
    }
    setFormError('');
    await addDoc(collection(db, 'households', hid, 'expenses'), {
      title: title.trim(),
      description: description.trim(),
      amount: total,
      category,
      date: Date.now(),
      payerId: payer || user.uid,
      participantIds: parts,
      splitMethod,
      shares,
      status: 'normal',
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
    await logActivity('expense', `${user.displayName ?? 'Someone'} added ${title.trim()} (${formatMoney(total, active!.currency)})`);
    setTitle('');
    setDescription('');
    setAmount('');
    setPicked([]);
    setCustom({});
    setShowForm(false);
  }

  async function flagDispute(e: Expense) {
    if (!user || !dispute.trim()) return;
    await updateDoc(doc(db, 'households', hid, 'expenses', e.id), {
      status: 'disputed',
      disputeReason: dispute.trim(),
    });
    await logActivity('dispute', `${user.displayName ?? 'Someone'} disputed ${e.title}`);
    setDispute('');
  }

  async function resolveDispute(e: Expense, voidIt: boolean) {
    await updateDoc(doc(db, 'households', hid, 'expenses', e.id), {
      status: voidIt ? 'voided' : 'resolved',
    });
    await logActivity('expense', `${voidIt ? 'Voided' : 'Resolved dispute on'} ${e.title}`);
  }

  async function recordSettlement(to: string, amountVal: number) {
    if (!user || !active) return;
    await addDoc(collection(db, 'households', hid, 'settlements'), {
      payerId: user.uid,
      receiverId: to,
      amount: amountVal,
      date: Date.now(),
      status: 'pending',
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
    await logActivity('settlement', `${user.displayName ?? 'Someone'} recorded a payment of ${formatMoney(amountVal, active.currency)} to ${nameOf(to)} (waiting for confirmation)`);
  }

  async function settleStatus(s: Settlement, status: 'completed' | 'rejected') {
    await updateDoc(doc(db, 'households', hid, 'settlements', s.id), { status });
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 112 }}>
        <BackButton />
        <Title>Expenses</Title>
        <Subtitle>Shared costs, split fairly. Balances update right away.</Subtitle>

        <SectionTitle>Balances</SectionTitle>
        <Card>
          {balances.map((b) => (
            <ListRow key={b.uid}>
              <Text style={{ flex: 1, color: p.ink, fontWeight: '600' }}>{nameOf(b.uid)}</Text>
              <Text style={{ color: b.net >= 0 ? p.primary : p.danger, fontWeight: '700' }}>
                {formatMoney(b.net, active.currency)}
              </Text>
            </ListRow>
          ))}
        </Card>

        {suggestions.length > 0 && (
          <>
            <SectionTitle>Settle up with fewest payments</SectionTitle>
            {suggestions.map((s, i) => {
              const isPayer = s.from === user?.uid;
              return (
                <Card key={i}>
                  <ListRow>
                    <Text style={{ flex: 1, color: p.ink }}>
                      {nameOf(s.from)} pays {nameOf(s.to)}
                    </Text>
                    <Text style={{ fontWeight: '800', color: p.ink }}>{formatMoney(s.amount, active.currency)}</Text>
                  </ListRow>
                  <Text style={{ height: 8 }} />
                  {!isPayer ? (
                    <Text style={{ fontSize: 13, color: p.muted }}>Waiting for {nameOf(s.from)} to pay.</Text>
                  ) : suggestFor === i ? (
                    <>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginBottom: 6 }}>Pay to</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                        {members
                          .filter((m) => m.id !== user?.uid)
                          .map((m) => (
                            <Pressable
                              key={m.id}
                              onPress={() => setSuggestTo(m.id)}
                              style={{
                                paddingVertical: 7,
                                paddingHorizontal: 12,
                                borderRadius: 16,
                                backgroundColor: (suggestTo || s.to) === m.id ? p.primary : p.surface,
                              }}>
                              <Text style={{ color: (suggestTo || s.to) === m.id ? p.primaryInk : p.ink, fontSize: 13, fontWeight: '600' }}>
                                {m.displayName}
                              </Text>
                            </Pressable>
                          ))}
                      </View>
                      <Field
                        label={`Amount to pay ${nameOf(suggestTo || s.to)} (${currencySymbol(active.currency)})`}
                        value={suggestAmt}
                        onChangeText={(v) => {
                          setSuggestError('');
                          setSuggestAmt(v);
                        }}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                      />
                      {suggestError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{suggestError}</Text> : null}
                      <Row gap={8}>
                        <View style={{ flex: 1 }}>
                          <Button
                            label="Confirm payment"
                            onPress={() => {
                              const n = parseFloat(suggestAmt);
                              if (Number.isNaN(n) || n <= 0) {
                                setSuggestError('Enter the amount being paid.');
                                return;
                              }
                              const to = suggestTo && suggestTo !== user?.uid ? suggestTo : s.to;
                              setSuggestError('');
                              run(`record-${to}-${i}`, () => recordSettlement(to, n)).finally(() => {
                                setSuggestFor(null);
                                setSuggestTo('');
                              });
                            }}
                            loading={busy === `record-${suggestTo || s.to}-${i}`}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button
                            label="Cancel"
                            onPress={() => {
                              setSuggestFor(null);
                              setSuggestTo('');
                              setSuggestError('');
                            }}
                            variant="ghost"
                          />
                        </View>
                      </Row>
                    </>
                  ) : (
                    <Button
                      label="Record payment"
                      onPress={() => {
                        setSuggestAmt(String(s.amount));
                        setSuggestTo(s.to);
                        setSuggestError('');
                        setSuggestFor(i);
                      }}
                      variant="ghost"
                    />
                  )}
                </Card>
              );
            })}
          </>
        )}

        <SectionTitle>Record a settlement</SectionTitle>
        <Card>
          <Text style={{ color: p.muted, fontSize: 13, marginBottom: 8 }}>
            Policy: payments stay pending until the receiver confirms them.
          </Text>
          {pendingSettlements.length > 0 && (
            <View style={{ marginBottom: 10 }}>
              <Text style={{ fontWeight: '700', color: p.ink, marginBottom: 6 }}>Waiting for confirmation</Text>
              {pendingSettlements.map((s) => (
                <View key={s.id} style={{ marginBottom: 8 }}>
                  <Text style={{ color: p.ink, fontSize: 14, marginBottom: 6 }}>
                    {nameOf(s.payerId)} to {nameOf(s.receiverId)} · {formatMoney(s.amount, active.currency)}
                  </Text>
                  {s.receiverId === user?.uid ? (
                    <Row gap={8}>
                      <View style={{ flex: 1 }}>
                        <Button
                          label="Confirm"
                          onPress={() => run(`confirm-${s.id}`, () => settleStatus(s, 'completed'))}
                          loading={busy === `confirm-${s.id}`}
                          size="sm"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button
                          label="Reject"
                          onPress={() => run(`reject-${s.id}`, () => settleStatus(s, 'rejected'))}
                          variant="ghost"
                          size="sm"
                          loading={busy === `reject-${s.id}`}
                        />
                      </View>
                    </Row>
                  ) : (
                    <Text style={{ color: p.muted, fontSize: 13 }}>Waiting for {nameOf(s.receiverId)} to confirm.</Text>
                  )}
                </View>
              ))}
            </View>
          )}
          {!userOwes && !balancesLoading ? (
            <Text style={{ color: p.muted, fontSize: 13 }}>Nothing for you to pay right now.</Text>
          ) : (
            members
              .filter((m) => m.id !== user?.uid)
              .map((m) => (
                <ListRow key={m.id}>
                  <Text style={{ flex: 1, color: p.ink }}>{m.displayName}</Text>
                  {settleFor === m.id ? (
                    <Button label="Cancel" onPress={() => setSettleFor('')} variant="ghost" size="sm" />
                  ) : (
                    <Button label="Pay" onPress={() => setSettleFor(m.id)} size="sm" />
                  )}
                </ListRow>
              ))
          )}
          {settleFor ? (
            <View style={{ marginTop: 8 }}>
              <SettleButton to={settleFor} currency={currencySymbol(active.currency)} onDone={() => setSettleFor('')} onRecord={recordSettlement} />
            </View>
          ) : null}
        </Card>

        <SectionTitle>Expenses</SectionTitle>
        <Button label={showForm ? 'Close form' : 'Add expense'} onPress={() => setShowForm(!showForm)} variant={showForm ? 'ghost' : 'primary'} />
        {showForm && (
          <Card style={{ marginTop: 10 }}>
            <Field
              label="Title"
              value={title}
              onChangeText={(v) => {
                setFormError('');
                setTitle(v);
              }}
              placeholder="Weekly bazaar"
            />
            <Field
              label="Description (optional)"
              value={description}
              onChangeText={setDescription}
              placeholder="What was this for?"
              multiline
              numberOfLines={2}
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
            <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginBottom: 6 }}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              <Row gap={8}>
                {categories.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setCategory(c)}
                    style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: category === c ? p.primary : p.surface }}>
                    <Text style={{ color: category === c ? p.primaryInk : p.ink, fontSize: 13 }}>{c}</Text>
                  </Pressable>
                ))}
              </Row>
            </ScrollView>
            {category === 'Groceries' ? (
              <Text style={{ fontSize: 12, color: p.primary, fontWeight: '600', marginBottom: 8 }}>
                Groceries also count toward meal billing.
              </Text>
            ) : null}
            <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginBottom: 6 }}>Payer</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              <Row gap={8}>
                {members.map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() => setPayer(m.id)}
                    style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: (payer || user?.uid) === m.id ? p.primary : p.surface }}>
                    <Text style={{ color: (payer || user?.uid) === m.id ? p.primaryInk : p.ink, fontSize: 13 }}>{m.displayName}</Text>
                  </Pressable>
                ))}
              </Row>
            </ScrollView>
            <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginBottom: 6 }}>Sharing with (all if none picked)</Text>
            <Row gap={8}>
              {members.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => togglePick(m.id)}
                  style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: picked.includes(m.id) ? p.primary : p.surface }}>
                  <Text style={{ color: picked.includes(m.id) ? p.primaryInk : p.ink, fontSize: 13 }}>{m.displayName}</Text>
                </Pressable>
              ))}
            </Row>
            <Text style={{ height: 10 }} />
            <Row gap={8}>
              {(['equal', 'custom'] as const).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setSplitMethod(m)}
                  style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: splitMethod === m ? p.primary : p.line }}>
                  <Text style={{ color: splitMethod === m ? p.primary : p.ink, fontWeight: '600' }}>{m === 'equal' ? 'Equal' : 'Custom'}</Text>
                </Pressable>
              ))}
            </Row>
            {splitMethod === 'custom' && (
              <View style={{ marginTop: 8 }}>
                {(picked.length > 0 ? members.filter((m) => picked.includes(m.id)) : members).map((m) => (
                  <Field
                    key={m.id}
                    label={m.displayName}
                    value={custom[m.id] ?? ''}
                    onChangeText={(v) => setCustom((prev) => ({ ...prev, [m.id]: v }))}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                  />
                ))}
              </View>
            )}
            <Text style={{ height: 6 }} />
            {formError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{formError}</Text> : null}
            <Button label="Save expense" onPress={() => run('save', saveExpense)} loading={busy === 'save'} />
          </Card>
        )}

        <Text style={{ height: 10 }} />
        {sorted.length === 0 ? (
          <EmptyState title="No expenses yet" hint="Add the first shared expense to get balances moving." />
        ) : (
          sorted.map((e) => (
            <Pressable key={e.id} onPress={() => setExpanded(expanded === e.id ? '' : e.id)}>
              <Card style={e.status === 'disputed' ? { borderColor: p.danger } : undefined}>
                <Row>
                  <Text
                    style={{
                      flex: 1,
                      fontWeight: '700',
                      color: e.status === 'voided' ? p.muted : p.ink,
                      textDecorationLine: e.status === 'voided' ? 'line-through' : 'none',
                    }}>
                    {e.title}
                  </Text>
                  {e.status === 'voided' ? (
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '800',
                        color: p.danger,
                        borderWidth: 1,
                        borderColor: p.danger,
                        borderRadius: 6,
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        marginRight: 8,
                      }}>
                      VOID
                    </Text>
                  ) : null}
                  <Text style={{ fontWeight: '800', color: p.ink }}>{formatMoney(e.amount, active.currency)}</Text>
                </Row>
                <Text style={{ fontSize: 13, color: p.muted }}>
                  {e.category} · {nameOf(e.payerId)} paid · {new Date(e.date).toLocaleDateString()}
                  {e.status !== 'normal' ? ` · ${e.status}` : ''}
                </Text>
                {expanded === e.id && (
                  <View style={{ marginTop: 8 }}>
                    {e.description ? (
                      <Text style={{ fontSize: 13, color: p.ink, marginBottom: 6 }}>{e.description}</Text>
                    ) : null}
                    <Text style={{ fontSize: 13, color: p.ink }}>
                      {e.participantIds.map((id) => `${nameOf(id)}: ${formatMoney(e.shares[id] ?? 0, active.currency)}`).join('  ')}
                    </Text>
                    {e.status === 'disputed' && e.disputeReason ? (
                      <Text style={{ fontSize: 13, color: p.danger, marginTop: 4 }}>Dispute: {e.disputeReason}</Text>
                    ) : null}
                    <Text style={{ height: 8 }} />
                    {(e.createdBy === user?.uid || isAdmin) && e.status !== 'voided' ? (
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                        <View style={{ flex: 1 }}>
                          <Field label="Dispute reason" value={dispute} onChangeText={setDispute} placeholder="What looks wrong?" />
                        </View>
                        <View style={{ paddingBottom: 10 }}>
                          <Button
                            label="Flag"
                            onPress={() => run(`flag-${e.id}`, () => flagDispute(e))}
                            variant="ghost"
                            size="sm"
                            loading={busy === `flag-${e.id}`}
                          />
                        </View>
                      </View>
                    ) : null}
                    {isAdmin && (e.status === 'disputed' || e.status === 'resolved') ? (
                      <Row gap={8}>
                        <View style={{ flex: 1 }}>
                          <Button
                            label="Resolve"
                            onPress={() => run(`resolve-${e.id}`, () => resolveDispute(e, false))}
                            loading={busy === `resolve-${e.id}`}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button
                            label="Void"
                            onPress={() => run(`void-${e.id}`, () => resolveDispute(e, true))}
                            variant="danger"
                            loading={busy === `void-${e.id}`}
                          />
                        </View>
                      </Row>
                    ) : null}
                    {isAdmin && e.status === 'normal' ? (
                      <Button
                        label="Void expense"
                        onPress={() =>
                          run(`void-${e.id}`, async () => {
                            await updateDoc(doc(db, 'households', hid, 'expenses', e.id), { status: 'voided' });
                            await logActivity('expense', `Voided ${e.title}`);
                          })
                        }
                        variant="ghost"
                        loading={busy === `void-${e.id}`}
                      />
                    ) : null}
                  </View>
                )}
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function SettleButton({
  to,
  currency,
  onRecord,
  onDone,
}: {
  to: string;
  currency: string;
  onRecord: (to: string, amount: number) => Promise<void>;
  onDone: () => void;
}) {
  const p = usePalette();
  const [val, setVal] = useState('');
  const [sending, setSending] = useState(false);
  const [settleError, setSettleError] = useState('');
  return (
    <View>
      <Field
        label={`Pay (${currency})`}
        value={val}
        onChangeText={(v) => {
          setSettleError('');
          setVal(v);
        }}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
      {settleError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{settleError}</Text> : null}
      <Button
        label="Confirm payment"
        loading={sending}
        onPress={async () => {
          if (sending) return;
          const n = parseFloat(val);
          if (Number.isNaN(n) || n <= 0) {
            setSettleError('Enter the amount being paid.');
            return;
          }
          setSending(true);
          try {
            await onRecord(to, n);
            setVal('');
            onDone();
          } finally {
            setSending(false);
          }
        }}
      />
    </View>
  );
}
