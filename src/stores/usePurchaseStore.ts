import { create } from 'zustand';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PurchaseStatus = 'DRAFT' | 'CONFIRMED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrderItem {
  id?: string;
  product_id: string;
  product_ref?: string;
  product_name?: string;
  quantity: number;
  unit_price: number;
  received_qty?: number;
  total?: number;
}

export interface PurchaseOrder {
  id: string;
  order_number: string;
  supplier_id: string;
  supplier_name?: string;
  date: string;
  status: PurchaseStatus;
  items?: PurchaseOrderItem[];
  total: number;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface PurchaseState {
  orders: PurchaseOrder[];
  selectedOrder: PurchaseOrder | null;
  searchQuery: string;
  isLoading: boolean;
  error: string | null;

  setSearchQuery: (q: string) => void;
  loadOrders: () => Promise<void>;
  selectOrder: (order: PurchaseOrder) => Promise<void>;
  createOrder: (data: any) => Promise<PurchaseOrder>;
  confirmOrder: (id: string) => Promise<void>;
  receiveOrder: (id: string, receivedItems?: Array<{ item_id: string; received_qty: number }>) => Promise<void>;
  cancelOrder: (id: string) => Promise<void>;
  deleteOrder: (id: string) => Promise<void>;
}

export const usePurchaseStore = create<PurchaseState>((set, get) => ({
  orders: [],
  selectedOrder: null,
  searchQuery: '',
  isLoading: false,
  error: null,

  setSearchQuery: (q) => {
    set({ searchQuery: q });
    get().loadOrders();
  },

  loadOrders: async () => {
    set({ isLoading: true, error: null });
    try {
      const { searchQuery } = get();
      const data = searchQuery.trim()
        ? await window.api.purchases.search(searchQuery)
        : await window.api.purchases.getAll();
      set({ orders: data, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  selectOrder: async (order) => {
    set({ isLoading: true, error: null });
    try {
      const full = await window.api.purchases.getById(order.id);
      set({ selectedOrder: full, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  createOrder: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.purchases.create(data);
      if (!result.success) throw new Error(result.error);
      await get().loadOrders();
      set({ isLoading: false });
      return result.data;
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  confirmOrder: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.purchases.confirm(id);
      if (!result.success) throw new Error(result.error);
      await get().loadOrders();
      // Refresh selected order if it's the one being confirmed
      if (get().selectedOrder?.id === id) {
        const full = await window.api.purchases.getById(id);
        set({ selectedOrder: full });
      }
      set({ isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  receiveOrder: async (id, receivedItems) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.purchases.receive(id, receivedItems);
      if (!result.success) throw new Error(result.error);
      await get().loadOrders();
      if (get().selectedOrder?.id === id) {
        const full = await window.api.purchases.getById(id);
        set({ selectedOrder: full });
      }
      set({ isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  cancelOrder: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.purchases.cancel(id);
      if (!result.success) throw new Error(result.error);
      await get().loadOrders();
      if (get().selectedOrder?.id === id) {
        const full = await window.api.purchases.getById(id);
        set({ selectedOrder: full });
      }
      set({ isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  deleteOrder: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.purchases.delete(id);
      if (!result.success) throw new Error(result.error);
      if (get().selectedOrder?.id === id) {
        set({ selectedOrder: null });
      }
      await get().loadOrders();
      set({ isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },
}));