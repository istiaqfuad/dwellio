import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, EmptyState, Row, ListRow, Screen, SectionTitle, Skeleton, Subtitle, Title, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import { useCollection } from '@/lib/use-collection';
import { computeBalances, currencySymbol, dayKey, formatDate, formatDateTime, formatMoney, toMillis } from '@/lib/finance';
import { KITCHEN_CLOSED } from './meals';
import type { ActivityEntry, Announcement, Bill, Expense, GroceryItem, MealType, Settlement, ShoppingList, TaskItem } from '@/lib/models';

interface OptOut {
  id: string;
  uid: string;
  mealTypeId: string;
  day: string;
  endDay?: string;
  indefinite?: boolean;
}

function dayNum(day: string): number {
  const [y, m, d] = day.split('-').map((x) => Number(x));
  return (y || 0) * 10000 + (m || 0) * 100 + (d || 0);
}

interface GuestReg {
  id: string;
  uid: string;
  day: string;
  mealTypeId: string;
  count: number;
}

interface Assignment {
  id: string;
  date: number;
  shopperUid: string;
  status: string;
  listId?: string;
}

function startOfMonth(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export default function DashboardScreen() {
  const p = usePalette();
  const { user } = useAuth();
  const { households, active, members, loading, selectHousehold } = useHousehold();
  const hid = active?.id ?? '';

  const { items: expenses, loading: expensesLoading } = useCollection<Expense>(
    `households/${hid}/expenses`,
    [],
    !!hid && !!active?.modules.expenses,
  );
  const { items: settlements, loading: settlementsLoading } = useCollection<Settlement>(
    `households/${hid}/settlements`,
    [],
    !!hid,
  );
  const { items: tasks, loading: tasksLoading } = useCollection<TaskItem>(
    `households/${hid}/tasks`,
    [],
    !!hid && !!active?.modules.tasks,
  );
  const { items: announcements, loading: announcementsLoading } = useCollection<Announcement>(
    `households/${hid}/announcements`,
    [],
    !!hid && !!active?.modules.announcements,
  );
  const { items: activity, loading: activityLoading } = useCollection<ActivityEntry>(
    `households/${hid}/activity`,
    [],
    !!hid,
  );
  const { items: mealTypes, loading: mealTypesLoading } = useCollection<MealType>(
    `households/${hid}/mealTypes`,
    [],
    !!hid && !!active?.modules.meals,
  );
  const { items: optOuts, loading: optOutsLoading } = useCollection<OptOut>(
    `households/${hid}/optOuts`,
    [],
    !!hid && !!active?.modules.meals,
  );
  const { items: guestRegs, loading: guestRegsLoading } = useCollection<GuestReg>(
    `households/${hid}/guests`,
    [],
    !!hid && !!active?.modules.meals,
  );
  const { items: skippedToday } = useCollection<{ id: string; mealTypeId: string }>(
    `households/${hid}/skippedDays`,
    [],
    !!hid && !!active?.modules.meals,
  );
  const { items: assignments, loading: assignmentsLoading } = useCollection<Assignment>(
    `households/${hid}/assignments`,
    [],
    !!hid && !!active?.modules.groceries,
  );
  const { items: bills, loading: billsLoading } = useCollection<Bill>(
    `households/${hid}/bills`,
    [],
    !!hid && !!active?.modules.bills,
  );
  const { items: groceryLists, loading: groceryListsLoading } = useCollection<ShoppingList>(
    `households/${hid}/lists`,
    [],
    !!hid && !!active?.modules.groceries,
  );
  const sharedList = groceryLists.find((l) => l.kind === 'shared');
  const { items: sharedItems, loading: sharedItemsLoading } = useCollection<GroceryItem>(
    `households/${hid}/lists/${sharedList?.id ?? 'none'}/items`,
    [],
    !!hid && !!sharedList,
  );
  const remainingGroceries = sharedItems.filter((i) => !i.purchased);
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

  async function toggleGrocery(item: GroceryItem) {
    if (!sharedList) return;
    await updateDoc(doc(db, 'households', hid, 'lists', sharedList.id, 'items', item.id), {
      purchased: !item.purchased,
    });
  }

  if (!active && !loading) {
    return (
      <Screen>
        <Text style={{ height: 16 }} />
        <Title>No household yet</Title>
        <Subtitle>Create one to start tracking shared life together.</Subtitle>
        <Text style={{ height: 16 }} />
        <Link href="/create-household" asChild>
          <Pressable
            style={{ backgroundColor: p.primary, borderRadius: 10, padding: 14, alignItems: 'center' }}>
            <Text style={{ color: p.primaryInk, fontWeight: '700' }}>Create household</Text>
          </Pressable>
        </Link>
        <Link href="/join-household" asChild>
          <Pressable
            style={{ borderWidth: 1, borderColor: p.line, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 }}>
            <Text style={{ color: p.primary, fontWeight: '700' }}>Join with an invite code</Text>
          </Pressable>
        </Link>
      </Screen>
    );
  }

  const currency = active?.currency ?? 'BDT';
  const monthSpend = expenses
    .filter((e) => e.status !== 'voided' && e.date >= startOfMonth())
    .reduce((s, e) => s + e.amount, 0);
  const balances = active ? computeBalances(expenses, settlements, active.memberIds) : [];
  const overviewLoading = expensesLoading || settlementsLoading;
  const mealsLoading = mealTypesLoading || optOutsLoading || guestRegsLoading;
  const groceryLoading = groceryListsLoading || sharedItemsLoading;
  const upLoading = assignmentsLoading || billsLoading || settlementsLoading;
  const mine = balances.find((b) => b.uid === user?.uid);
  const openTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  const pinned = announcements.filter((a) => a.pinned).slice(0, 2);
  const recent = [...activity].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)).slice(0, 6);
  const nameOf = (uid: string) => members.find((m) => m.id === uid)?.displayName ?? 'Member';

  const today = dayKey(Date.now());
  const todayNum = dayNum(today);
  const isOut = (uid: string, mealId: string) =>
    optOuts.some(
      (o) =>
        o.uid === uid &&
        (o.mealTypeId === mealId || o.mealTypeId === 'all') &&
        (o.indefinite || (dayNum(o.day) <= todayNum && todayNum <= dayNum(o.endDay ?? o.day))),
    );
  const kitchenClosedToday = skippedToday.some((s) => s.id === KITCHEN_CLOSED);
  const isSkippedToday = (mealId: string) => kitchenClosedToday || skippedToday.some((s) => s.mealTypeId === mealId);
  const mealsToday = mealTypes
    .filter((m) => m.active)
    .map((m) => ({
      meal: m,
      skipped: isSkippedToday(m.id),
      inCount: members.filter((mem) => !isOut(mem.id, m.id)).length,
      guestCount: guestRegs.filter((g) => g.mealTypeId === m.id && g.day === today).reduce((s, g) => s + g.count, 0),
    }));
  const nextShopping = [...assignments]
    .filter((a) => a.date >= Date.now() - 86400000)
    .sort((a, b) => a.date - b.date)[0];
  const nextBill = bills
    .filter((b) => b.status !== 'paid')
    .sort((a, b) => a.dueDate - b.dueDate)[0];
  const pendingForMe = settlements.filter((s) => s.status === 'pending' && s.receiverId === user?.uid);
  const hasUpcoming = !!nextShopping || !!nextBill || pendingForMe.length > 0;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 112 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
          <Row gap={8}>
            {loading && households.length === 0 ? <Skeleton height={36} width={120} /> : null}
            {households.map((h) => (
              <Pressable
                key={h.id}
                onPress={() => selectHousehold(h.id)}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: 20,
                  backgroundColor: h.id === active?.id ? p.primary : p.surface,
                  borderWidth: 1,
                  borderColor: h.id === active?.id ? p.primary : p.line,
                }}>
                <Text style={{ color: h.id === active?.id ? p.primaryInk : p.ink, fontWeight: '600' }}>{h.name}</Text>
              </Pressable>
            ))}
            <Link href="/create-household" asChild>
              <Pressable
                style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: p.line }}>
                <Text style={{ color: p.primary, fontWeight: '700' }}>+ New</Text>
              </Pressable>
            </Link>
          </Row>
        </ScrollView>

        <Title>{active?.name ?? 'My home'}</Title>
        <Subtitle>
          {active ? `${members.length} members · ${currencySymbol(active.currency)}` : 'Getting your home ready…'}
        </Subtitle>

        <SectionTitle>Overview</SectionTitle>
        {overviewLoading ? (
          <Row gap={8}>
            <View style={{ flex: 1 }}>
              <Card>
                <Skeleton height={28} width="70%" />
                <Skeleton height={14} width="50%" />
              </Card>
            </View>
            <View style={{ flex: 1 }}>
              <Card>
                <Skeleton height={28} width="70%" />
                <Skeleton height={14} width="50%" />
              </Card>
            </View>
          </Row>
        ) : (
          <Row gap={8}>
            <View style={{ flex: 1 }}>
              <Card>
                <Text style={{ fontSize: 12, color: p.muted }}>Spent this month</Text>
                <Text style={{ fontSize: 22, fontWeight: '800', color: p.ink }}>{formatMoney(monthSpend, currency)}</Text>
              </Card>
            </View>
            <View style={{ flex: 1 }}>
              <Card>
                <Text style={{ fontSize: 12, color: p.muted }}>My balance</Text>
                <Text style={{ fontSize: 22, fontWeight: '800', color: (mine?.net ?? 0) >= 0 ? p.primary : p.danger }}>
                  {formatMoney(mine?.net ?? 0, currency)}
                </Text>
                <Text style={{ fontSize: 12, color: p.muted }}>
                  {(mine?.net ?? 0) >= 0 ? 'others owe you' : 'you owe others'}
                </Text>
              </Card>
            </View>
          </Row>
        )}

        {active ? (
          <Link href="/household" asChild>
            <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
              <Card>
                <Row>
                  <Text style={{ flex: 1, color: p.ink, fontWeight: '700', fontSize: 15 }}>
                    Household · {members.length} members
                  </Text>
                  <Text style={{ color: p.primary, fontWeight: '600' }}>Manage ›</Text>
                </Row>
              </Card>
            </Pressable>
          </Link>
        ) : (
          <Card>
            <Skeleton height={20} width="60%" />
          </Card>
        )}

        {!!active?.modules.meals && (
          <>
            <SectionTitle>Meals today</SectionTitle>
            {mealsLoading ? (
              <Card>
                <Skeleton height={18} />
                <Skeleton height={14} width="70%" />
                <Skeleton height={18} />
                <Skeleton height={14} width="70%" />
              </Card>
            ) : mealsToday.length === 0 ? (
              <EmptyState title="No meals set up" hint="Add your meal types in Meals to track who eats." />
            ) : (
              <Card>
                {mealsToday.map(({ meal, inCount, guestCount, skipped }) => (
                  <ListRow key={meal.id}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: p.ink, fontWeight: '700', fontSize: 16 }}>
                        {meal.name}{skipped ? ' · off today' : ` · ${inCount + guestCount} eating`}
                      </Text>
                      {!skipped && (
                        <Text style={{ fontSize: 13, color: p.muted }}>
                          {inCount} members · {guestCount} guests · by {meal.deadline}
                        </Text>
                      )}
                    </View>
                  </ListRow>
                ))}
                <Link href="/meals" asChild>
                  <Pressable style={{ marginTop: 10, alignItems: 'center' }}>
                    <Text style={{ color: p.primary, fontWeight: '600', fontSize: 13 }}>Plan meals ›</Text>
                  </Pressable>
                </Link>
              </Card>
            )}
          </>
        )}

        {!!active?.modules.groceries && (
          <>
            <SectionTitle>
              Shared grocery list{sharedList && remainingGroceries.length > 0 ? ` (${remainingGroceries.length} to get)` : ''}
            </SectionTitle>
            {groceryLoading ? (
              <Card>
                <Skeleton height={18} />
                <Skeleton height={18} />
                <Skeleton height={14} width="60%" />
              </Card>
            ) : (
            <Card>
              {!sharedList ? (
                <Text style={{ color: p.muted, fontSize: 13 }}>Nothing on the shared list yet.</Text>
              ) : remainingGroceries.length === 0 ? (
                <Text style={{ color: p.ink, fontSize: 14 }}>All ticked off. The next bazaar run can wait.</Text>
              ) : (
                remainingGroceries.slice(0, 5).map((g) => (
                  <Pressable
                    key={g.id}
                    onPress={() => run(`grocery-${g.id}`, () => toggleGrocery(g))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: g.purchased }}
                    accessibilityLabel={`Tick off ${g.name}`}
                    style={{ opacity: busy === `grocery-${g.id}` ? 0.5 : 1 }}>
                    <ListRow>
                      <View
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 7,
                          borderWidth: 2,
                          borderColor: g.purchased ? p.primary : p.line,
                          backgroundColor: g.purchased ? p.primary : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        {g.purchased ? <View style={{ width: 8, height: 8, borderRadius: 3, backgroundColor: p.primaryInk }} /> : null}
                      </View>
                      <Text style={{ flex: 1, color: p.ink }} numberOfLines={1}>
                        {g.quantity === 1 && g.unit === 'pcs' ? g.name : `${g.name} · ${g.quantity} ${g.unit}`}
                      </Text>
                    </ListRow>
                  </Pressable>
                ))
              )}
              {sharedList && remainingGroceries.length > 5 ? (
                <Text style={{ fontSize: 13, color: p.muted }}>+{remainingGroceries.length - 5} more on the list</Text>
              ) : null}
              <Link href="/groceries" asChild>
                <Pressable style={{ marginTop: 10, alignItems: 'center' }}>
                  <Text style={{ color: p.primary, fontWeight: '600', fontSize: 13 }}>Open groceries ›</Text>
                </Pressable>
              </Link>
            </Card>
            )}
          </>
        )}

        {(hasUpcoming || upLoading) && (
          <>
            <SectionTitle>Coming up</SectionTitle>
            {upLoading && !hasUpcoming ? (
              <Card>
                <Skeleton height={18} />
                <Skeleton height={14} width="80%" />
              </Card>
            ) : (
            <Card>
              {nextShopping ? (
                <Link href="/groceries" asChild>
                  <Pressable>
                    <ListRow>
                      <Text style={{ flex: 1, color: p.ink }}>Next shopping · {nameOf(nextShopping.shopperUid)}</Text>
                      <Text style={{ fontSize: 13, color: p.muted }}>{formatDate(nextShopping.date)}</Text>
                    </ListRow>
                  </Pressable>
                </Link>
              ) : null}
              {nextBill ? (
                <Link href="/bills" asChild>
                  <Pressable>
                    <ListRow>
                      <Text style={{ flex: 1, color: p.ink }} numberOfLines={1}>
                        {nextBill.title} due
                      </Text>
                      <Text style={{ fontSize: 13, color: p.muted }}>
                        {formatDate(nextBill.dueDate)} · {formatMoney(nextBill.amount, currency)}
                      </Text>
                    </ListRow>
                  </Pressable>
                </Link>
              ) : null}
              {pendingForMe.map((s) => (
                <Link key={s.id} href="/expenses" asChild>
                  <Pressable>
                    <ListRow>
                      <Text style={{ flex: 1, color: p.ink }} numberOfLines={1}>
                        Confirm payment from {nameOf(s.payerId)}
                      </Text>
                      <Text style={{ fontSize: 13, color: p.primary, fontWeight: '700' }}>
                        {formatMoney(s.amount, currency)}
                      </Text>
                    </ListRow>
                  </Pressable>
                </Link>
              ))}
            </Card>
            )}
          </>
        )}

        {!!active?.modules.tasks && (openTasks.length > 0 || tasksLoading) && (
          <>
            <SectionTitle>Open tasks ({openTasks.length})</SectionTitle>
            {tasksLoading && openTasks.length === 0 ? (
              <Card>
                <Skeleton height={18} />
                <Skeleton height={14} width="70%" />
              </Card>
            ) : (
            openTasks.slice(0, 3).map((t) => (
              <Card key={t.id}>
                <Text style={{ fontWeight: '700', color: p.ink }}>{t.title}</Text>
                <Text style={{ fontSize: 13, color: p.muted }}>
                  {[t.assigneeId ? nameOf(t.assigneeId) : 'Unassigned', t.status.replace('_', ' ')].join(' · ')}
                </Text>
              </Card>
            ))
            )}
          </>
        )}

        {(pinned.length > 0 || announcementsLoading) && (
          <>
            <SectionTitle>Pinned</SectionTitle>
            {announcementsLoading && pinned.length === 0 ? (
              <Card>
                <Skeleton height={18} />
                <Skeleton height={14} width="80%" />
              </Card>
            ) : (
            pinned.map((a) => (
              <Card key={a.id} style={{ borderColor: p.accent }}>
                <Text style={{ fontWeight: '700', color: p.ink }}>{a.title}</Text>
                <Text style={{ fontSize: 13, color: p.muted }} numberOfLines={2}>{a.message}</Text>
              </Card>
            ))
            )}
          </>
        )}

        <SectionTitle>Recent activity</SectionTitle>
        {activityLoading && recent.length === 0 ? (
          <Card>
            <Skeleton height={16} />
            <Skeleton height={12} width="60%" />
            <Skeleton height={16} />
            <Skeleton height={12} width="60%" />
          </Card>
        ) : recent.length === 0 ? (
          <EmptyState title="Quiet so far" hint="New expenses, tasks and updates will show up here." />
        ) : (
          recent.map((a) => (
            <Card key={a.id}>
              <Text style={{ fontSize: 14, color: p.ink }}>{a.text}</Text>
              <Text style={{ fontSize: 12, color: p.muted }}>{formatDateTime(a.createdAt)}</Text>
            </Card>
          ))
        )}

      </ScrollView>
    </Screen>
  );
}
