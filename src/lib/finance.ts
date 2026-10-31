import type { Expense, MealType, Settlement } from './models';

export function equalShares(total: number, ids: string[]): Record<string, number> {
  if (ids.length === 0) return {};
  const base = Math.floor((total * 100) / ids.length) / 100;
  const shares: Record<string, number> = {};
  ids.forEach((id, i) => {
    shares[id] = i === ids.length - 1 ? +(total - base * (ids.length - 1)).toFixed(2) : base;
  });
  return shares;
}

export interface Balance {
  uid: string;
  paid: number;
  share: number;
  net: number;
}

export function computeBalances(
  expenses: Expense[],
  settlements: Settlement[],
  memberIds: string[],
): Balance[] {
  const paid: Record<string, number> = {};
  const share: Record<string, number> = {};
  memberIds.forEach((id) => {
    paid[id] = 0;
    share[id] = 0;
  });
  for (const e of expenses) {
    if (e.status === 'voided') continue;
    paid[e.payerId] = (paid[e.payerId] ?? 0) + e.amount;
    for (const pid of e.participantIds) {
      share[pid] = (share[pid] ?? 0) + (e.shares[pid] ?? 0);
    }
  }
  for (const s of settlements) {
    if (s.status === 'rejected') continue;
    if (s.status === 'pending') continue;
    paid[s.payerId] = (paid[s.payerId] ?? 0) + s.amount;
    paid[s.receiverId] = (paid[s.receiverId] ?? 0) - s.amount;
  }
  return memberIds.map((uid) => ({
    uid,
    paid: +(paid[uid] ?? 0).toFixed(2),
    share: +(share[uid] ?? 0).toFixed(2),
    net: +((paid[uid] ?? 0) - (share[uid] ?? 0)).toFixed(2),
  }));
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export function suggestSettlements(balances: Balance[]): Transfer[] {
  const debtors = balances
    .filter((b) => b.net < -0.009)
    .map((b) => ({ uid: b.uid, amount: -b.net }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = balances
    .filter((b) => b.net > 0.009)
    .map((b) => ({ uid: b.uid, amount: b.net }))
    .sort((a, b) => b.amount - a.amount);
  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]!;
    const c = creditors[j]!;
    const amt = Math.min(d.amount, c.amount);
    out.push({ from: d.uid, to: c.uid, amount: +amt.toFixed(2) });
    d.amount -= amt;
    c.amount -= amt;
    if (d.amount < 0.01) i += 1;
    if (c.amount < 0.01) j += 1;
  }
  return out;
}

export interface MealCount {
  uid: string;
  units: Record<string, number>;
}

export interface GuestShare {
  mealId: string;
  count: number;
  /** Member ids splitting this guest cost. Empty means everyone. */
  uids: string[];
}

export interface MealSplit {
  perMember: Record<string, number>;
  meals: Array<{ mealId: string; name: string; pool: number; units: number; perUnit: number }>;
  memberUnits: Record<string, number>;
}

export function allocateFoodCost(
  foodTotal: number,
  mealTypes: MealType[],
  counts: MealCount[],
  guestShares: GuestShare[],
): MealSplit {
  const active = mealTypes.filter((m) => m.active && m.weight > 0);
  const totalWeight = active.reduce((s, m) => s + m.weight, 0);
  const result: Record<string, number> = {};
  const memberUnits: Record<string, number> = {};
  const mealRows: MealSplit['meals'] = [];
  counts.forEach((c) => {
    result[c.uid] = 0;
    memberUnits[c.uid] = 0;
  });
  if (totalWeight <= 0 || foodTotal <= 0) return { perMember: result, meals: mealRows, memberUnits };
  const known = new Set(counts.map((c) => c.uid));
  for (const meal of active) {
    const pool = (foodTotal * meal.weight) / totalWeight;
    let units = 0;
    for (const c of counts) units += c.units[meal.id] ?? 0;
    const extra: Record<string, number> = {};
    for (const e of guestShares) {
      if (e.mealId !== meal.id || !(e.count > 0)) continue;
      const uids = (e.uids.length > 0 ? e.uids : [...known]).filter((u) => known.has(u));
      if (uids.length === 0) continue;
      units += e.count;
      for (const uid of uids) extra[uid] = (extra[uid] ?? 0) + e.count / uids.length;
    }
    if (units <= 0) continue;
    const perUnit = pool / units;
    for (const c of counts) {
      const mine = (c.units[meal.id] ?? 0) + (extra[c.uid] ?? 0);
      result[c.uid] = (result[c.uid] ?? 0) + mine * perUnit;
      memberUnits[c.uid] = (memberUnits[c.uid] ?? 0) + mine;
    }
    mealRows.push({ mealId: meal.id, name: meal.name, pool, units, perUnit });
  }
  for (const key of Object.keys(result)) {
    result[key] = +result[key]!.toFixed(2);
  }
  return { perMember: result, meals: mealRows, memberUnits };
}

export interface CurrencyInfo {
  code: string;
  symbol: string;
  label: string;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'BDT', symbol: '৳', label: 'Bangladeshi Taka' },
  { code: 'USD', symbol: '$', label: 'US Dollar' },
  { code: 'EUR', symbol: '€', label: 'Euro' },
  { code: 'INR', symbol: '₹', label: 'Indian Rupee' },
];

