import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/database/config/connection';
import { StockLedgerService } from '../src/services/StockLedgerService';
import { StockService } from '../src/services/StockService';
import { ProductService } from '../src/services/ProductService';
import { ProductRepository, type ProductInput } from '../src/repositories/ProductRepository';

function createProduct(ref: string, sellingPrice = 20, purchasePrice = 10): string {
  const input: ProductInput = {
    reference: ref,
    designation: `Produit ${ref}`,
    purchase_price: purchasePrice,
    selling_price: sellingPrice,
    wholesale_price: purchasePrice + 1,
    min_stock: 5,
    unit: 'PIÈCE',
    status: 'ACTIVE',
  };
  return ProductService.createProduct(input).id;
}

function stockOf(productId: string): number {
  return StockLedgerService.getStockLevel(productId);
}

function movementsOf(productId: string) {
  return StockLedgerService.getHistory(productId, 200, 0);
}

describe('Moteur de stock — StockLedgerService (§3, §5)', () => {
  beforeEach(() => {
    // Nettoyer les données entre chaque test (base de test isolée).
    // FK RESTRICT : on supprime les balances, puis les mouvements, puis les produits.
    db.exec('DELETE FROM inventory_balances; DELETE FROM stock_movements; DELETE FROM products;');
  });

  it('enregistre un PURCHASE_IN (entrée) et met à jour le stock', () => {
    const productId = createProduct('PURCHASE-1');
    const movement = StockLedgerService.recordMovement({
      product_id: productId,
      movement_type: 'PURCHASE_IN',
      quantity: 25,
      unit_price: 10,
    });
    expect(movement.movement_type).toBe('PURCHASE_IN');
    expect(movement.type).toBe('IN');
    expect(stockOf(productId)).toBe(25);
  });

  it('enregistre un SALE_OUT (sortie) qui décrémente le stock', () => {
    const productId = createProduct('SALE-1');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100 });
    const sale = StockLedgerService.recordMovement({
      product_id: productId,
      movement_type: 'SALE_OUT',
      quantity: 37.5, // quantité décimale (§5)
      unit_price: 20,
    });
    expect(sale.movement_type).toBe('SALE_OUT');
    expect(sale.type).toBe('OUT');
    expect(stockOf(productId)).toBe(62.5);
  });

  it('gère les quantités décimales (0.5, 1.25, 10.75)', () => {
    const productId = createProduct('DECIMAL-1');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 0.5 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'RETURN_IN', quantity: 1.25 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 10.75 });
    expect(stockOf(productId)).toBeCloseTo(12.5, 5);
  });

  it('refuse une quantité <= 0', () => {
    const productId = createProduct('QTY-ZERO');
    expect(() => StockLedgerService.recordMovement({
      product_id: productId,
      movement_type: 'PURCHASE_IN',
      quantity: 0,
    })).toThrow(/Quantité invalide/);
    expect(() => StockLedgerService.recordMovement({
      product_id: productId,
      movement_type: 'PURCHASE_IN',
      quantity: -5,
    })).toThrow(/Quantité invalide/);
  });

  it('refuse un mouvement pour un produit inexistant', () => {
    expect(() => StockLedgerService.recordMovement({
      product_id: randomUUID(),
      movement_type: 'PURCHASE_IN',
      quantity: 10,
    })).toThrow(/Produit introuvable/);
  });

  it('refuse une sortie si le stock est insuffisant', () => {
    const productId = createProduct('INSUF-1');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 10 });
    expect(() => StockLedgerService.recordMovement({
      product_id: productId,
      movement_type: 'SALE_OUT',
      quantity: 10.5,
    })).toThrow(/Stock insuffisant/);
    expect(stockOf(productId)).toBe(10); // inchangé, transaction atomique
  });

  it('enregistre RETURN_IN, RETURN_OUT, DAMAGE_OUT et LOSS_OUT avec les bons types', () => {
    const productId = createProduct('TYPES-1');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100 });

    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'RETURN_IN', quantity: 5 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'RETURN_OUT', quantity: 3, supplier_id: 's1' });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'DAMAGE_OUT', quantity: 2 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'LOSS_OUT', quantity: 1 });

    const types = movementsOf(productId).map(m => m.movement_type);
    expect(types).toContain('RETURN_IN');
    expect(types).toContain('RETURN_OUT');
    expect(types).toContain('DAMAGE_OUT');
    expect(types).toContain('LOSS_OUT');
    // 100 + 5 - 3 - 2 - 1 = 99
    expect(stockOf(productId)).toBe(99);
  });

  it('relie le mouvement à son document source (document_id)', () => {
    const productId = createProduct('DOCLINK-1');
    const docId = randomUUID();
    const entry = StockLedgerService.recordMovement({
      product_id: productId,
      movement_type: 'PURCHASE_IN',
      quantity: 4,
      document_id: docId,
    });
    const sale = StockLedgerService.recordMovement({
      product_id: productId,
      movement_type: 'SALE_OUT',
      quantity: 4,
      document_id: docId,
    });
    expect(entry.document_id).toBe(docId);
    expect(sale.document_id).toBe(docId);
  });

  it('StockService.addStockEntry → PURCHASE_IN par défaut', () => {
    const productId = createProduct('FACADE-1');
    StockService.addStockEntry({ product_id: productId, quantity: 7, unit_price: 5 });
    const latest = movementsOf(productId)[0];
    expect(latest.movement_type).toBe('PURCHASE_IN');
    expect(stockOf(productId)).toBe(7);
  });

  it('StockService.addStockExit → SALE_OUT/DAMAGE_OUT selon exitType', () => {
    const productId = createProduct('FACADE-2');
    StockService.addStockEntry({ product_id: productId, quantity: 20, unit_price: 5 });
    StockService.addStockExit({ product_id: productId, quantity: 6, unit_price: 10, exitType: 'VENTE' });
    StockService.addStockExit({ product_id: productId, quantity: 2, unit_price: 0, exitType: 'CASSE' });

    const types = movementsOf(productId).map(m => m.movement_type);
    expect(types).toContain('SALE_OUT');
    expect(types).toContain('DAMAGE_OUT');
    expect(stockOf(productId)).toBe(12);
  });
});

