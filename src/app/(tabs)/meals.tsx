import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { BackButton, Button, Card, EmptyState, Field, ListRow, Row, Screen, SectionTitle, Subtitle, Title, Toggle, usePalette } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import { useCollection } from '@/lib/use-collection';
import { allocateFoodCost, dayKey, formatMoney, scaledShares, type GuestShare } from '@/lib/finance';
import { db } from '@/lib/firebase';
import type { Expense } from '@/lib/models';

interface OptOut {
  id: string;
  uid: string;
  mealTypeId: string;
  day: string;
  endDay?: string;
  indefinite?: boolean;
}

interface GuestReg {
  id: string;
  uid: string;
  day: string;
  mealTypeId: string;
  count: number;
  names?: string;
  sharedWith: string[];
}

interface SkippedDay {
  id: string;
  mealTypeId: string;
  day: string;
  sinceDay?: string;
}

function dayNum(day: string): number {
  const [y, m, d] = day.split('-').map((x) => Number(x));
  return (y || 0) * 10000 + (m || 0) * 100 + (d || 0);
}

export const KITCHEN_CLOSED = 'kitchen-closed';
interface MealTypeDoc {
  id: string;
  name: string;
  weight: number;
  deadline: string;
  guestDeadline: string;
  active: boolean;
  createdAt?: number;
}

interface PurchaseDoc {
  id: string;
  total: number;
  foodTotal: number;
  kind?: string;
  date: number;
}

interface MealAdjustment {
  id: string;
  uid: string;
  mealTypeId: string;
  month: string;
  delta: number;
}

interface FlagDoc {
  id: string;
  total?: number;
}