export function currencySymbol(code?: string | null): string {
  if (!code) return '';
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

export function formatMoney(amount: number, currency = 'BDT'): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const grouped = abs.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimals = abs % 1 !== 0 ? `.${abs.toFixed(2).split('.')[1]}` : '';
  return `${sign}${currencySymbol(currency)} ${grouped}${decimals}`;
}

export interface WeightedItem {
  id: string;
  weight: number;
}

/**
 * Scale meal weights so they add up to `total` (normally 100),
 * keeping each meal's relative share. Used whenever the visible set
 * changes: hiding, showing or adding a meal rebalances the rest
 * automatically instead of leaving totals that no longer add up.
 *
 * When the weights are already effectively equal (differences below
 * what anyone can type or see), they split evenly instead of keeping
 * a lopsided 50.01/49.99 style remainder.
 */
export function scaledShares<T extends WeightedItem>(items: T[], total: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (items.length === 0) return out;
  const positive = items.map((i) => (Number.isFinite(i.weight) && i.weight > 0 ? i.weight : 0));
  const sum = positive.reduce((s, w) => s + w, 0);
  if (sum <= 0) return evenSplit(items, total);
  const spread = Math.max(...positive) - Math.min(...positive);
  if (spread <= Math.max(0.02, sum * 0.001)) return evenSplit(items, total);
  let acc = 0;
  items.forEach((it, idx) => {
    if (idx === items.length - 1) {
      out[it.id] = Math.max(0, +(total - acc).toFixed(2));
    } else {
      const w = Math.round((positive[idx]! / sum) * total * 100) / 100;
      out[it.id] = w;
      acc += w;
    }
  });
  return out;
}

/** Split `total` evenly with cent precision, fixing rounding on the last item. */
function evenSplit<T extends WeightedItem>(items: T[], total: number): Record<string, number> {
  const out: Record<string, number> = {};
  const each = Math.floor((total / items.length) * 100) / 100;
  items.forEach((it, idx) => {
    out[it.id] = idx === items.length - 1 ? Math.max(0, +(total - each * (items.length - 1)).toFixed(2)) : each;
  });
  return out;
}

type TimestampLike = { toMillis: () => number };

function convertTimestamps<T>(value: T): T {
  if (value == null || value instanceof Date) return value;
  const maybe = value as unknown as Partial<TimestampLike>;
  if (typeof maybe.toMillis === 'function') {
    return maybe.toMillis() as unknown as T;
  }
  if (Array.isArray(value)) return value.map(convertTimestamps) as unknown as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) {
      out[k] = convertTimestamps((value as Record<string, unknown>)[k]);
    }
    return out as T;
  }
  return value;
}

export { convertTimestamps };

/** Milliseconds since epoch, accepting numbers, Dates and Firestore Timestamps. Never NaN. */
export function toMillis(value: unknown): number {
  const ms = convertTimestamps(value) as unknown;
  if (typeof ms === 'number' && Number.isFinite(ms)) return ms;
  if (ms instanceof Date) return ms.getTime();
  return 0;
}

export function formatDate(value: unknown): string {
  const ms = toMillis(value);
  return ms ? new Date(ms).toLocaleDateString() : '';
}

export function formatDateTime(value: unknown): string {
  const ms = toMillis(value);
  return ms ? new Date(ms).toLocaleString() : '';
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