describe('Inventaire — ajustements directionnels (§4)', () => {
  beforeEach(() => {
    db.exec('DELETE FROM inventory_balances; DELETE FROM stock_movements; DELETE FROM products;');
  });

  it('surplus : théorique 100, compté 110 → ADJUSTMENT_IN 10 → stock 110', () => {
    const productId = createProduct('INV-SURPLUS');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100 });
    const movement = StockLedgerService.adjustInventory({ product_id: productId, actualCount: 110 });
    expect(movement).not.toBeNull();
    expect(movement!.movement_type).toBe('ADJUSTMENT_IN');
    expect(movement!.quantity).toBe(10);
    expect(stockOf(productId)).toBe(110);
  });

  it('manque : théorique 100, compté 90 → ADJUSTMENT_OUT 10 → stock 90', () => {
    const productId = createProduct('INV-MANQUE');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100 });
    const movement = StockLedgerService.adjustInventory({ product_id: productId, actualCount: 90 });
    expect(movement).not.toBeNull();
    expect(movement!.movement_type).toBe('ADJUSTMENT_OUT');
    expect(movement!.quantity).toBe(10);
    expect(stockOf(productId)).toBe(90);
  });

  it('stock zéro : théorique 0, compté 5 → ADJUSTMENT_IN 5', () => {
    const productId = createProduct('INV-ZERO');
    const movement = StockLedgerService.adjustInventory({ product_id: productId, actualCount: 5 });
    expect(movement).not.toBeNull();
    expect(movement!.movement_type).toBe('ADJUSTMENT_IN');
    expect(stockOf(productId)).toBe(5);
  });

  it('aucun écart → aucun mouvement créé (null)', () => {
    const productId = createProduct('INV-EQUAL');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 50 });
    const movement = StockLedgerService.adjustInventory({ product_id: productId, actualCount: 50 });
    expect(movement).toBeNull();
    expect(movementsOf(productId)).toHaveLength(1); // seul le PURCHASE_IN existe
  });

  it('produit inexistant → erreur', () => {
    expect(() => StockLedgerService.adjustInventory({ product_id: randomUUID(), actualCount: 5 }))
      .toThrow(/Produit introuvable/);
  });

  it('quantité comptée négative → erreur', () => {
    const productId = createProduct('INV-NEG');
    expect(() => StockLedgerService.adjustInventory({ product_id: productId, actualCount: -3 }))
      .toThrow(/Quantité comptée invalide/);
  });

  it('quantité comptée décimale → ADJUSTMENT_OUT précis', () => {
    const productId = createProduct('INV-DEC');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 10.75 });
    const movement = StockLedgerService.adjustInventory({ product_id: productId, actualCount: 8.5 });
    expect(movement!.movement_type).toBe('ADJUSTMENT_OUT');
    expect(movement!.quantity).toBeCloseTo(2.25, 5);
    expect(stockOf(productId)).toBeCloseTo(8.5, 5);
  });
});

