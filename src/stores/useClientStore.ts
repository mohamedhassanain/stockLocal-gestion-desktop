import { create } from 'zustand';
import type { Customer, ClientCredit } from '../repositories/ClientRepository';
import { toast } from './useToastStore';

interface ClientState {
  clients: Customer[];
  selectedClient: Customer | null;
  clientHistory: ClientCredit[];
  searchQuery: string;
  isLoading: boolean;
  error: string | null;

  setSearchQuery: (q: string) => void;
  loadClients: () => Promise<void>;
  selectClient: (client: Customer) => Promise<void>;
  createClient: (data: Omit<Customer, 'id' | 'created_at' | 'updated_at' | 'balance'>) => Promise<void>;
  updateClient: (id: string, data: Partial<Omit<Customer, 'id' | 'created_at' | 'updated_at' | 'balance'>>) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  addDebt: (customerId: string, amount: number, description: string) => Promise<void>;
  addPayment: (customerId: string, amount: number, description: string) => Promise<void>;
  exportStatement: (customerId: string) => Promise<void>;
}

export const useClientStore = create<ClientState>((set, get) => ({
  clients: [],
  selectedClient: null,
  clientHistory: [],
  searchQuery: '',
  isLoading: false,
  error: null,

  setSearchQuery: (q) => {
    set({ searchQuery: q });
    get().loadClients();
  },

  loadClients: async () => {
    set({ isLoading: true, error: null });
    try {
      const query = get().searchQuery;
      const data = await window.api.clients.search(query);
      set({ clients: data, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  selectClient: async (client) => {
    set({ selectedClient: client, isLoading: true });
    try {
      const history = await window.api.clients.getHistory(client.id);
      set({ clientHistory: history, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  createClient: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.clients.create(data);
      if (!result.success) throw new Error(result.error);
      await get().loadClients();
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  updateClient: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.clients.update(id, data);
      if (!result.success) throw new Error(result.error);
      await get().loadClients();
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  deleteClient: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.clients.delete(id);
      if (!result.success) throw new Error(result.error);
      if (get().selectedClient?.id === id) {
        set({ selectedClient: null, clientHistory: [] });
      }
      await get().loadClients();
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  addDebt: async (customerId, amount, description) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.clients.addDebt(customerId, amount, description);
      if (!result.success) throw new Error(result.error);
      await get().loadClients();
      // Rafraîchir l'historique si le client est sélectionné
      const selected = get().selectedClient;
      if (selected?.id === customerId) {
        const history = await window.api.clients.getHistory(customerId);
        set({ clientHistory: history });
      }
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  addPayment: async (customerId, amount, description) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.clients.addPayment(customerId, amount, description);
      if (!result.success) throw new Error(result.error);
      await get().loadClients();
      const selected = get().selectedClient;
      if (selected?.id === customerId) {
        const history = await window.api.clients.getHistory(customerId);
        set({ clientHistory: history });
      }
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  exportStatement: async (customerId: string) => {
    try {
      const result = await window.api.clients.exportStatement(customerId);
      if (!result.success) throw new Error(result.error);
    } catch (err: any) {
      // Phase 7 : toast plutôt qu'alert() natif.
      toast.error(`Erreur lors de l'export : ${err.message}`);
    }
  }
}));
