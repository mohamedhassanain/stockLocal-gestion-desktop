import { create } from 'zustand';
import type { Product } from '../repositories/ProductRepository';

interface ProductState {
  products: Product[];
  isLoading: boolean;
  searchQuery: string;
  error: string | null;
  
  setSearchQuery: (query: string) => void;
  loadProducts: () => Promise<void>;
  addProduct: (productData: Omit<Product, 'id'>) => Promise<void>;
  archiveProduct: (id: string) => Promise<void>;
}

export const useProductStore = create<ProductState>((set, get) => ({
  products: [],
  isLoading: false,
  searchQuery: '',
  error: null,

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
    // Appel direct via IPC pour faire la recherche SQLite ultra-rapide
    get().loadProducts();
  },

  loadProducts: async () => {
    set({ isLoading: true, error: null });
    try {
      const query = get().searchQuery;
      // Appel réel vers SQLite via le processus Main d'Electron
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

  archiveProduct: async (id) => {
    // Non implémenté dans le Main pour la démo, mais c'est le même principe
    console.log("Archive:", id);
  }
}));