describe('Produits — création, modification, suppression protégée (§9, §17)', () => {
  beforeEach(() => {
    db.exec('DELETE FROM inventory_balances; DELETE FROM stock_movements; DELETE FROM products;');
  });

  it('crée un produit', () => {
    const id = createProduct('PROD-CREATE');
    expect(id).toBeTruthy();
    expect(stockOf(id)).toBe(0);
  });

  it('refuse une référence dupliquée', () => {
    createProduct('PROD-DUP');
    const input: ProductInput = {
      reference: 'PROD-DUP',
      designation: 'Doublon',
      purchase_price: 5,
      selling_price: 8,
      wholesale_price: 6,
      min_stock: 1,
      unit: 'PIÈCE',
      status: 'ACTIVE',
    };
    expect(() => ProductService.createProduct(input)).toThrow(/déjà utilisée/);
  });

  it('refuse prix de vente < prix d\'achat', () => {
    const input: ProductInput = {
      reference: 'PROD-PRICE',
      designation: 'Prix cassé',
      purchase_price: 10,
      selling_price: 9,
      wholesale_price: 9.5,
      min_stock: 1,
      unit: 'PIÈCE',
      status: 'ACTIVE',
    };
    expect(() => ProductService.createProduct(input)).toThrow(/prix de vente/);
  });

  it('refuse la suppression d\'un produit avec historique de stock (données protégées)', () => {
    const productId = createProduct('PROD-PROTECT');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 10 });
    expect(() => ProductService.deleteProduct(productId)).toThrow(/historique de stock/);
  });

  it('permet la suppression d\'un produit sans historique', () => {
    const productId = createProduct('PROD-CLEAN');
    expect(() => ProductService.deleteProduct(productId)).not.toThrow();
  });

  it('archive un produit (masqué mais historique conservé)', () => {
    const productId = createProduct('PROD-ARCHIVE');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 3 });
    expect(() => ProductService.archiveProduct(productId)).not.toThrow();
    const archived = ProductRepository.findById(productId);
    expect(archived?.status).toBe('ARCHIVED');
    expect(stockOf(productId)).toBe(3); // historique conservé
  });
});

