import { create } from 'zustand';

/**
 * Multi-dépôts — état du « dépôt actif ».
 *
 * Le dépôt actif est persisté côté main (global_settings.active_warehouse_id) :
 * toutes les écritures de stock qui ne précisent pas de dépôt s'y appliquent.
 * Pour un utilisateur mono-dépôt, ce store reste transparent (un seul dépôt).
 */

export interface Warehouse {
  id: string;
  name: string;
  address: string | null;
  is_default: number;
}

interface WarehouseState {
  warehouses: Warehouse[];
  activeId: string | null;
  activeName: string;
  isLoading: boolean;
  loadWarehouses: () => Promise<void>;
  setActive: (id: string) => Promise<void>;
}

export const useWarehouseStore = create<WarehouseState>((set, get) => ({
  warehouses: [],
  activeId: null,
  activeName: 'Dépôt principal',
  isLoading: false,

  loadWarehouses: async () => {
    set({ isLoading: true });
    try {
      const [list, active] = await Promise.all([
        window.api.warehouses.getAll(),
        window.api.warehouses.getActive(),
      ]);
      const warehouses = (list ?? []) as Warehouse[];
      const activeId = active?.id ?? warehouses.find(w => w.is_default === 1)?.id ?? null;
      const activeName = active?.name ?? warehouses.find(w => w.id === activeId)?.name ?? 'Dépôt principal';
      set({ warehouses, activeId, activeName, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  setActive: async (id: string) => {
    const result = await window.api.warehouses.setActive(id);
    if (result && result.success === false) {
      throw new Error(result.error || 'Impossible de changer de dépôt actif.');
    }
    const found = get().warehouses.find(w => w.id === id);
    set({ activeId: id, activeName: result?.data?.name ?? found?.name ?? 'Dépôt' });
  },
}));
