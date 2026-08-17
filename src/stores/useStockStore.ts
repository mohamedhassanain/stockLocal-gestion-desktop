import { create } from 'zustand';
import type { StockMovement } from '../repositories/StockMovementRepository';

interface StockState {
  movements: StockMovement[];
  stockHistory: StockMovement[];
  currentProductStock: number;
  isLoading: boolean;
  error: string | null;

  loadProductStock: (productId: string) => Promise<void>;
  addEntry: (data: Omit<StockMovement, 'id' | 'type'>) => Promise<void>;
  addExit: (data: Omit<StockMovement, 'id' | 'type'>) => Promise<void>;
  addInventory: (data: Omit<StockMovement, 'id' | 'type' | 'quantity'>, actualCount: number) => Promise<void>;
}

export const useStockStore = create<StockState>((set, get) => ({
  movements: [],
  stockHistory: [],
  currentProductStock: 0,
  isLoading: false,
  error: null,

  loadProductStock: async (productId: string) => {
    set({ isLoading: true, error: null });
    try {
      const history = await window.api.stock.getHistory(productId);
      const level = await window.api.stock.getLevel(productId);

      set({ movements: history, stockHistory: history, currentProductStock: level, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  addEntry: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.stock.addEntry(data);
      if (!result.success) throw new Error(result.error);

      await get().loadProductStock(data.product_id);
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  addExit: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.stock.addExit(data);
      if (!result.success) throw new Error(result.error);

      await get().loadProductStock(data.product_id);
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  addInventory: async (data, actualCount) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.stock.addInventory(data, actualCount);
      if (!result.success) throw new Error(result.error);

      await get().loadProductStock(data.product_id);
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  }
}));
