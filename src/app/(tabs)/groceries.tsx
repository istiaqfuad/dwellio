import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { BackButton, Button, Card, EmptyState, Field, Row, Screen, SectionTitle, Subtitle, Title, Toggle, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import { useCollection } from '@/lib/use-collection';
import { currencySymbol, equalShares, formatMoney } from '@/lib/finance';
import { db } from '@/lib/firebase';
import type { Expense, GroceryItem, ShoppingList } from '@/lib/models';

interface Assignment {
  id: string;
  date: number;
  shopperUid: string;
  status: string;
  listId?: string;
}

const GROCERIES_CLOSED = 'groceries_closed';

export default function GroceriesScreen() {
  const p = usePalette();
  const { user } = useAuth();
  const { active, members, isAdmin, logActivity } = useHousehold();
  const hid = active?.id ?? '';

  const { items: lists, loading: listsLoading } = useCollection<ShoppingList>(`households/${hid}/lists`, [], !!hid);
  const { items: assignments } = useCollection<Assignment>(`households/${hid}/assignments`, [], !!hid);
  const { items: grocerySpending } = useCollection<Expense>(`households/${hid}/expenses`, [], !!hid);
  const { items: flags } = useCollection<{ id: string }>(`households/${hid}/flags`, [], !!hid);
  const groceriesClosed = flags.some((f) => f.id === GROCERIES_CLOSED);

  const [itemName, setItemName] = useState('');
  const [total, setTotal] = useState('');
  const [recordFor, setRecordFor] = useState('');
  const [paid, setPaid] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [itemError, setItemError] = useState('');
  const [purchaseError, setPurchaseError] = useState('');
  const [confirmClearList, setConfirmClearList] = useState(false);

  async function run(key: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  const ensuredRef = useRef('');
  useEffect(() => {
    if (!hid || !user || listsLoading) return;
    if (ensuredRef.current === hid) return;
    ensuredRef.current = hid;
    ensureShared().catch(() => {
      ensuredRef.current = '';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hid, user, listsLoading]);

  const nameOf = (uid: string) => members.find((m) => m.id === uid)?.displayName ?? 'Member';
  const shared = lists.find((l) => l.kind === 'shared');
  const openList = shared?.id ?? '';

  const { items: openItems } = useCollection<GroceryItem>(
    `households/${hid}/lists/${openList || 'none'}/items`,
    [],
    !!openList,
  );
  const remaining = useMemo(() => openItems.filter((i) => !i.purchased).length, [openItems]);

  if (!active) {
    return (
      <Screen>
        <Title>Groceries</Title>
        <Subtitle>Join or create a household first.</Subtitle>
      </Screen>
    );
  }

  async function ensureShared() {
    if (shared || !user) return shared?.id ?? '';
    const ref = await addDoc(collection(db, 'households', hid, 'lists'), {
      name: 'Shared list',
      kind: 'shared',
      locked: false,
      finalized: false,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  }

  async function addItem() {
    if (!user || !openList) return;
    const names = itemName
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (names.length === 0) {
      setItemError('Type the item name first.');
      return;
    }
    setItemError('');
    await Promise.all(
      names.map((name) =>
        addDoc(collection(db, 'households', hid, 'lists', openList, 'items'), {
          name,
          quantity: 1,
          unit: 'pcs',
          category: 'General',
          purchased: false,
          addedBy: user.uid,
          createdAt: serverTimestamp(),
        }),
      ),
    );
    setItemName('');
  }

  async function togglePurchased(item: GroceryItem) {
    await updateDoc(doc(db, 'households', hid, 'lists', openList, 'items', item.id), {
      purchased: !item.purchased,
    });
  }

  async function removeItem(item: GroceryItem) {
    await deleteDoc(doc(db, 'households', hid, 'lists', openList, 'items', item.id));
    await logActivity('grocery', `Removed ${item.name} from the list`);
  }

  async function toggleGroceries() {
    if (groceriesClosed) {
      await deleteDoc(doc(db, 'households', hid, 'flags', GROCERIES_CLOSED));
      await logActivity('grocery', 'Grocery recording is open again');
    } else {
      await setDoc(doc(db, 'households', hid, 'flags', GROCERIES_CLOSED), {
        closed: true,
        createdAt: serverTimestamp(),
      });
      await logActivity('grocery', 'Grocery recording is paused');
    }
  }

  async function assignNext() {
    if (!user) return;
    const eligible = members.filter((m) => m.id !== user.uid);
    const last = assignments[assignments.length - 1];
    const next = eligible.length > 0 ? (eligible[(eligible.findIndex((m) => m.id === last?.shopperUid) + 1) % eligible.length] ?? eligible[0]) : members[0];
    if (!next) return;
    await addDoc(collection(db, 'households', hid, 'assignments'), {
      date: Date.now(),
      shopperUid: next.id,
      status: 'assigned',
      createdAt: serverTimestamp(),
    });
    await logActivity('grocery', `${next.displayName} was assigned the next shopping trip`);
  }

  async function removeAssignment(id: string, shopper: string) {
    await deleteDoc(doc(db, 'households', hid, 'assignments', id));
    await logActivity('grocery', `Removed a shopping assignment (${shopper})`);
  }

  async function clearList() {
    if (!openList) return;
    const itemsSnap = await getDocs(collection(db, 'households', hid, 'lists', openList, 'items'));
    await Promise.all(itemsSnap.docs.map((d) => deleteDoc(d.ref)));
    await logActivity('grocery', 'Cleared the grocery list');
    setConfirmClearList(false);
  }

  async function recordPurchase() {
    if (!user || !recordFor || !active) return;
    if (groceriesClosed) {
      setPurchaseError('Grocery recording is paused right now.');
      return;
    }
    const t = parseFloat(total);
    if (Number.isNaN(t) || t <= 0) {
      setPurchaseError('Enter the total first.');
      return;
    }
    const entered: { uid: string; amount: number }[] = [];
    for (const m of members) {
      const v = parseFloat((paid[m.id] ?? '').trim());
      if (!Number.isNaN(v) && v > 0) entered.push({ uid: m.id, amount: Math.round(v * 100) / 100 });
    }
    let contribs = entered;
    if (entered.length === 0) contribs = [{ uid: user.uid, amount: t }];
    else {
      const splitSum = entered.reduce((s, c) => s + c.amount, 0);
      if (Math.abs(splitSum - t) > 0.01) {
        setPurchaseError('Split amounts must add up to the total.');
        return;
      }
    }
    setPurchaseError('');
    const recordedList = lists.find((l) => l.id === recordFor);
    const listName = recordedList?.name ?? 'list';
    const parts = active.memberIds;
    for (const c of contribs) {
      await addDoc(collection(db, 'households', hid, 'expenses'), {
        title: `Grocery run: ${listName}`,
        description: contribs.length > 1 ? `Recorded from ${listName} (split payment)` : `Recorded from ${listName}`,
        amount: c.amount,
        category: 'Groceries',
        date: Date.now(),
        payerId: c.uid,
        participantIds: parts,
        splitMethod: 'equal',
        shares: equalShares(c.amount, parts),
        status: 'normal',
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
    }
    const itemsSnap = await getDocs(collection(db, 'households', hid, 'lists', recordFor, 'items'));
    const bought = itemsSnap.docs.filter((d) => (d.data() as GroceryItem).purchased);
    await Promise.all(bought.map((d) => deleteDoc(d.ref)));
    if (recordedList?.kind === 'trip' && bought.length === itemsSnap.docs.length) {
      await deleteDoc(doc(db, 'households', hid, 'lists', recordFor));
    }
    await logActivity('grocery', `${user.displayName ?? 'Someone'} recorded a purchase of ${formatMoney(t, active.currency)}`);
    setTotal('');
    setPaid({});
    setRecordFor('');
  }

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 112 }}>
        <BackButton />
        <Title>Groceries</Title>
        <Subtitle>One shared list for the household. Tick items off while shopping, then record what was spent.</Subtitle>
        <Text style={{ height: 12 }} />

        {groceriesClosed || isAdmin ? (
          <Card>
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: p.ink, fontSize: 15 }}>
                  Grocery recording is {groceriesClosed ? 'paused' : 'on'}
                </Text>
                <Text style={{ fontSize: 13, color: p.muted }}>
                  {groceriesClosed ? 'Recording opens again when an admin turns it back on.' : 'Turn off recording for everyone.'}
                </Text>
              </View>
              {isAdmin ? (
                <Toggle value={!groceriesClosed} onChange={() => run('groceries-toggle', toggleGroceries)} disabled={busy === 'groceries-toggle'} />
              ) : null}
            </Row>
          </Card>
        ) : null}

        {!openList ? (
          <View style={{ marginTop: 10 }}>
            <EmptyState title="Setting up" hint="Getting the shared list ready." />
          </View>
        ) : (
          <View style={{ marginTop: 10 }}>
            <Card>
              <Row>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: p.ink, fontSize: 16 }}>
                    {lists.find((l) => l.id === openList)?.name}
                  </Text>
                  <Text style={{ fontSize: 13, color: p.muted }}>{remaining} items to get</Text>
                </View>
                {isAdmin && (
                  <>
                    {confirmClearList ? (
                      <Button
                        label="Tap again to clear"
                        onPress={() => run('clear-list', clearList)}
                        variant="danger"
                        size="sm"
                        loading={busy === 'clear-list'}
                      />
                    ) : (
                      <Button label="Clear list" onPress={() => setConfirmClearList(true)} variant="ghost" size="sm" />
                    )}
                  </>
                )}
              </Row>
              <Text style={{ height: 8 }} />
              {openItems.map((item) => (
                <View key={item.id} style={{ marginBottom: 4 }}>
                  <Row gap={10}>
                    <Pressable
                      onPress={() => run(`toggle-${item.id}`, () => togglePurchased(item))}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: item.purchased }}
                      accessibilityLabel={`Mark ${item.name} as ${item.purchased ? 'not purchased' : 'purchased'}`}
                      style={{ flex: 1 }}>
                      <Row gap={10}>
                        <View
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 7,
                            borderWidth: 2,
                            borderColor: item.purchased ? p.primary : p.line,
                            backgroundColor: item.purchased ? p.primary : 'transparent',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                          {item.purchased ? <View style={{ width: 8, height: 8, borderRadius: 3, backgroundColor: p.primaryInk }} /> : null}
                        </View>
                        <Text style={{ flex: 1, color: item.purchased ? p.muted : p.ink, textDecorationLine: item.purchased ? 'line-through' : 'none' }}>
                          {item.quantity === 1 && item.unit === 'pcs' ? item.name : `${item.name} · ${item.quantity} ${item.unit}`}
                        </Text>
                      </Row>
                    </Pressable>
                    {(item.addedBy === user?.uid || isAdmin) && (
                      <Pressable
                        onPress={() => run(`remove-${item.id}`, () => removeItem(item))}
                        hitSlop={8}
                        style={{ paddingVertical: 4, opacity: busy === `remove-${item.id}` ? 0.4 : 1 }}>
                        <Text style={{ color: p.danger, fontSize: 13, fontWeight: '600' }}>Remove</Text>
                      </Pressable>
                    )}
                  </Row>
                </View>
              ))}
              <Text style={{ height: 8 }} />
              <Field
                label="Add item"
                value={itemName}
                onChangeText={(v) => {
                  setItemError('');
                  setItemName(v);
                }}
                placeholder="2 kg rice, 6 eggs, soap..."
              />
              {itemError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{itemError}</Text> : null}
              <Button label="Add" onPress={() => run('add', addItem)} loading={busy === 'add'} />
              <Text style={{ height: 8 }} />
              {!groceriesClosed && (
                <Button label="Record purchase" onPress={() => setRecordFor(openList)} variant="ghost" />
              )}
            </Card>
          </View>
        )}

        {recordFor ? (
          <Card>
            <Text style={{ fontWeight: '700', color: p.ink, marginBottom: 6 }}>
              Record purchase · {lists.find((l) => l.id === recordFor)?.name ?? 'list'}
            </Text>
            <Field
              label={`Total (${currencySymbol(active.currency)})`}
              value={total}
              onChangeText={(v) => {
                setPurchaseError('');
                setTotal(v);
              }}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
            <Text style={{ fontSize: 12, color: p.muted, marginBottom: 8 }}>
              The full total goes to meal billing. Leave all blank if you paid it all.
            </Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginBottom: 6 }}>Paid by</Text>
            {members.map((m) => (
              <Field
                key={m.id}
                label={m.id === user?.uid ? `${m.displayName} (you)` : m.displayName}
                value={paid[m.id] ?? ''}
                onChangeText={(v) => {
                  setPurchaseError('');
                  setPaid((prev) => ({ ...prev, [m.id]: v }));
                }}
                keyboardType="decimal-pad"
                placeholder={m.id === user?.uid ? total || '0.00' : '0.00'}
              />
            ))}
            {purchaseError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{purchaseError}</Text> : null}
            <Button label="Save purchase" onPress={() => run('purchase', recordPurchase)} loading={busy === 'purchase'} />
          </Card>
        ) : null}

        <SectionTitle>Shopping rotation</SectionTitle>
        {assignments.length === 0 ? (
          <EmptyState title="No assignments yet" hint="Assign the next shopper to start the rotation." />
        ) : (
          assignments.slice(-4).reverse().map((a) => (
            <Card key={a.id}>
              <Row>
                <Text style={{ flex: 1, color: p.ink }}>
                  {nameOf(a.shopperUid)} · {new Date(a.date).toLocaleDateString()} · {a.status}
                </Text>
                {isAdmin ? (
                  <Button
                    label="Remove"
                    onPress={() => run(`unassign-${a.id}`, () => removeAssignment(a.id, nameOf(a.shopperUid)))}
                    variant="ghost"
                    size="sm"
                    loading={busy === `unassign-${a.id}`}
                  />
                ) : null}
              </Row>
            </Card>
          ))
        )}
        {isAdmin && (
          <Button label="Assign next in rotation" onPress={() => run('assign', assignNext)} variant="ghost" loading={busy === 'assign'} />
        )}

        <SectionTitle>Recent grocery spending</SectionTitle>
        {(() => {
          const recent = [...grocerySpending]
            .filter((e) => e.category === 'Groceries')
            .sort((a, b) => b.date - a.date)
            .slice(0, 10);
          return recent.length === 0 ? (
            <EmptyState title="Nothing recorded" hint="Recorded purchases show up here with totals." />
          ) : (
            recent.map((x) => (
              <Card key={x.id}>
                <Row>
                  <Text style={{ flex: 1, color: p.ink, fontWeight: '600' }} numberOfLines={1}>
                    {x.title}
                  </Text>
                  <Text style={{ fontWeight: '800', color: p.ink }}>{formatMoney(x.amount, active.currency)}</Text>
                </Row>
                <Text style={{ fontSize: 13, color: p.muted }}>
                  {new Date(x.date).toLocaleDateString()} · counts toward meal billing and balances
                </Text>
              </Card>
            ))
          );
        })()}
      </ScrollView>
    </Screen>
  );
}
