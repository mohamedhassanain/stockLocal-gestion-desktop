import { create } from 'zustand';

/**
 * §Phase 6 — Ventes en attente (POS).
 *
 * Store en MÉMOIRE (hors arbre React) : les paniers mis en attente survivent
 * à la navigation entre pages tant que l'application tourne. Volontairement
 * NON persistés en base : un panier en attente n'est pas un document commercial
 * et ne doit pas créer de données fantômes (cf. §Rule B — SQLite = source de vérité).
 */

export interface HeldCartItem {
  product_id: string;
  reference: string;
  designation: string;
  quantity: number;
  unit_price: number;
  discount: number;
  current_stock: number;
  vat_rate: number;
  discountManual: boolean;
  base_unit: string;
  sale_unit: string;
  unit_factor: number;
  alt_units: { unit: string; factor: number }[];
}

export interface HeldCart {
  id: string;
  label: string;
  clientId: string;
  clientName: string;
  items: HeldCartItem[];
  total: number;
  heldAt: string;
}

interface HeldCartsState {
  held: HeldCart[];
  /** Met un panier en attente. Retourne l'identifiant créé. */
  hold: (cart: HeldCartItem[], clientId: string, clientName: string, total: number) => string;
  /** Retire un panier de la liste (après reprise ou suppression). */
  release: (id: string) => void;
  clear: () => void;
}

let counter = 0;

function nextHeldId(): string {
  counter += 1;
  return `hold-${Date.now()}-${counter}`;
}

export const useHeldCartsStore = create<HeldCartsState>((set) => ({
  held: [],

  hold: (cart, clientId, clientName, total) => {
    const id = nextHeldId();
    const count = cart.reduce((s, c) => s + c.quantity, 0);
    const label = `${count} article(s) · ${total.toFixed(2)} MAD`;
    set((state) => ({
      held: [
        ...state.held,
        {
          id,
          label,
          clientId,
          clientName: clientName || 'Client comptoir',
          items: cart.map((c) => ({ ...c })),
          total,
          heldAt: new Date().toISOString(),
        },
      ],
    }));
    return id;
  },

  release: (id) => set((state) => ({ held: state.held.filter((h) => h.id !== id) })),

  clear: () => set({ held: [] }),
}));
