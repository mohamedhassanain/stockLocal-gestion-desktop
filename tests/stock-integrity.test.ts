import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { StockLedgerService } from '../src/services/StockLedgerService';
import { ProductService } from '../src/services/ProductService';
import type { ProductInput } from '../src/repositories/ProductRepository';

/**
 * §Phase 3.1 — Intégrité du stock : audit (lecture seule) + réparation contrôlée.
 *
 * Invariant vérifié : inventaire_balances == agrégat des stock_movements.
 */

function createProduct(ref: string): string {
  const input: ProductInput = {
    reference: ref,
    designation: `Produit ${ref}`,
    purchase_price: 10,
    selling_price: 20,
    wholesale_price: 12,
    min_stock: 0,
    unit: 'PIÈCE',
    status: 'ACTIVE',
  };
  return ProductService.createProduct(input).id;
}

function warehouseIdOf(productId: string): string {
  const row = db.prepare('SELECT warehouse_id FROM inventory_balances WHERE product_id = ? LIMIT 1')
    .get(productId) as { warehouse_id: string } | undefined;
  if (!row) throw new Error('Aucun solde pour ce produit');
  return row.warehouse_id;
}

/** Corrompt volontairement un solde stocké (pour tester la détection). */
function corruptBalance(productId: string, delta: number): void {
  db.prepare('UPDATE inventory_balances SET quantity = quantity + ? WHERE product_id = ?').run(delta, productId);
}

describe('§Phase 3.1 — Audit de cohérence du stock', () => {
  beforeEach(() => {
    db.exec('DELETE FROM inventory_balances; DELETE FROM stock_movements; DELETE FROM products;');
  });

  it('un stock cohérent ne produit AUCUN écart', () => {
    const productId = createProduct('INTEG-CLEAN');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'SALE_OUT', quantity: 30, unit_price: 20 });

    const audit = StockLedgerService.auditBalances();
    expect(audit.discrepancyCount).toBe(0);
    expect(audit.checked).toBeGreaterThan(0);
  });

  it('un solde corrompu est DÉTECTÉ avec l\'écart exact (audit = lecture seule)', () => {
    const productId = createProduct('INTEG-CORRUPT');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 40, unit_price: 8 });
    corruptBalance(productId, 7); // solde stocké = 47, attendu = 40

    const before = db.prepare('SELECT quantity FROM inventory_balances WHERE product_id = ?').get(productId) as { quantity: number };
    const audit = StockLedgerService.auditBalances();
    const after = db.prepare('SELECT quantity FROM inventory_balances WHERE product_id = ?').get(productId) as { quantity: number };

    // L'audit ne modifie RIEN.
    expect(after.quantity).toBe(before.quantity);

    expect(audit.discrepancyCount).toBe(1);
    const d = audit.discrepancies[0];
    expect(d.product_id).toBe(productId);
    expect(d.stored_qty).toBe(47);
    expect(d.expected_qty).toBe(40);
    expect(d.difference).toBe(7);
  });

  it('la réparation recale le solde sur les mouvements et l\'audit redevient vide', () => {
    const productId = createProduct('INTEG-REPAIR');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 25, unit_price: 12 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'SALE_OUT', quantity: 5, unit_price: 20 });
    corruptBalance(productId, -50); // solde stocké = -30 (absurde), attendu = 20

    const audit = StockLedgerService.auditBalances();
    expect(audit.discrepancyCount).toBe(1);

    const result = StockLedgerService.repairBalances(
      audit.discrepancies.map(d => ({ product_id: d.product_id, warehouse_id: d.warehouse_id })),
    );
    expect(result.repaired).toBe(1);
    expect(result.details[0].before_qty).toBe(-30);
    expect(result.details[0].after_qty).toBe(20);
    expect(StockLedgerService.getStockLevel(productId)).toBe(20);

    // Après réparation, plus aucun écart.
    const reAudit = StockLedgerService.auditBalances();
    expect(reAudit.discrepancyCount).toBe(0);
  });

  it('la réparation recalcule aussi le CMUP (total_in_qty / total_in_value)', () => {
    const productId = createProduct('INTEG-CMUP');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 20 });
    const wid = warehouseIdOf(productId);

    // Corruption : CMUP faux
    db.prepare('UPDATE inventory_balances SET total_in_value = 1, average_cost = 999 WHERE product_id = ?').run(productId);

    StockLedgerService.repairBalances([{ product_id: productId, warehouse_id: wid }]);

    const row = db.prepare('SELECT quantity, total_in_qty, total_in_value, average_cost FROM inventory_balances WHERE product_id = ?')
      .get(productId) as { quantity: number; total_in_qty: number; total_in_value: number; average_cost: number };
    expect(row.quantity).toBe(200);
    expect(row.total_in_qty).toBe(200);
    expect(row.total_in_value).toBe(3000);
    expect(row.average_cost).toBeCloseTo(15, 10);
  });

  it('réparation sans sélection → aucune modification', () => {
    const productId = createProduct('INTEG-NOOP');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 10 });
    const result = StockLedgerService.repairBalances([]);
    expect(result.repaired).toBe(0);
    expect(StockLedgerService.getStockLevel(productId)).toBe(10);
  });

  it('une réparation ciblée ne touche pas les autres produits', () => {
    const productA = createProduct('INTEG-A');
    const productB = createProduct('INTEG-B');
    StockLedgerService.recordMovement({ product_id: productA, movement_type: 'PURCHASE_IN', quantity: 10 });
    StockLedgerService.recordMovement({ product_id: productB, movement_type: 'PURCHASE_IN', quantity: 20 });
    corruptBalance(productB, 5); // B corrompu uniquement

    const audit = StockLedgerService.auditBalances();
    expect(audit.discrepancyCount).toBe(1);

    StockLedgerService.repairBalances([{ product_id: productB, warehouse_id: warehouseIdOf(productB) }]);

    expect(StockLedgerService.getStockLevel(productA)).toBe(10);
    expect(StockLedgerService.getStockLevel(productB)).toBe(20);
  });
});
