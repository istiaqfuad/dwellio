import { useEffect, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type DocumentData,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from './firebase';
import { convertTimestamps } from './finance';

function normalizeDoc<T>(id: string, data: DocumentData): T {
  return convertTimestamps({ id, ...data } as unknown as T);
}

export function useCollection<T extends { id: string }>(
  path: string,
  constraints: QueryConstraint[] = [],
  enabled = true,
): { items: T[]; loading: boolean } {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(enabled);
  const key = constraints.map((c) => c.toString()).join('|');

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const ref = collection(db, path);
    const q = constraints.length > 0 ? query(ref, ...constraints) : query(ref);
    const unsub = onSnapshot(
      q,
      (snap) => {
        setItems(
          snap.docs.map((d) => normalizeDoc<T>(d.id, d.data() as DocumentData)),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, enabled]);

  return { items, loading };
}

export function useOrdered<T extends { id: string }>(
  path: string,
  field: string,
  dir: 'asc' | 'desc' = 'desc',
  max = 100,
  enabled = true,
) {
  return useCollection<T>(path, [orderBy(field, dir), limit(max)], enabled);
}
