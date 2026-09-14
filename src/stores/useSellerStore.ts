import { create } from 'zustand';

/**
 * §B4 — Store Zustand des vendeurs / commerciaux.
 *
 * Les vendeurs sont des FICHES (nom, téléphone, taux de commission, actif),
 * PAS des comptes utilisateurs. Ce store ne fait qu'appeler l'API IPC exposée
 * par le preload ; toute la logique (validation, commission) reste côté main.
 */

export interface Seller {
  id: string;
  name: string;
  phone?: string | null;
  commission_rate: number;
  active: number;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface SellerState {
  sellers: Seller[];
  loading: boolean;
  loadSellers: () => Promise<void>;
  createSeller: (data: { name: string; phone?: string | null; commission_rate: number; notes?: string | null }) => Promise<Seller>;
  updateSeller: (id: string, data: Partial<{ name: string; phone?: string | null; commission_rate: number; notes?: string | null }>) => Promise<void>;
  setSellerActive: (id: string, active: boolean) => Promise<void>;
  deleteSeller: (id: string) => Promise<void>;
}

export const useSellerStore = create<SellerState>((set, get) => ({
  sellers: [],
  loading: false,

  async loadSellers() {
    set({ loading: true });
    try {
      const rows = await window.api.sellers.getAll();
      set({ sellers: (rows ?? []) as Seller[], loading: false });
    } catch {
      set({ sellers: [], loading: false });
    }
  },

  async createSeller(data) {
    const res = await window.api.sellers.create({
      name: data.name,
      phone: data.phone ?? null,
      commission_rate: data.commission_rate,
      notes: data.notes ?? null,
    });
    if (!res?.success) throw new Error(res?.error ?? 'Création du vendeur impossible.');
    await get().loadSellers();
    return res.data as Seller;
  },

  async updateSeller(id, data) {
    const res = await window.api.sellers.update(id, data);
    if (!res?.success) throw new Error(res?.error ?? 'Modification du vendeur impossible.');
    await get().loadSellers();
  },

  async setSellerActive(id, active) {
    const res = await window.api.sellers.setActive(id, active);
    if (!res?.success) throw new Error(res?.error ?? 'Changement d\'état impossible.');
    await get().loadSellers();
  },

  async deleteSeller(id) {
    const res = await window.api.sellers.delete(id);
    if (!res?.success) throw new Error(res?.error ?? 'Suppression du vendeur impossible.');
    await get().loadSellers();
  },
}));
