import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { PurchaseOrderRepository } from '../src/repositories/PurchaseOrderRepository';
import { ProductService } from '../src/services/ProductService';
import type { ProductInput } from '../src/repositories/ProductRepository';
import { SupplierRepository } from '../src/repositories/SupplierRepository';

/**
 * §Phase 16 — Commande d'achat + réception (partielle puis complète).
 *
 * Le point CRITIQUE vérifié ici : une réception répétée ne doit JAMAIS
 * dupliquer le stock, et une sur-réception doit être refusée.
 */

function clean(): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    DELETE FROM purchase_order_items;
    DELETE FROM purchase_orders;
    DELETE FROM stock_movements;
    DELETE FROM inventory_balances;
    DELETE FROM price_history;
    DELETE FROM products;
    DELETE FROM suppliers;
    DELETE FROM audit_logs;
    DELETE FROM document_sequences;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

/** Stock réellement enregistré dans la balance (source de vérité). */
function stockOf(productId: string): number {
  const row = db.prepare(
    'SELECT COALESCE(SUM(quantity), 0) AS qty FROM inventory_balances WHERE product_id = ?',
  ).get(productId) as { qty: number };
  return Number(row?.qty ?? 0);
}

let seq = 0;

function makeOrder(quantity: number) {
  seq += 1;
  const productInput: ProductInput = {
    reference: `RCV-${seq}`,
    designation: `Produit réception ${seq}`,
    purchase_price: 10,
    selling_price: 20,
    wholesale_price: 18,
    min_stock: 0,
    unit: 'PIÈCE',
    vat_rate: 0,
    status: 'ACTIVE',
  };
  const productId = ProductService.createProduct(productInput).id;
  const supplierId = SupplierRepository.create({ name: `Fournisseur ${seq}` }).id;

  const order = PurchaseOrderRepository.create({
    supplier_id: supplierId,
    items: [{ product_id: productId, quantity, unit_price: 10 }],
  });

  return { productId, supplierId, order };
}

describe('§Phase 16 — Réception de commande', () => {
  beforeEach(() => { clean(); });

  it('réception partielle puis complète : le stock n\'est jamais dupliqué', () => {
    const { productId, order, supplierId } = makeOrder(100);
    PurchaseOrderRepository.confirm(order.id);

    // 1re réception : 60
    const afterFirst = PurchaseOrderRepository.receive(order.id, [
      { item_id: order.items![0].id, received_qty: 60 },
    ]);
    expect(afterFirst.status).toBe('CONFIRMED'); // partielle
    expect(afterFirst.items![0].received_qty).toBe(60);
    expect(stockOf(productId)).toBe(60);

    // 2e réception : 40 → complète
    const afterSecond = PurchaseOrderRepository.receive(order.id, [
      { item_id: order.items![0].id, received_qty: 40 },
    ]);
    expect(afterSecond.status).toBe('RECEIVED');
    expect(afterSecond.items![0].received_qty).toBe(100);
    // 60 + 40 = 100 — surtout PAS 200
    expect(stockOf(productId)).toBe(100);

    expect(supplierId).toBeTruthy();
  });

  it('une réception répétée sur une commande déjà soldée est refusée (pas de double stock)', () => {
    const { productId, order } = makeOrder(50);
    PurchaseOrderRepository.confirm(order.id);
    PurchaseOrderRepository.receive(order.id, [{ item_id: order.items![0].id, received_qty: 50 }]);

    expect(stockOf(productId)).toBe(50);
    expect(() =>
      PurchaseOrderRepository.receive(order.id, [{ item_id: order.items![0].id, received_qty: 50 }]),
    ).toThrow(/confirmées/);
    // Le stock n'a pas bougé.
    expect(stockOf(productId)).toBe(50);
  });

  it('une sur-réception est refusée et ne modifie pas le stock', () => {
    const { productId, order } = makeOrder(100);
    PurchaseOrderRepository.confirm(order.id);

    expect(() =>
      PurchaseOrderRepository.receive(order.id, [{ item_id: order.items![0].id, received_qty: 150 }]),
    ).toThrow(/dépasse la quantité commandée/);
    expect(stockOf(productId)).toBe(0);
  });

  it('le cumul de deux réceptions dépassant la commande est refusé', () => {
    const { productId, order } = makeOrder(100);
    PurchaseOrderRepository.confirm(order.id);
    PurchaseOrderRepository.receive(order.id, [{ item_id: order.items![0].id, received_qty: 60 }]);
    expect(stockOf(productId)).toBe(60);

    expect(() =>
      PurchaseOrderRepository.receive(order.id, [{ item_id: order.items![0].id, received_qty: 50 }]),
    ).toThrow(/dépasse la quantité commandée/);
    // Seule la première réception a compté.
    expect(stockOf(productId)).toBe(60);
  });

  it('seule une commande CONFIRMÉE peut être réceptionnée', () => {
    const { order } = makeOrder(10);
    // Statut DRAFT : refusé.
    expect(() =>
      PurchaseOrderRepository.receive(order.id, [{ item_id: order.items![0].id, received_qty: 5 }]),
    ).toThrow(/confirmées/);
  });

  it('une réception enregistre un mouvement de stock PURCHASE_IN traçable', () => {
    const { order } = makeOrder(30);
    PurchaseOrderRepository.confirm(order.id);
    PurchaseOrderRepository.receive(order.id, [{ item_id: order.items![0].id, received_qty: 30 }]);

    const movements = db.prepare(
      `SELECT COUNT(*) AS c FROM stock_movements WHERE movement_type = 'PURCHASE_IN' AND document_id = ?`,
    ).get(order.id) as { c: number };
    expect(movements.c).toBe(1);
  });
});
