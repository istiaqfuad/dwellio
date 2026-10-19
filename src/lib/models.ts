export type Role = 'owner' | 'admin' | 'member';

export interface HouseholdModules {
  expenses: boolean;
  meals: boolean;
  groceries: boolean;
  tasks: boolean;
  calendar: boolean;
  bills: boolean;
  polls: boolean;
  announcements: boolean;
}

export const ALL_MODULES: HouseholdModules = {
  expenses: true,
  meals: true,
  groceries: true,
  tasks: true,
  calendar: true,
  bills: true,
  polls: true,
  announcements: true,
};

export interface Household {
  id: string;
  name: string;
  currency: string;
  description?: string;
  photoURL?: string;
  ownerId: string;
  memberIds: string[];
  modules: HouseholdModules;
  settlementPolicy: 'immediate' | 'receiver';
  guestPolicy: 'host' | 'shared';
  archived: boolean;
  createdAt: number;
}

export interface Member {
  id: string;
  role: Role;
  displayName: string;
  photoURL?: string;
  email?: string;
  joinedAt: number;
  excludedFromTasks: boolean;
}

export type SplitMethod = 'equal' | 'custom';

export interface Expense {
  id: string;
  title: string;
  amount: number;
  category: string;
  date: number;
  payerId: string;
  participantIds: string[];
  splitMethod: SplitMethod;
  shares: Record<string, number>;
  description?: string;
  status: 'normal' | 'disputed' | 'resolved' | 'voided';
  disputeReason?: string;
  createdBy: string;
  createdAt: number;
}

export interface Settlement {
  id: string;
  payerId: string;
  receiverId: string;
  amount: number;
  date: number;
  note?: string;
  status: 'completed' | 'pending' | 'rejected';
  createdBy: string;
  createdAt: number;
}

export interface MealType {
  id: string;
  name: string;
  weight: number;
  deadline: string;
  guestDeadline: string;
  active: boolean;
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high';
  deadline?: number;
  assigneeId?: string;
  status:
    | 'unassigned'
    | 'assigned'
    | 'in_progress'
    | 'awaiting_approval'
    | 'completed'
    | 'overdue'
    | 'cancelled';
  approvalRequired: boolean;
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly';
  createdBy: string;
  createdAt: number;
}

export interface GroceryItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  note?: string;
  category: string;
  purchased: boolean;
  addedBy: string;
}

export interface ShoppingList {
  id: string;
  name: string;
  kind: 'shared' | 'trip';
  locked: boolean;
  finalized: boolean;
  assigneeId?: string;
  tripDate?: number;
  createdAt: number;
}

export interface Purchase {
  id: string;
  listId: string;
  total: number;
  date: number;
  kind: 'food' | 'supplies' | 'mixed';
  foodTotal: number;
  suppliesTotal: number;
  contributions: { uid: string; amount: number }[];
  recordedBy: string;
  createdAt: number;
}

export interface Bill {
  id: string;
  title: string;
  amount: number;
  dueDate: number;
  status: 'unpaid' | 'paid' | 'overdue';
  responsibleId: string;
  expenseId?: string;
  createdAt: number;
}

export interface Poll {
  id: string;
  title: string;
  description?: string;
  options: string[];
  votes: Record<string, number>;
  anonymous: boolean;
  allowChange: boolean;
  deadline?: number;
  open: boolean;
  createdBy: string;
  createdAt: number;
}

export interface Announcement {
  id: string;
  title: string;
  message: string;
  pinned: boolean;
  commentsEnabled: boolean;
  ackedBy: string[];
  createdBy: string;
  createdAt: number;
}

export interface ActivityEntry {
  id: string;
  kind: string;
  text: string;
  actorId: string;
  createdAt: number;
}

export interface BillingPeriod {
  id: string;
  name: string;
  start: number;
  end: number;
  status: 'open' | 'locked';
  createdAt: number;
}
