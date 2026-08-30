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

export interface InventoryVersion {
  id: string;
  session_id: string;
  version_number: number;
  created_at: string;
  note?: string | null;
  items?: Array<{ product_id: string; counted_qty: number }>;
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
  versions: InventoryVersion[];
  isLoading: boolean;
  error: string | null;

  loadSessions: () => Promise<void>;
  loadSessionById: (id: string) => Promise<void>;
  createSession: (name: string, notes?: string) => Promise<InventorySession>;
  updateSession: (id: string, data: { name: string; notes?: string; status?: InventorySessionStatus }) => Promise<void>;
  startCounting: (id: string) => Promise<void>;
  countItem: (itemId: string, countedQty: number) => Promise<void>;
  calculateGaps: (id: string) => Promise<void>;
  validateSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  selectSession: (session: InventorySession | null) => void;

  // Versioning (P0-5)
  createVersion: (sessionId: string, note?: string) => Promise<void>;
  getVersions: (sessionId: string) => Promise<InventoryVersion[]>;
  restoreVersion: (sessionId: string, versionId: string, note?: string) => Promise<void>;
  correctValidatedInventory: (sessionId: string, corrections: Record<string, number>) => Promise<void>;
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  sessions: [],
  selectedSession: null,
  versions: [],
  isLoading: false,
  error: null,

  loadSessions: async () => {
    set({ isLoading: true, error: null });
    try {
      const sessions = await window.api.inventory.getAll();
      set({ sessions: sessions || [], isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
    }
  },

  loadSessionById: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const session = await window.api.inventory.getById(id);
      set({ selectedSession: session, isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
    }
  },

  createSession: async (name: string, notes?: string) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.inventory.create({ name, notes });
      await get().loadSessions();
      set({ isLoading: false });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  startCounting: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await window.api.inventory.startCounting(id);
      await get().loadSessionById(id);
      set({ isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  calculateGaps: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await window.api.inventory.calculateGaps(id);
      await get().loadSessionById(id);
      set({ isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  updateSession: async (id: string, data: { name: string; notes?: string; status?: InventorySessionStatus }) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.inventory.update(id, data);
      if (result && result.success === false) {
        throw new Error(result.error || 'Modification impossible.');
      }
      await get().loadSessionById(id);
      await get().loadSessions();
      set({ isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  deleteSession: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.inventory.delete(id);
      if (result && result.success === false) {
        throw new Error(result.error || 'Suppression impossible.');
      }
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== id),
        selectedSession: state.selectedSession?.id === id ? null : state.selectedSession,
        isLoading: false,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  selectSession: (session: InventorySession | null) => {
    set({ selectedSession: session });
  },

  createVersion: async (sessionId: string, note?: string) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.inventory.createVersion(sessionId, note);
      if (result && result.success === false) throw new Error(result.error || 'Création de version impossible.');
      await get().getVersions(sessionId);
      set({ isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  getVersions: async (sessionId: string) => {
    set({ isLoading: true, error: null });
    try {
      const versions = await window.api.inventory.getVersions(sessionId);
      set({ versions: versions || [], isLoading: false });
      return versions || [];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  restoreVersion: async (sessionId: string, versionId: string, note?: string) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.inventory.restoreVersion(sessionId, versionId, note);
      if (result && result.success === false) throw new Error(result.error || 'Restauration impossible.');
      await get().loadSessionById(sessionId);
      await get().getVersions(sessionId);
      set({ isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  correctValidatedInventory: async (sessionId: string, corrections: Record<string, number>) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.inventory.correctValidatedInventory(sessionId, corrections);
      if (result && result.success === false) throw new Error(result.error || 'Correction impossible.');
      await get().loadSessionById(sessionId);
      set({ isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },
}));
