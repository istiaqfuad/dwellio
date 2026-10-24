import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './auth-context';
import { ALL_MODULES, type Household, type Member, type Role } from './models';

interface HouseholdState {
  households: Household[];
  archived: Household[];
  active: Household | null;
  members: Member[];
  myRole: Role | null;
  loading: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  selectHousehold: (id: string) => Promise<void>;
  createHousehold: (name: string, currency: string) => Promise<string>;
  updateModules: (modules: Household['modules']) => Promise<void>;
  logActivity: (kind: string, text: string) => Promise<void>;
}

const HouseholdContext = createContext<HouseholdState | null>(null);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [households, setHouseholds] = useState<Household[]>([]);
  const [archived, setArchived] = useState<Household[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setHouseholds([]);
      setArchived([]);
      setActiveId('');
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, 'households'),
      where('memberIds', 'array-contains', user.uid),
    );
    const unsub = onSnapshot(
      q,
      async (snap) => {
        try {
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Household);
          const visible = list.filter((h) => !h.archived);
          setHouseholds(visible);
          setArchived(list.filter((h) => h.archived));
          const uref = doc(db, 'users', user.uid);
          const usnap = await getDoc(uref);
          const saved = (usnap.data()?.activeHouseholdId as string) ?? '';
          if (saved && visible.some((h) => h.id === saved)) {
            setActiveId(saved);
          } else if (visible.length > 0 && !activeId) {
            setActiveId(visible[0]!.id);
          }
        } finally {
          // Always release the gate: a denied read must show an empty
          // household list, never a stuck spinner.
          setLoading(false);
        }
      },
      () => setLoading(false),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  useEffect(() => {
    if (!activeId) {
      setMembers([]);
      return;
    }
    const q = query(collection(db, 'households', activeId, 'members'), orderBy('joinedAt', 'asc'));
    return onSnapshot(q, (snap) => {
      setMembers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Member));
    });
  }, [activeId]);

  const active = useMemo(
    () => households.find((h) => h.id === activeId) ?? null,
    [households, activeId],
  );

  const myRole: Role | null = useMemo(() => {
    if (!user || !active) return null;
    if (active.ownerId === user.uid) return 'owner';
    return members.find((m) => m.id === user.uid)?.role ?? null;
  }, [user, active, members]);

  const selectHousehold = useCallback(
    async (id: string) => {
      setActiveId(id);
      if (!user) return;
      await updateDoc(doc(db, 'users', user.uid), { activeHouseholdId: id });
    },
    [user],
  );

  const createHousehold = useCallback(
    async (name: string, currency: string) => {
      if (!user) throw new Error('Not signed in');
      const displayName = user.displayName ?? 'Member';
      const ref = await addDoc(collection(db, 'households'), {
        name: name.trim(),
        currency: currency.trim().toUpperCase() || 'BDT',
        ownerId: user.uid,
        memberIds: [user.uid],
        modules: ALL_MODULES,
        settlementPolicy: 'receiver',
        guestPolicy: 'host',
        archived: false,
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'households', ref.id, 'members', user.uid), {
        role: 'owner',
        displayName,
        photoURL: user.photoURL ?? '',
        email: user.email ?? '',
        joinedAt: serverTimestamp(),
        excludedFromTasks: false,
      });
      await addDoc(collection(db, 'households', ref.id, 'activity'), {
        kind: 'household',
        text: `${displayName} created the household`,
        actorId: user.uid,
        createdAt: serverTimestamp(),
      });
      await setDoc(
        doc(db, 'users', user.uid),
        { activeHouseholdId: ref.id, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setActiveId(ref.id);
      return ref.id;
    },
    [user],
  );

  const updateModules = useCallback(
    async (modules: Household['modules']) => {
      if (!active) return;
      await updateDoc(doc(db, 'households', active.id), { modules });
    },
    [active],
  );

  const logActivity = useCallback(
    async (kind: string, text: string) => {
      if (!active || !user) return;
      await addDoc(collection(db, 'households', active.id, 'activity'), {
        kind,
        text,
        actorId: user.uid,
        createdAt: serverTimestamp(),
      });
    },
    [active, user],
  );

  const value = useMemo(
    () => ({
      households,
      archived,
      active,
      members,
      myRole,
      loading,
      isAdmin: myRole === 'owner' || myRole === 'admin',
      isOwner: myRole === 'owner',
      selectHousehold,
      createHousehold,
      updateModules,
      logActivity,
    }),
    [households, archived, active, members, myRole, loading, selectHousehold, createHousehold, updateModules, logActivity],
  );
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdState {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error('useHousehold must be used inside HouseholdProvider');
  return ctx;
}
