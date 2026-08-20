import { create } from 'zustand';

// ─── Types ───────────────────────────────────────────────────────────────────

export type InventorySessionStatus = 'DRAFT' | 'COMPTAGE' | 'CALCUL' | 'VALIDATION';

export interface InventoryItem {
  id: string;
  session_id: string;
  product_id: string;
  product_reference?: string;
  product_designation?: string;
  unit?: string;
  expected_qty: number;
  counted_qty: number | null;
  difference: number | null;
  status?: string;
}

export interface InventorySession {
  id: string;
  name: string;
  notes?: string;
  status: InventorySessionStatus;
  started_at?: string;
  completed_at?: string | null;
  created_at: string;
  items?: InventoryItem[];
  summary?: { total_products: number; counted: number; discrepancies: number };
}

// ─── Workflow labels (UI) ────────────────────────────────────────────────────

export const INVENTORY_STATUS_LABELS: Record<InventorySessionStatus, string> = {
  DRAFT: 'Brouillon',
  COMPTAGE: 'En cours',
  CALCUL: 'Écarts calculés',
  VALIDATION: 'Validé',
};

// ─── Store ───────────────────────────────────────────────────────────────────

interface InventoryState {
  sessions: InventorySession[];
  selectedSession: InventorySession | null;
  isLoading: boolean;
  error: string | null;

  loadSessions: () => Promise<void>;
  loadSessionById: (id: string) => Promise<void>;
  createSession: (name: string, notes?: string) => Promise<InventorySession>;
  startCounting: (id: string) => Promise<void>;
  countItem: (itemId: string, countedQty: number) => Promise<void>;
  calculateGaps: (id: string) => Promise<void>;
  validateSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  selectSession: (session: InventorySession | null) => void;
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  sessions: [],
  selectedSession: null,
  isLoading: false,
  error: null,

  loadSessions: async () => {
    set({ isLoading: true, error: null });
    try {
      const sessions = await window.api.inventory.getAll();
      set({ sessions: sessions || [], isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  loadSessionById: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const session = await window.api.inventory.getById(id);
      set({ selectedSession: session, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  createSession: async (name: string, notes?: string) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.inventory.create({ name, notes });
      await get().loadSessions();
      set({ isLoading: false });
      return result;
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  startCounting: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await window.api.inventory.startCounting(id);
      await get().loadSessionById(id);
      set({ isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  countItem: async (itemId: string, countedQty: number) => {
    set({ isLoading: true, error: null });
    try {
      await window.api.inventory.countItem(itemId, countedQty);
      const selected = get().selectedSession;
      if (selected) {
        await get().loadSessionById(selected.id);
      }
      set({ isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  calculateGaps: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await window.api.inventory.calculateGaps(id);
      await get().loadSessionById(id);
      set({ isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  validateSession: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await window.api.inventory.validate(id);
      await get().loadSessionById(id);
      await get().loadSessions();
      set({ isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  deleteSession: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await window.api.inventory.delete(id);
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== id),
        selectedSession: state.selectedSession?.id === id ? null : state.selectedSession,
        isLoading: false,
      }));
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  selectSession: (session: InventorySession | null) => {
    set({ selectedSession: session });
  },
}));