function fmtU(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function MealsScreen() {
  const p = usePalette();
  const { user } = useAuth();
  const { active, members, isAdmin, logActivity } = useHousehold();
  const hid = active?.id ?? '';

  const { items: mealTypes } = useCollection<MealTypeDoc>(`households/${hid}/mealTypes`, [], !!hid);
  const { items: optOuts } = useCollection<OptOut>(`households/${hid}/optOuts`, [], !!hid);
  const { items: skippedDays } = useCollection<SkippedDay>(`households/${hid}/skippedDays`, [], !!hid);
  const { items: guests } = useCollection<GuestReg>(`households/${hid}/guests`, [], !!hid);
  const { items: purchases } = useCollection<PurchaseDoc>(`households/${hid}/purchases`, [], !!hid);
  const { items: adjustments } = useCollection<MealAdjustment>(`households/${hid}/mealAdjustments`, [], !!hid);
  const { items: flags } = useCollection<FlagDoc>(`households/${hid}/flags`, [], !!hid);
  const { items: groceryExpenses } = useCollection<Expense>(`households/${hid}/expenses`, [], !!hid);

  const [guestMeal, setGuestMeal] = useState('');
  const [guestCount, setGuestCount] = useState('1');
  const [guestNames, setGuestNames] = useState('');
  const [splitWith, setSplitWith] = useState<string[]>([]);
  const pausedAll = user
    ? optOuts.some((o) => o.uid === user.uid && o.mealTypeId === 'all' && o.indefinite)
    : false;

  async function togglePause() {
    if (!user) return;
    const ones = optOuts.filter((o) => o.uid === user.uid && o.mealTypeId === 'all' && o.indefinite);
    if (ones.length > 0) {
      await Promise.all(ones.map((o) => deleteDoc(doc(db, 'households', hid, 'optOuts', o.id))));
      await logActivity('meal', `${user.displayName ?? 'Someone'} turned their meals back on`);
    } else {
      await addDoc(collection(db, 'households', hid, 'optOuts'), {
        uid: user.uid,
        mealTypeId: 'all',
        day: today,
        indefinite: true,
        createdAt: serverTimestamp(),
      });
      await logActivity('meal', `${user.displayName ?? 'Someone'} turned their meals off`);
    }
  }
  const [newMeal, setNewMeal] = useState('');
  const [newWeight, setNewWeight] = useState('');
  const [newDeadline, setNewDeadline] = useState('10:00');
  const [editingMealId, setEditingMealId] = useState('');
  const [editDeadline, setEditDeadline] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [mealFormError, setMealFormError] = useState('');
  const [addMealError, setAddMealError] = useState('');
  const [guestError, setGuestError] = useState('');
  const [guestListError, setGuestListError] = useState('');
  const [adjMember, setAdjMember] = useState('');
  const [adjMeal, setAdjMeal] = useState('');
  const [adjDelta, setAdjDelta] = useState('');
  const [adjTotal, setAdjTotal] = useState('');
  const [adjError, setAdjError] = useState('');
  const kitchenClosed = skippedDays.some((s) => s.id === KITCHEN_CLOSED);
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

  const validTime = (v: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim());

  async function saveMealTimes(mealId: string) {
    const deadline = editDeadline.trim();
    if (!validTime(deadline)) {
      setMealFormError('Use 24 hour time like 09:30 or 18:00.');
      return;
    }
    setMealFormError('');
    const others = mealTypes.filter((m) => m.active && m.id !== mealId);
    const w = parseFloat(editWeight);
    if (!(w > 0) || w > 100) {
      setMealFormError('Weight must be a number between 1 and 100.');
      return;
    }
    if (others.length > 0 && w >= 100) {
      setMealFormError('Weight must be below 100 while other meals are visible.');
      return;
    }
    const rounded = Math.round(w * 100) / 100;
    const shares = others.length > 0 ? scaledShares(others, +(100 - rounded).toFixed(2)) : {};
    await updateDoc(doc(db, 'households', hid, 'mealTypes', mealId), { deadline, weight: rounded });
    await Promise.all(
      Object.entries(shares).map(([id, weight]) => updateDoc(doc(db, 'households', hid, 'mealTypes', id), { weight })),
    );
    await logActivity('meal', 'Updated a meal announce-by time and weight');
    setEditingMealId('');
  }

  function countedFor(uid: string, mealId: string): number | null {
    if (!allocation) return null;
    const u = allocation.units.find((c) => c.uid === uid)?.units ?? {};
    return u[mealId] ?? 0;
  }

  function prefillCount(uid: string, mealId: string) {
    if (!uid || !mealId) return;
    const cur = countedFor(uid, mealId);
    if (cur !== null) setAdjDelta(String(cur));
  }

  async function saveAdjustment() {
    if (!user || !active) return;
    if (!adjMember) {
      setAdjError('Pick whose count to adjust.');
      return;
    }
    if (!adjMeal) {
      setAdjError('Pick which meal to adjust.');
      return;
    }
    const entered = parseInt(adjDelta, 10);
    if (Number.isNaN(entered) || entered < 0 || entered > 31) {
      setAdjError('Enter a whole number from 0 to 31.');
      return;
    }
    const cur = countedFor(adjMember, adjMeal);
    if (cur === null) {
      setAdjError('Counts are still loading. Try again in a moment.');
      return;
    }
    const month = monthKey(new Date());
    const existing = adjustments.find((a) => a.uid === adjMember && a.mealTypeId === adjMeal && a.month === month);
    const natural = cur - (existing?.delta ?? 0);
    const delta = entered - natural;
    if (delta < -31 || delta > 31) {
      setAdjError('Too large a change for one entry.');
      return;
    }
    setAdjError('');
    if (delta === 0) {
      if (existing) {
        await deleteDoc(doc(db, 'households', hid, 'mealAdjustments', existing.id));
        await logActivity('meal', `Cleared a meal count adjustment for ${nameOf(adjMember)}`);
      }
    } else if (existing) {
      await updateDoc(doc(db, 'households', hid, 'mealAdjustments', existing.id), { delta });
      await logActivity('meal', `Set ${nameOf(adjMember)}'s meal count to ${entered}`);
    } else {
      await addDoc(collection(db, 'households', hid, 'mealAdjustments'), {
        uid: adjMember,
        mealTypeId: adjMeal,
        month,
        delta,
        createdAt: serverTimestamp(),
      });
      await logActivity('meal', `Set ${nameOf(adjMember)}'s meal count to ${entered}`);
    }
    setAdjMember('');
    setAdjMeal('');
    setAdjDelta('');
  }

  async function removeAdjustment(id: string) {
    await deleteDoc(doc(db, 'households', hid, 'mealAdjustments', id));
  }

  async function saveMonthTotal() {
    if (!user || !active) return;
    const month = monthKey(new Date());
    const counted = allocation?.countedTotal ?? null;
    if (counted === null) {
      setAdjError('Counts are still loading. Try again in a moment.');
      return;
    }
    const entered = parseInt(adjTotal, 10);
    if (Number.isNaN(entered) || entered < 0) {
      setAdjError('Enter a whole number, 0 or more, for the month total.');
      return;
    }
    setAdjError('');
    if (entered === Math.round(counted)) {
      await deleteDoc(doc(db, 'households', hid, 'flags', `meal-total-${month}`));
      await logActivity('meal', 'Cleared the month total override');
    } else {
      await setDoc(doc(db, 'households', hid, 'flags', `meal-total-${month}`), {
        total: entered,
        updatedAt: serverTimestamp(),
      });
      await logActivity('meal', `Set this month's total meal count to ${entered}`);
    }
    setAdjTotal('');
  }

  async function clearMonthTotal() {
    if (!active) return;
    await deleteDoc(doc(db, 'households', hid, 'flags', `meal-total-${monthKey(new Date())}`));
    await logActivity('meal', 'Cleared the month total override');
    setAdjTotal('');
  }

  async function resetWeights() {
    const visible = mealTypes.filter((m) => m.active);
    if (visible.length === 0) return;
    const shares = scaledShares(visible, 100);
    await Promise.all(
      Object.entries(shares).map(([id, weight]) => updateDoc(doc(db, 'households', hid, 'mealTypes', id), { weight })),
    );
    await logActivity('meal', 'Reset meal weights to equal shares');
  }

  async function removeGuest(g: GuestReg) {
    const meal = mealTypes.find((m) => m.id === g.mealTypeId);
    if (meal && validTime(meal.deadline)) {
      const [hh, mm] = meal.deadline.split(':').map((x) => Number(x));
      const n = new Date();
      const cutoff = new Date(n.getFullYear(), n.getMonth(), n.getDate(), hh ?? 0, mm ?? 0);
      if (Date.now() > cutoff.getTime()) {
        setGuestListError(`Announce time is over for ${meal.name} today, guests can't be changed.`);
        return;
      }
    }
    setGuestListError('');
    await deleteDoc(doc(db, 'households', hid, 'guests', g.id));
    await logActivity('meal', `Removed a guest registration for today`);
  }

  async function setMealActive(m: MealTypeDoc, next: boolean) {
    await updateDoc(doc(db, 'households', hid, 'mealTypes', m.id), { active: next });
    const visible = next
      ? [...mealTypes.filter((x) => x.active), { ...m, active: true }]
      : mealTypes.filter((x) => x.active && x.id !== m.id);
    const shares = scaledShares(visible, 100);
    await Promise.all(
      Object.entries(shares).map(([id, weight]) => updateDoc(doc(db, 'households', hid, 'mealTypes', id), { weight })),
    );
  }

  const today = dayKey(Date.now());
  const todayGuests = guests.filter((g) => g.day === today);
  const isSkipped = (mealId: string, day: string) => {
    if (kitchenClosed) {
      const since = skippedDays.find((s) => s.id === KITCHEN_CLOSED)?.sinceDay as string | undefined;
      if (since && dayNum(day) >= dayNum(since) && dayNum(day) <= dayNum(today)) return true;
    }
    return skippedDays.some((s) => s.mealTypeId === mealId && s.day === day);
  };

  async function toggleKitchen() {
    if (kitchenClosed) {
      await deleteDoc(doc(db, 'households', hid, 'skippedDays', KITCHEN_CLOSED));
    } else {
      await setDoc(doc(db, 'households', hid, 'skippedDays', KITCHEN_CLOSED), {
        mealTypeId: 'all',
        day: 'all',
        sinceDay: today,
        createdAt: serverTimestamp(),
      });
    }
    await logActivity('meal', kitchenClosed ? 'The kitchen is open again' : 'The kitchen is closed for everyone');
  }

  async function toggleSkipped(mealId: string) {
    const id = `${mealId}_${today}`;
    if (skippedDays.some((s) => s.id === id)) {
      await deleteDoc(doc(db, 'households', hid, 'skippedDays', id));
    } else {
      await setDoc(doc(db, 'households', hid, 'skippedDays', id), {
        mealTypeId: mealId,
        day: today,
        createdAt: serverTimestamp(),
      });
    }
  }

  const nameOf = (uid: string) => members.find((m) => m.id === uid)?.displayName ?? 'Member';
  const effectiveSplit = splitWith.length > 0 ? splitWith : user ? [user.uid] : [];

  function toggleSplit(uid: string) {
    setGuestError('');
    if (effectiveSplit.includes(uid)) {
      if (effectiveSplit.length <= 1) {
        setGuestError('Pick at least one member to share the guest bill.');
        return;
      }
      setSplitWith(effectiveSplit.filter((x) => x !== uid));
    } else {
      setSplitWith([...effectiveSplit, uid]);
    }
  }

  const isOut = (uid: string, mealId: string, day: string) => {
    const n = dayNum(day);
    return optOuts.some(
      (o) =>
        o.uid === uid &&
        (o.mealTypeId === mealId || o.mealTypeId === 'all') &&
        (o.indefinite || (dayNum(o.day) <= n && n <= dayNum(o.endDay ?? o.day))),
    );
  };

  const myOutToday = (mealId: string) => (user ? isOut(user.uid, mealId, today) : false);

  async function toggleOptOut(mealId: string) {
    if (!user) return;
    const paused = optOuts.filter(
      (o) => o.uid === user.uid && (o.mealTypeId === mealId || o.mealTypeId === 'all') && o.indefinite,
    );
    if (paused.length > 0) {
      await Promise.all(paused.map((o) => deleteDoc(doc(db, 'households', hid, 'optOuts', o.id))));
      await logActivity('meal', `${user.displayName ?? 'Someone'} turned their meals back on`);
      return;
    }
    const existing = optOuts.find(
      (o) => o.uid === user.uid && o.mealTypeId === mealId && o.day === today && !o.indefinite,
    );
    if (existing) {
      await updateDoc(doc(db, 'households', hid, 'optOuts', existing.id), { mealTypeId: '__cancelled' });
    } else {
      await addDoc(collection(db, 'households', hid, 'optOuts'), {
        uid: user.uid,
        mealTypeId: mealId,
        day: today,
        createdAt: serverTimestamp(),
      });
    }
    await logActivity('meal', `${user.displayName ?? 'Someone'} updated meal participation for today`);
  }

  async function addGuests() {
    if (!user) return;
    if (!guestMeal) {
      setGuestError('Pick which meal the guests are joining.');
      return;
    }
    const count = parseInt(guestCount, 10);
    if (Number.isNaN(count) || count <= 0) {
      setGuestError('Enter how many guests are coming.');
      return;
    }
    const meal = mealTypes.find((m) => m.id === guestMeal);
    if (meal && validTime(meal.deadline)) {
      const [hh, mm] = meal.deadline.split(':').map((x) => Number(x));
      const nowD = new Date();
      const cutoff = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate(), hh ?? 0, mm ?? 0);
      if (Date.now() > cutoff.getTime()) {
        setGuestError(`Announce time is over for ${meal.name} today.`);
        return;
      }
    }
    const sharers = splitWith.length > 0 ? splitWith : [user.uid];
    setGuestError('');
    await addDoc(collection(db, 'households', hid, 'guests'), {
      uid: user.uid,
      day: today,
      mealTypeId: guestMeal,
      count,
      names: guestNames.trim(),
      sharedWith: sharers,
      createdAt: serverTimestamp(),
    });
    await logActivity('meal', `${user.displayName ?? 'Someone'} registered ${count} guest(s) for today`);
    setGuestMeal('');
    setGuestCount('1');
    setGuestNames('');
    setSplitWith([]);
  }

  async function addMealType() {
    if (!newMeal.trim()) {
      setAddMealError('Name the new meal first.');
      return;
    }
    if (!validTime(newDeadline)) {
      setAddMealError('Use 24 hour time like 09:30 or 18:00.');
      return;
    }
    setAddMealError('');
    const w = parseFloat(newWeight) || 0;
    const ref = await addDoc(collection(db, 'households', hid, 'mealTypes'), {
      name: newMeal.trim(),
      weight: w,
      deadline: newDeadline.trim(),
      guestDeadline: '09:00',
      active: true,
      createdAt: serverTimestamp(),
    });
    const withNew = [...mealTypes.filter((m) => m.active), { id: ref.id, weight: w }];
    const shares = scaledShares(withNew, 100);
    await Promise.all(
      Object.entries(shares).map(([id, weight]) => updateDoc(doc(db, 'households', hid, 'mealTypes', id), { weight })),
    );
    await logActivity('meal', `Added ${newMeal.trim()} and rebalanced shares to 100`);
    setNewMeal('');
    setNewWeight('');
    setNewDeadline('10:00');
  }

  async function seedDefaults() {
    const names = ['Breakfast', 'Lunch', 'Dinner'];
    const shares = scaledShares(
      names.map((name, i) => ({ id: `seed-${i}`, weight: 1 })),
      100,
    );
    const weights = names.map((_, i) => shares[`seed-${i}`] ?? 0);
    const defaults = names.map((name, i) => ({ name, weight: weights[i] ?? 0 }));
    for (const d of defaults) {
      await addDoc(collection(db, 'households', hid, 'mealTypes'), {
        ...d,
        deadline: '10:00',
        guestDeadline: '09:00',
        active: true,
        createdAt: serverTimestamp(),
      });
    }
  }

  const allocation = useMemo(() => {
    if (!active) return null;
    const now = new Date();
    const start = Math.max(new Date(now.getFullYear(), now.getMonth(), 1).getTime(), active.createdAt || 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
    const monthLabel = now.toLocaleString('default', { month: 'long' });
    const isPastDay = (ts: number) => dayNum(dayKey(ts)) < dayNum(today);
    const month = monthKey(now);
    const adjustFor = (uid: string, mealId: string) =>
      adjustments
        .filter((a) => a.uid === uid && a.mealTypeId === mealId && a.month === month)
        .reduce((s, a) => s + (Number.isFinite(a.delta) ? a.delta : 0), 0);
    const purchaseTotal = purchases
      .filter((x) => x.date >= start && x.date <= end && isPastDay(x.date))
      .reduce((s, x) => s + (x.total || x.foodTotal || 0), 0);
    const groceryExpenseTotal = groceryExpenses
      .filter((e) => e.status !== 'voided' && e.category === 'Groceries' && e.date >= start && e.date <= end && isPastDay(e.date))
      .reduce((s, e) => s + e.amount, 0);
    const foodTotal = purchaseTotal + groceryExpenseTotal;
    const inPeriod = (day: string) => {
      const ts = new Date(`${day}T12:00:00`).getTime();
      return !Number.isNaN(ts) && ts >= start && ts <= end;
    };
    const todayNum = dayNum(today);
    const counts = active.memberIds.map((uid) => {
      const units: Record<string, number> = {};
      const memStart = Math.max(start, members.find((m) => m.id === uid)?.joinedAt || 0);
      for (const m of mealTypes.filter((t) => t.active)) {
        let days = 0;
        const cur = new Date(Math.max(memStart, m.createdAt || 0));
        const endDate = new Date(end);
        while (cur <= endDate) {
          const dk = dayKey(cur.getTime());
          if (dayNum(dk) >= todayNum) break;
          if (!isOut(uid, m.id, dk) && !isSkipped(m.id, dk)) days += 1;
          cur.setDate(cur.getDate() + 1);
        }
        units[m.id] = Math.max(0, days + adjustFor(uid, m.id));
      }
      return { uid, units };
    });
    const activeMeals = mealTypes.filter((t) => t.active);
    const countedTotal = counts.reduce((s, c) => s + Object.values(c.units).reduce((a, b) => a + b, 0), 0);
    const overrideDoc = flags.find((f) => f.id === `meal-total-${month}`);
    const overrideTotal =
      typeof overrideDoc?.total === 'number' && Number.isFinite(overrideDoc.total) ? overrideDoc.total : null;
    let units = counts;
    if (overrideTotal !== null && counts.length > 0 && activeMeals.length > 0) {
      const extra = (overrideTotal - countedTotal) / counts.length / activeMeals.length;
      units = counts.map((c) => {
        const u: Record<string, number> = {};
        for (const m of activeMeals) u[m.id] = Math.max(0, (c.units[m.id] ?? 0) + extra);
        return { uid: c.uid, units: u };
      });
    }
    const guestShares: GuestShare[] = guests
      .filter((g) => inPeriod(g.day) && !isSkipped(g.mealTypeId, g.day) && dayNum(g.day) < dayNum(today))
      .map((g) => ({ mealId: g.mealTypeId, count: g.count, uids: guestUids(g) }));
    const split = allocateFoodCost(foodTotal, mealTypes, units, guestShares);
    const totalUnits = units.reduce((s, c) => s + Object.values(c.units).reduce((a, b) => a + b, 0), 0);
    return { monthLabel, foodTotal, perMember: split.perMember, units, totalUnits, countedTotal, overrideTotal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchases, groceryExpenses, mealTypes, optOuts, guests, active, adjustments, flags]);

  function guestUids(g: GuestReg): string[] {
    if (g.sharedWith && g.sharedWith.length > 0) return g.sharedWith;
    if (active && active.guestPolicy === 'shared') return members.map((m) => m.id);
    return [g.uid];
  }

  if (!active) {
    return (
      <Screen>
        <Title>Meals</Title>
        <Subtitle>Join or create a household first.</Subtitle>
      </Screen>
    );
  }

  const countedTotal = allocation?.countedTotal ?? 0;
  const overrideTotal = allocation?.overrideTotal ?? null;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 112 }}>
        <BackButton />
        <Title>Meals</Title>
        <Subtitle>Everyone is in by default. Opt out when you skip.</Subtitle>
        <Text style={{ height: 12 }} />

        {mealTypes.length === 0 ? (
          <Card>
            <Text style={{ color: p.ink, marginBottom: 8 }}>No meal types yet.</Text>
            <Button label="Add Breakfast, Lunch, Dinner" onPress={() => run('seed', seedDefaults)} loading={busy === 'seed'} />
          </Card>
        ) : (
          <>
            <Card>
              <Row>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: p.ink, fontSize: 15 }}>
                    My meals are {pausedAll ? 'off' : 'on'}
                  </Text>
                  <Text style={{ fontSize: 13, color: p.muted }}>
                    {pausedAll ? 'Turn them back on when you are back.' : 'Turn off while you are away.'}
                  </Text>
                </View>
                <Toggle value={!pausedAll} onChange={() => run('pause-meals', togglePause)} disabled={busy === 'pause-meals'} />
              </Row>
            </Card>
            {kitchenClosed || isAdmin ? (
              <Card>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: p.ink, fontSize: 15 }}>
                      Kitchen {kitchenClosed ? 'closed' : 'open'}
                    </Text>
                    <Text style={{ fontSize: 13, color: p.muted }}>
                      {kitchenClosed ? 'No meals are running until it opens again.' : 'Turn off all meals for everyone.'}
                    </Text>
                  </View>
                  {isAdmin ? (
                    <Toggle value={!kitchenClosed} onChange={() => run('kitchen', toggleKitchen)} disabled={busy === 'kitchen'} />
                  ) : null}
                </Row>
              </Card>
            ) : null}
            <SectionTitle>Today ({today})</SectionTitle>
            {mealTypes
              .filter((m) => m.active)
              .map((m) => {
                const out = myOutToday(m.id);
                const inCount = members.filter((mem) => !isOut(mem.id, m.id, today)).length;
                const gCount = guests.filter((g) => g.mealTypeId === m.id && g.day === today).reduce((s, g) => s + g.count, 0);
                return (
                  <Card key={m.id}>
                    <Row>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '700', color: p.ink, fontSize: 16 }}>{m.name}</Text>
                        {isSkipped(m.id, today) ? (
                          <Text style={{ fontSize: 13, color: p.primary, fontWeight: '600' }}>Off today</Text>
                        ) : (
                          <Text style={{ fontSize: 13, color: p.muted }}>
                            {inCount} in · {gCount} guests · weight {m.weight}%
                          </Text>
                        )}
                        <Text style={{ fontSize: 13, color: p.muted }}>
                          Announce by {m.deadline}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => run(`rsvp-${m.id}`, () => toggleOptOut(m.id))}
                        style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, backgroundColor: out ? p.surface : p.primary, opacity: busy === `rsvp-${m.id}` ? 0.5 : 1 }}>
                        <Text style={{ color: out ? p.ink : p.primaryInk, fontWeight: '700' }}>{out ? 'Join' : 'Skip'}</Text>
                      </Pressable>
                    </Row>
                    {isAdmin && !kitchenClosed ? (
                      <View style={{ marginTop: 8 }}>
                        <Row>
                          <Text style={{ flex: 1, fontSize: 13, color: p.muted }}>Serve today</Text>
                          <Toggle value={!isSkipped(m.id, today)} onChange={() => run(`skipday-${m.id}`, () => toggleSkipped(m.id))} disabled={busy === `skipday-${m.id}`} />
                        </Row>
                      </View>
                    ) : null}
                  </Card>
                );
              })}
          </>
        )}

        <SectionTitle>Register guests</SectionTitle>
        <Card>
          <Row gap={8}>
            {mealTypes
              .filter((m) => m.active)
              .map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => {
                    setGuestError('');
                    setGuestMeal(m.id);
                  }}
                  style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: guestMeal === m.id ? p.primary : p.surface }}>
                  <Text style={{ color: guestMeal === m.id ? p.primaryInk : p.ink, fontSize: 13 }}>{m.name}</Text>
                </Pressable>
              ))}
          </Row>
          <Text style={{ height: 8 }} />
          <Field label="Guest count" value={guestCount} onChangeText={setGuestCount} keyboardType="number-pad" />
          <Field label="Guest names (optional)" value={guestNames} onChangeText={setGuestNames} placeholder="Who is coming?" />
          <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginBottom: 6 }}>Split between</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {members.map((m) => {
              const selected = effectiveSplit.includes(m.id);
              return (
                <Pressable
                  key={m.id}
                  onPress={() => toggleSplit(m.id)}
                  style={{
                    paddingVertical: 7,
                    paddingHorizontal: 12,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: selected ? p.primary : p.line,
                    backgroundColor: selected ? `${p.primary}1F` : 'transparent',
                  }}>
                  <Text style={{ color: selected ? p.primary : p.ink, fontWeight: '600', fontSize: 13 }}>
                    {m.id === user?.uid ? `${m.displayName} (you)` : m.displayName}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {guestError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{guestError}</Text> : null}
          <Button label="Register guests" onPress={() => run('guests', addGuests)} loading={busy === 'guests'} />
          <Text style={{ fontSize: 12, color: p.muted, marginTop: 8 }}>
            Defaults to just you. Tick others to split a guest bill.
          </Text>
        </Card>

        {todayGuests.length > 0 && (
          <>
            <SectionTitle>Today's guests</SectionTitle>
            {guestListError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{guestListError}</Text> : null}
            {todayGuests.map((g) => (
              <Card key={g.id}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: p.ink }}>
                      {g.names || 'Guest'} · {g.count}
                    </Text>
                    <Text style={{ fontSize: 13, color: p.muted }}>
                      {mealTypes.find((m) => m.id === g.mealTypeId)?.name ?? 'Meal'} · split: {guestUids(g).map(nameOf).join(', ')}
                    </Text>
                  </View>
                  <Button
                    label="Remove"
                    onPress={() => run(`rm-guest-${g.id}`, () => removeGuest(g))}
                    variant="ghost"
                    size="sm"
                    loading={busy === `rm-guest-${g.id}`}
                  />
                </Row>
              </Card>
            ))}
          </>
        )}

        {allocation && (
          <>
            <SectionTitle>Meals · {allocation.monthLabel}</SectionTitle>
            <Card>
              <Text style={{ color: p.ink }}>Grocery spending: {formatMoney(allocation.foodTotal, active.currency)}</Text>
              <Text style={{ fontSize: 13, color: p.muted, marginBottom: 6 }}>
                {fmtU(allocation.totalUnits)} meals this month{allocation.overrideTotal !== null ? ' (adjusted)' : ''}
              </Text>
              {Object.entries(allocation.perMember).map(([uid, amt]) => {
                const u = allocation.units.find((c) => c.uid === uid)?.units ?? {};
                const ownTotal = Object.values(u).reduce((s, v) => s + v, 0);
                return (
                  <View key={uid} style={{ paddingVertical: 7 }}>
                    <Row>
                      <Text style={{ flex: 1, color: p.ink, fontWeight: '700' }}>{nameOf(uid)}</Text>
                      <Text style={{ fontWeight: '700', color: p.ink }}>{formatMoney(amt, active.currency)}</Text>
                    </Row>
                    <Text style={{ fontSize: 13, color: p.muted }}>
                      {mealTypes
                        .filter((m) => m.active)
                        .map((m) => `${m.name} ${fmtU(u[m.id] ?? 0)}`)
                        .join(' · ')}
                      {' · '}Total {fmtU(ownTotal)}
                    </Text>
                  </View>
                );
              })}
            </Card>
          </>
        )}

        {isAdmin && (
          <>
            <SectionTitle>Adjust meal count</SectionTitle>
            <Card>
              <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginBottom: 6 }}>Member</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {members.map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() => {
                      setAdjError('');
                      setAdjMember(m.id);
                      prefillCount(m.id, adjMeal);
                    }}
                    style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: adjMember === m.id ? p.primary : p.line, backgroundColor: adjMember === m.id ? `${p.primary}1F` : 'transparent' }}>
                    <Text style={{ color: adjMember === m.id ? p.primary : p.ink, fontWeight: '600', fontSize: 13 }}>{m.displayName}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginBottom: 6 }}>Meal</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {mealTypes
                  .filter((m) => m.active)
                  .map((m) => (
                    <Pressable
                      key={m.id}
                      onPress={() => {
                        setAdjError('');
                        setAdjMeal(m.id);
                        prefillCount(adjMember, m.id);
                      }}
                      style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: adjMeal === m.id ? p.primary : p.line, backgroundColor: adjMeal === m.id ? `${p.primary}1F` : 'transparent' }}>
                      <Text style={{ color: adjMeal === m.id ? p.primary : p.ink, fontWeight: '600', fontSize: 13 }}>{m.name}</Text>
                    </Pressable>
                  ))}
              </View>
              <Field
                label="Meals counted this month"
                value={adjDelta}
                onChangeText={(v) => {
                  setAdjError('');
                  setAdjDelta(v);
                }}
                keyboardType="numbers-and-punctuation"
                placeholder="0"
              />
              {adjError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{adjError}</Text> : null}
              <Button label="Save adjustment" onPress={() => run('save-adjust', saveAdjustment)} loading={busy === 'save-adjust'} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: p.muted, marginTop: 14, marginBottom: 6 }}>Month total</Text>
              <Text style={{ fontSize: 13, color: p.muted, marginBottom: 6 }}>
                Counted so far: {fmtU(countedTotal)}
                {overrideTotal !== null ? ` · Override: ${overrideTotal}` : ''}
              </Text>
              <Text style={{ fontSize: 13, color: p.muted, marginBottom: 6 }}>
                Set the whole month total directly. The difference from the counted total is shared equally across members.
              </Text>
              <Field
                label="Total meals this month"
                value={adjTotal}
                onChangeText={(v) => {
                  setAdjError('');
                  setAdjTotal(v);
                }}
                keyboardType="numbers-and-punctuation"
                placeholder={String(Math.round(countedTotal))}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button label="Save month total" onPress={() => run('save-total', saveMonthTotal)} loading={busy === 'save-total'} />
                </View>
                {overrideTotal !== null ? (
                  <View style={{ flex: 1 }}>
                    <Button label="Use counted total" variant="ghost" onPress={() => run('clear-total', clearMonthTotal)} loading={busy === 'clear-total'} />
                  </View>
                ) : null}
              </View>
              {(() => {
                const mine = adjustments.filter((a) => a.month === monthKey(new Date()));
                if (mine.length === 0) return null;
                return (
                  <View style={{ marginTop: 10 }}>
                    {mine.map((a) => (
                      <ListRow key={a.id}>
                        <Text style={{ flex: 1, color: p.ink, fontSize: 14 }}>
                          {nameOf(a.uid)} · {mealTypes.find((m) => m.id === a.mealTypeId)?.name ?? 'Meal'} · {a.delta > 0 ? '+' : ''}{a.delta}
                        </Text>
                        <Button label="Remove" onPress={() => run(`unadjust-${a.id}`, () => removeAdjustment(a.id))} variant="ghost" size="sm" loading={busy === `unadjust-${a.id}`} />
                      </ListRow>
                    ))}
                  </View>
                );
              })()}
            </Card>
          </>
        )}

        {isAdmin && (
          <>
            <SectionTitle>Meal types (admin)</SectionTitle>
            {mealTypes.map((m) => (
              <Card key={m.id}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: p.ink }}>{m.name}</Text>
                    <Text style={{ fontSize: 13, color: p.muted }}>
                      Weight {m.weight}% · announce by {m.deadline}
                    </Text>
                  </View>
                  <Button
                    label={m.active ? 'Hide' : 'Show'}
                    onPress={() => run(`active-${m.id}`, () => setMealActive(m, !m.active))}
                    variant="ghost"
                    size="sm"
                    loading={busy === `active-${m.id}`}
                  />
                </Row>
                {editingMealId === m.id ? (
                  <View style={{ marginTop: 12 }}>
                    <Field
                      label="Announce by (24h, e.g. 09:30)"
                      value={editDeadline}
                      onChangeText={(v) => {
                        setMealFormError('');
                        setEditDeadline(v);
                      }}
                      placeholder={m.deadline}
                      maxLength={5}
                    />
                    <Field
                      label="Weight percent (visible meals always total 100)"
                      value={editWeight}
                      onChangeText={(v) => {
                        setMealFormError('');
                        setEditWeight(v);
                      }}
                      keyboardType="decimal-pad"
                      placeholder={String(m.weight)}
                      maxLength={6}
                    />
                    {mealFormError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{mealFormError}</Text> : null}
                    <Row gap={8}>
                      <View style={{ flex: 1 }}>
                        <Button label="Save" onPress={() => run(`save-${m.id}`, () => saveMealTimes(m.id))} size="sm" loading={busy === `save-${m.id}`} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button
                          label="Cancel"
                          onPress={() => {
                            setEditingMealId('');
                            setMealFormError('');
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
                      label="Change time and weight"
                      onPress={() => {
                        setMealFormError('');
                        setEditDeadline(m.deadline);
                        setEditWeight(String(m.weight));
                        setEditingMealId(m.id);
                      }}
                      variant="ghost"
                      size="sm"
                    />
                  </View>
                )}
              </Card>
            ))}
            <Button
              label="Reset weights equally"
              onPress={() => run('reset-weights', resetWeights)}
              variant="ghost"
              loading={busy === 'reset-weights'}
            />
            <Text style={{ height: 10 }} />
            <Card>
              <Field
                label="New meal name"
                value={newMeal}
                onChangeText={(v) => {
                  setAddMealError('');
                  setNewMeal(v);
                }}
                placeholder="Evening snacks"
              />
              <Field label="Weight percent" value={newWeight} onChangeText={setNewWeight} keyboardType="decimal-pad" placeholder="10" />
              <Field
                label="Announce by (24h)"
                value={newDeadline}
                onChangeText={(v) => {
                  setAddMealError('');
                  setNewDeadline(v);
                }}
                placeholder="10:00"
                maxLength={5}
              />
              {addMealError ? <Text style={{ color: p.danger, fontSize: 13, marginBottom: 8 }}>{addMealError}</Text> : null}
              <Button label="Add meal type" onPress={() => run('add-meal', addMealType)} variant="ghost" loading={busy === 'add-meal'} />
            </Card>
          </>
        )}

      </ScrollView>
    </Screen>
  );
}