describe('Cohérence rebuildBalances vs recordMovement (CMUP identique, §14)', () => {
  beforeEach(() => {
    db.exec('DELETE FROM inventory_balances; DELETE FROM stock_movements; DELETE FROM products;');
  });

  it('la balance maintenue par recordMovement est identique à celle recalculée par rebuildBalances', () => {
    const productId = createProduct('COHERENCE-CMUP');

    // Mouvements variés : entrées à prix différents, sorties, retour, ajustement.
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 50, unit_price: 20 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'SALE_OUT', quantity: 30, unit_price: 25 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'RETURN_IN', quantity: 5, unit_price: 15 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'ADJUSTMENT_IN', quantity: 3, unit_price: 12 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'DAMAGE_OUT', quantity: 2, unit_price: 0 });

    // Balance "en direct" (recordMovement)
    const live = db.prepare('SELECT quantity, total_in_qty, total_in_value, average_cost FROM inventory_balances WHERE product_id = ?').get(productId) as {
      quantity: number; total_in_qty: number; total_in_value: number; average_cost: number;
    };

    // Rebuild complet depuis l'historique
    StockLedgerService.rebuildBalances();

    const rebuilt = db.prepare('SELECT quantity, total_in_qty, total_in_value, average_cost FROM inventory_balances WHERE product_id = ?').get(productId) as {
      quantity: number; total_in_qty: number; total_in_value: number; average_cost: number;
    };

    // Les deux balances doivent être strictement identiques (CMUP exact)
    expect(rebuilt.quantity).toBeCloseTo(live.quantity, 6);
    expect(rebuilt.total_in_qty).toBeCloseTo(live.total_in_qty, 6);
    expect(rebuilt.total_in_value).toBeCloseTo(live.total_in_value, 6);
    expect(rebuilt.average_cost).toBeCloseTo(live.average_cost, 6);
    expect(rebuilt.average_cost).toBeCloseTo(rebuilt.total_in_value / rebuilt.total_in_qty, 6);
  });

  it('CMUP exact : 100×10 + 100×20 = 3000 / 200 = 15', () => {
    const productId = createProduct('COHERENCE-CMUP-2');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 20 });

    const balance = db.prepare('SELECT total_in_qty, total_in_value, average_cost FROM inventory_balances WHERE product_id = ?').get(productId) as {
      total_in_qty: number; total_in_value: number; average_cost: number;
    };
    expect(balance.total_in_qty).toBe(200);
    expect(balance.total_in_value).toBe(3000);
    expect(balance.average_cost).toBeCloseTo(15, 10);

    StockLedgerService.rebuildBalances();
    const rebuilt = db.prepare('SELECT total_in_qty, total_in_value, average_cost FROM inventory_balances WHERE product_id = ?').get(productId) as {
      total_in_qty: number; total_in_value: number; average_cost: number;
    };
    expect(rebuilt.total_in_qty).toBe(200);
    expect(rebuilt.total_in_value).toBe(3000);
    expect(rebuilt.average_cost).toBeCloseTo(15, 10);
  });

  it('sorties ne modifient pas le CMUP (seules les entrées valorisent)', () => {
    const productId = createProduct('COHERENCE-CMUP-3');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 10, unit_price: 1 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 10, unit_price: 3 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'SALE_OUT', quantity: 5, unit_price: 5 });

    const balance = db.prepare('SELECT total_in_qty, total_in_value, average_cost FROM inventory_balances WHERE product_id = ?').get(productId) as {
      total_in_qty: number; total_in_value: number; average_cost: number;
    };
    // CMUP = (10×1 + 10×3) / 20 = 40/20 = 2 — la sortie ne change pas le coût moyen
    expect(balance.average_cost).toBeCloseTo(2, 10);
  });
});

describe('Transfert entre dépôts (§19)', () => {
  beforeEach(() => {
    db.exec('DELETE FROM inventory_balances; DELETE FROM stock_movements; DELETE FROM products;');
  });

  it('TRANSFER_OUT + TRANSFER_IN atomiques', () => {
    const fromId = createProduct('TRANSFER-A');
    const toId = createProduct('TRANSFER-B');
    StockLedgerService.recordMovement({ product_id: fromId, movement_type: 'PURCHASE_IN', quantity: 50 });

    const result = StockLedgerService.transfer({ from_product_id: fromId, to_product_id: toId, quantity: 20 });
    expect(result.out.movement_type).toBe('TRANSFER_OUT');
    expect(result.in.movement_type).toBe('TRANSFER_IN');
    expect(stockOf(fromId)).toBe(30);
    expect(stockOf(toId)).toBe(20);
  });

  it('refuse un transfert de plus que le stock disponible', () => {
    const fromId = createProduct('TRANSFER-C');
    const toId = createProduct('TRANSFER-D');
    StockLedgerService.recordMovement({ product_id: fromId, movement_type: 'PURCHASE_IN', quantity: 5 });
    expect(() => StockLedgerService.transfer({ from_product_id: fromId, to_product_id: toId, quantity: 6 }))
      .toThrow(/Stock insuffisant/);
    expect(stockOf(fromId)).toBe(5);
    expect(stockOf(toId)).toBe(0);
  });
});
