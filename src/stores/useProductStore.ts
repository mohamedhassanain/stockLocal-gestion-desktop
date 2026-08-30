import { create } from 'zustand';
import type { Product, ProductInput } from '../repositories/ProductRepository';

interface ProductState {
  products: Product[];
  isLoading: boolean;
  searchQuery: string;
  error: string | null;

  setSearchQuery: (query: string) => void;
  loadProducts: () => Promise<void>;
  addProduct: (productData: ProductInput) => Promise<void>;
  addProductWithStock: (productData: ProductInput, initialStock: number) => Promise<void>;
  updateProduct: (id: string, productData: ProductInput) => Promise<void>;
  updateProductWithStock: (id: string, productData: ProductInput, stockAdjustment: number) => Promise<void>;
  archiveProduct: (id: string) => Promise<void>;
  activateProduct: (id: string) => Promise<void>;
  disableProduct: (id: string) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
}

export const useProductStore = create<ProductState>((set, get) => ({
  products: [],
  isLoading: false,
  searchQuery: '',
  error: null,

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
    // Recherche directe via IPC SQLite (ultra-rapide)
    get().loadProducts();
  },

  loadProducts: async () => {
    set({ isLoading: true, error: null });
    try {
      const query = get().searchQuery;
      const data: Product[] = await window.api.products.search(query);
      set({ products: data, isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
    }
  },

  addProduct: async (productData) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.products.create(productData);
      if (!result.success) {
        throw new Error(result.error);
      }
      await get().loadProducts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  addProductWithStock: async (productData, initialStock) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.products.createWithStock(productData, initialStock);
      if (!result.success) {
        throw new Error(result.error);
      }
      await get().loadProducts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  updateProduct: async (id, productData) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.products.update(id, productData);
      if (!result.success) {
        throw new Error(result.error);
      }
      await get().loadProducts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  updateProductWithStock: async (id, productData, stockAdjustment) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.products.updateWithStock(id, productData, stockAdjustment);
      if (!result.success) {
        throw new Error(result.error);
      }
      await get().loadProducts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  archiveProduct: async (id) => {
    set({ error: null });
    try {
      const result = await window.api.products.archive(id);
      if (!result.success) {
        throw new Error(result.error);
      }
      await get().loadProducts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
      throw err;
    }
  },

  activateProduct: async (id) => {
    set({ error: null });
    try {
      const result = await window.api.products.activate(id);
      if (!result.success) {
        throw new Error(result.error);
      }
      await get().loadProducts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
      throw err;
    }
  },

  disableProduct: async (id) => {
    set({ error: null });
    try {
      const result = await window.api.products.disable(id);
      if (!result.success) {
        throw new Error(result.error);
      }
      await get().loadProducts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
      throw err;
    }
  },

  deleteProduct: async (id) => {
    set({ error: null });
    try {
      const result = await window.api.products.delete(id);
      if (!result.success) {
        throw new Error(result.error);
      }
      await get().loadProducts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
      throw err;
    }
  }
}));
