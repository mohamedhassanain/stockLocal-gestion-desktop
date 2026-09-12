import { describe, it, expect, beforeEach } from 'vitest';
import { useHeldCartsStore, type HeldCartItem } from '../src/stores/useHeldCartsStore';

/**
 * §Phase 6 — Ventes en attente : mise en attente, reprise, non-perte du panier.
 * Le store vit hors de l'arbre React : il conserve donc son état lors de la
 * navigation entre pages (c'est précisément ce qui est vérifié ici).
 */

function item(productId: string, qty: number, price: number): HeldCartItem {
  return {
    product_id: productId,
    reference: `REF-${productId}`,
    designation: `Produit ${productId}`,
    quantity: qty,
    unit_price: price,
    discount: 0,
    current_stock: 100,
    vat_rate: 20,
    discountManual: false,
    base_unit: 'PIÈCE',
    sale_unit: 'PIÈCE',
    unit_factor: 1,
    alt_units: [],
  };
}

describe('§Phase 6 — Ventes en attente (POS)', () => {
  beforeEach(() => {
    useHeldCartsStore.getState().clear();
  });

  it('met un panier en attente avec un libellé lisible', () => {
    const id = useHeldCartsStore.getState().hold([item('a', 3, 10)], '', 'Client A', 36);
    const held = useHeldCartsStore.getState().held;
    expect(held).toHaveLength(1);
    expect(held[0].id).toBe(id);
    expect(held[0].clientName).toBe('Client A');
    expect(held[0].label).toBe('3 article(s) · 36.00 MAD');
    expect(held[0].items).toHaveLength(1);
  });

  it('« Client A » puis « Client B » : les deux paniers coexistent', () => {
    const store = useHeldCartsStore.getState();
    store.hold([item('a', 15, 10)], 'c1', 'Client A', 180);
    store.hold([item('b', 2, 50)], 'c2', 'Client B', 120);

    const held = useHeldCartsStore.getState().held;
    expect(held).toHaveLength(2);
    expect(held.map(h => h.clientName)).toEqual(['Client A', 'Client B']);
  });

  it('reprend un panier : il disparaît de la liste d\'attente', () => {
    const id = useHeldCartsStore.getState().hold([item('a', 1, 10)], 'c1', 'Client A', 12);
    expect(useHeldCartsStore.getState().held).toHaveLength(1);

    useHeldCartsStore.getState().release(id);
    expect(useHeldCartsStore.getState().held).toHaveLength(0);
  });

  it('reprendre un panier ne modifie pas les autres paniers en attente', () => {
    const store = useHeldCartsStore.getState();
    const idA = store.hold([item('a', 1, 10)], 'c1', 'Client A', 12);
    store.hold([item('b', 1, 20)], 'c2', 'Client B', 24);

    useHeldCartsStore.getState().release(idA);
    const remaining = useHeldCartsStore.getState().held;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].clientName).toBe('Client B');
  });

  it('les articles sont COPIÉS : modifier le panier d\'origine n\'affecte pas la vente en attente', () => {
    const original = [item('a', 1, 10)];
    useHeldCartsStore.getState().hold(original, '', 'Client A', 12);

    original[0].quantity = 99;

    const held = useHeldCartsStore.getState().held;
    expect(held[0].items[0].quantity).toBe(1);
  });

  it('un client vide est enregistré comme « Client comptoir »', () => {
    useHeldCartsStore.getState().hold([item('a', 1, 10)], '', '', 12);
    expect(useHeldCartsStore.getState().held[0].clientName).toBe('Client comptoir');
  });

  it('les identifiants sont uniques même créés dans la même milliseconde', () => {
    const store = useHeldCartsStore.getState();
    const ids = [
      store.hold([item('a', 1, 1)], '', 'A', 1.2),
      store.hold([item('b', 1, 1)], '', 'B', 1.2),
      store.hold([item('c', 1, 1)], '', 'C', 1.2),
    ];
    expect(new Set(ids).size).toBe(3);
  });

  it('clear() vide toutes les ventes en attente', () => {
    const store = useHeldCartsStore.getState();
    store.hold([item('a', 1, 1)], '', 'A', 1.2);
    store.hold([item('b', 1, 1)], '', 'B', 1.2);
    useHeldCartsStore.getState().clear();
    expect(useHeldCartsStore.getState().held).toHaveLength(0);
  });
});
