import { create } from 'zustand';
import type { Supplier, SupplierCredit } from '../repositories/SupplierRepository';

interface SupplierState {
  suppliers: Supplier[];
  selectedSupplier: Supplier | null;
  supplierHistory: SupplierCredit[];
  searchQuery: string;
  isLoading: boolean;
  error: string | null;

  setSearchQuery: (q: string) => void;
  loadSuppliers: () => Promise<void>;
  selectSupplier: (supplier: Supplier) => Promise<void>;
  createSupplier: (data: Omit<Supplier, 'id' | 'created_at' | 'updated_at' | 'balance'>) => Promise<void>;
  updateSupplier: (id: string, data: Partial<Omit<Supplier, 'id' | 'created_at' | 'updated_at' | 'balance'>>) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
  addDebt: (supplierId: string, amount: number, description: string) => Promise<void>;
  addPayment: (supplierId: string, amount: number, description: string) => Promise<void>;
}

const DEFAULT_USER_ID = 'user_1'; // Remplacé par auth plus tard

export const useSupplierStore = create<SupplierState>((set, get) => ({
  suppliers: [],
  selectedSupplier: null,
  supplierHistory: [],
  searchQuery: '',
  isLoading: false,
  error: null,

  setSearchQuery: (q) => {
    set({ searchQuery: q });
    get().loadSuppliers();
  },

  loadSuppliers: async () => {
    set({ isLoading: true, error: null });
    try {
      const query = get().searchQuery;
      const data = await window.api.suppliers.search(query);
      set({ suppliers: data, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  selectSupplier: async (supplier) => {
    set({ selectedSupplier: supplier, isLoading: true });
    try {
      const history = await window.api.suppliers.getHistory(supplier.id);
      set({ supplierHistory: history, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  createSupplier: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.suppliers.create(data);
      if (!result.success) throw new Error(result.error);
      await get().loadSuppliers();
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  updateSupplier: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.suppliers.update(id, data);
      if (!result.success) throw new Error(result.error);
      await get().loadSuppliers();
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  deleteSupplier: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.suppliers.delete(id);
      if (!result.success) throw new Error(result.error);
      if (get().selectedSupplier?.id === id) {
        set({ selectedSupplier: null, supplierHistory: [] });
      }
      await get().loadSuppliers();
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  addDebt: async (supplierId, amount, description) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.suppliers.addDebt(supplierId, amount, description, DEFAULT_USER_ID);
      if (!result.success) throw new Error(result.error);
      await get().loadSuppliers();
      const selected = get().selectedSupplier;
      if (selected?.id === supplierId) {
        const history = await window.api.suppliers.getHistory(supplierId);
        set({ supplierHistory: history });
      }
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  addPayment: async (supplierId, amount, description) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.suppliers.addPayment(supplierId, amount, description, DEFAULT_USER_ID);
      if (!result.success) throw new Error(result.error);
      await get().loadSuppliers();
      const selected = get().selectedSupplier;
      if (selected?.id === supplierId) {
        const history = await window.api.suppliers.getHistory(supplierId);
        set({ supplierHistory: history });
      }
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  }
}));
