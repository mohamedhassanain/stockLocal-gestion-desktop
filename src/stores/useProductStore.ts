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
  updateProduct: (id: string, productData: ProductInput) => Promise<void>;
  archiveProduct: (id: string) => Promise<void>;
  activateProduct: (id: string) => Promise<void>;
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
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
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
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
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
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
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
    } catch (err: any) {
      set({ error: err.message });
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
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  }
}));
