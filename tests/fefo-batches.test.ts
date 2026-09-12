import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { ProductService } from '../src/services/ProductService';
import type { ProductInput } from '../src/repositories/ProductRepository';
import { StockService } from '../src/services/StockService';
import { StockLedgerService } from '../src/services/StockLedgerService';
import { ProductBatchRepository } from '../src/repositories/ProductBatchRepository';

/**
 * §Phase 13 — FEFO (« First Expired, First Out »).
 *
 * Règles vérifiées ici :
 *   - un produit SANS gestion de lots n'est JAMAIS contraint (skipped) ;
 *   - le lot dont l'expiration est la plus proche est consommé EN PREMIER ;
 *   - un lot SANS date d'expiration est consommé EN DERNIER ;
 *   - une quantité plus grande qu'un lot est répartie sur les lots suivants ;
 *   - lots insuffisants -> ERREUR, sans prélèvement partiel (atomicité) ;
 *   - une sortie de stock consomme les lots dans la MÊME transaction que le solde ;
 *   - le plan FEFO est en LECTURE SEULE.
 */

const LOT_A = '2026-01-15';
const LOT_B = '2026-06-15';
const LOT_C = '2026-12-15';

describe('§Phase 13 — FEFO', () => {
  beforeEach(() => {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
      DELETE FROM product_batches;
      DELETE FROM stock_movements;
      DELETE FROM inventory_balances;
      DELETE FROM products;
      DELETE FROM audit_logs;
    `);
    db.exec('PRAGMA foreign_keys = ON;');
  });

  let seq = 0;
  function makeProduct(batchManaged: boolean, initialStock: number): string {
    seq += 1;
    const input: ProductInput = {
      reference: `FEFO-${seq}`,
      designation: `Produit FEFO ${seq}`,
      purchase_price: 10,
      selling_price: 20,
      wholesale_price: 18,
      min_stock: 0,
      max_stock: 0,
      unit: 'PIÈCE',
      vat_rate: 0,
      status: 'ACTIVE',
      batch_managed: batchManaged ? 1 : 0,
    };
    const product = ProductService.createProduct(input);
    if (initialStock > 0) {
      StockService.addStockEntry({ product_id: product.id, quantity: initialStock, unit_price: 10 });
    }
    return product.id;
  }

  function addLot(productId: string, lotNumber: string, quantity: number, expiry: string | null): string {
    return ProductBatchRepository.create({
      product_id: productId,
      lot_number: lotNumber,
      quantity,
      expiry_date: expiry,
    }).id;
  }

  function lotQty(id: string): number {
    return Number(ProductBatchRepository.getById(id)?.quantity ?? 0);
  }

  it('produit SANS gestion par lots : aucune allocation FEFO, lots intacts', () => {
    const productId = makeProduct(false, 100);
    const lotId = addLot(productId, 'L-NON-GERE', 50, LOT_A);

    const result = ProductBatchRepository.consumeFefo(productId, 10);

    expect(result.skipped).toBe(true);
    expect(result.allocated).toBe(0);
    expect(result.allocations).toHaveLength(0);
    expect(lotQty(lotId)).toBe(50);
  });

  it('consomme d’abord le lot dont l’expiration est la plus proche', () => {
    const productId = makeProduct(true, 100);
    const lotC = addLot(productId, 'L-C', 30, LOT_C);
    const lotA = addLot(productId, 'L-A', 30, LOT_A);
    const lotB = addLot(productId, 'L-B', 30, LOT_B);

    const result = ProductBatchRepository.consumeFefo(productId, 10);

    expect(result.skipped).toBe(false);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].lot_number).toBe('L-A');
    expect(lotQty(lotA)).toBe(20);
    expect(lotQty(lotB)).toBe(30);
    expect(lotQty(lotC)).toBe(30);
  });

  it('les lots SANS date d’expiration sont consommés EN DERNIER', () => {
    const productId = makeProduct(true, 100);
    const noExpiry = addLot(productId, 'L-SANS-DATE', 30, null);
    const dated = addLot(productId, 'L-DATE', 30, LOT_B);

    const result = ProductBatchRepository.consumeFefo(productId, 10);

    expect(result.allocations[0].lot_number).toBe('L-DATE');
    expect(lotQty(dated)).toBe(20);
    expect(lotQty(noExpiry)).toBe(30);
  });

  it('répartit une quantité sur PLUSIEURS lots dans l’ordre FEFO', () => {
    const productId = makeProduct(true, 100);
    const lotA = addLot(productId, 'L-A', 5, LOT_A);
    const lotB = addLot(productId, 'L-B', 8, LOT_B);
    const lotC = addLot(productId, 'L-C', 20, LOT_C);

    const result = ProductBatchRepository.consumeFefo(productId, 12);

    expect(result.allocated).toBe(12);
    expect(result.allocations.map(a => a.lot_number)).toEqual(['L-A', 'L-B']);
    expect(result.allocations[0].taken).toBe(5);
    expect(result.allocations[1].taken).toBe(7);

    expect(lotQty(lotA)).toBe(0);
    expect(lotQty(lotB)).toBe(1);
    expect(lotQty(lotC)).toBe(20);
  });

  it('lots insuffisants → ERREUR et AUCUN prélèvement partiel', () => {
    const productId = makeProduct(true, 100);
    const lotA = addLot(productId, 'L-A', 7, LOT_A);

    expect(() => ProductBatchRepository.consumeFefo(productId, 10)).toThrow(/Lots insuffisants/i);
    expect(lotQty(lotA)).toBe(7);
  });

  it('une SORTIE de stock consomme les lots FEFO et décrémente le solde', () => {
    const productId = makeProduct(true, 50);
    const lotB = addLot(productId, 'L-B', 10, LOT_B);
    const lotA = addLot(productId, 'L-A', 10, LOT_A);

    const movement = StockLedgerService.recordMovement({
      product_id: productId,
      movement_type: 'SALE_OUT',
      quantity: 6,
    });

    expect(movement.batch_allocations).toBeDefined();
    expect(movement.batch_allocations?.[0].lot_number).toBe('L-A');
    expect(lotQty(lotA)).toBe(4);
    expect(lotQty(lotB)).toBe(10);
    expect(StockLedgerService.getStockLevel(productId)).toBe(44);
  });

  it('sans lots suivis, une sortie n’est jamais bloquée (les lots sont optionnels)', () => {
    const productId = makeProduct(true, 20);

    const movement = StockLedgerService.recordMovement({
      product_id: productId,
      movement_type: 'SALE_OUT',
      quantity: 5,
    });

    expect(movement.batch_allocations).toBeUndefined();
    expect(StockLedgerService.getStockLevel(productId)).toBe(15);
  });

  it('stock insuffisant → aucune consommation de lot (atomicité mouvement + lots)', () => {
    const productId = makeProduct(true, 3);
    const lotA = addLot(productId, 'L-A', 50, LOT_A);

    expect(() =>
      StockLedgerService.recordMovement({ product_id: productId, movement_type: 'SALE_OUT', quantity: 10 }),
    ).toThrow(/Stock insuffisant/i);

    expect(lotQty(lotA)).toBe(50);
    expect(StockLedgerService.getStockLevel(productId)).toBe(3);
  });

  it('SALE_OUT en lots insuffisants → sortie refusée, solde ET lots intacts', () => {
    const productId = makeProduct(true, 100);
    const lotA = addLot(productId, 'L-A', 4, LOT_A);

    expect(() =>
      StockLedgerService.recordMovement({ product_id: productId, movement_type: 'SALE_OUT', quantity: 10 }),
    ).toThrow(/Lots insuffisants/i);

    expect(lotQty(lotA)).toBe(4);
    expect(StockLedgerService.getStockLevel(productId)).toBe(100);
  });

  it('getFefoPlan est en LECTURE SEULE et signale l’insuffisance', () => {
    const productId = makeProduct(true, 100);
    const lotA = addLot(productId, 'L-A', 5, LOT_A);
    const lotB = addLot(productId, 'L-B', 5, LOT_B);

    const plan = ProductBatchRepository.getFefoPlan(productId, 8);
    expect(plan.sufficient).toBe(true);
    expect(plan.available).toBe(10);
    expect(plan.allocations.map(a => a.lot_number)).toEqual(['L-A', 'L-B']);
    expect(plan.allocations[0].taken).toBe(5);

    expect(lotQty(lotA)).toBe(5);
    expect(lotQty(lotB)).toBe(5);

    const tooMuch = ProductBatchRepository.getFefoPlan(productId, 99);
    expect(tooMuch.sufficient).toBe(false);
    expect(lotQty(lotA)).toBe(5);
  });

  it('listFefo ne retourne que les lots encore disponibles, dans l’ordre FEFO', () => {
    const productId = makeProduct(true, 100);
    addLot(productId, 'L-VIDE', 0, LOT_A);
    addLot(productId, 'L-C', 3, LOT_C);
    addLot(productId, 'L-B', 3, LOT_B);

    const lots = ProductBatchRepository.listFefo(productId);
    expect(lots.map(l => l.lot_number)).toEqual(['L-B', 'L-C']);
  });
});
