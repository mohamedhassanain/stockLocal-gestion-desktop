import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { StockLedgerService } from '../src/services/StockLedgerService';
import { ProductService } from '../src/services/ProductService';
import { ProductRepository, type ProductInput } from '../src/repositories/ProductRepository';
import { InventorySessionRepository } from '../src/repositories/InventorySessionRepository';

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

function stockMovementsCountForDocument(documentId: string): number {
  return (db.prepare('SELECT COUNT(*) AS cnt FROM stock_movements WHERE document_id = ?').get(documentId) as { cnt: number }).cnt;
}

// Crée une session, compte `countedQty` pour le produit, calcule les écarts.
function setupSessionWithCount(productRef: string, initialStock: number, countedQty: number): { sessionId: string; itemId: string; productId: string } {
  const productId = createProduct(productRef);
  StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: initialStock });
  const session = InventorySessionRepository.create({ name: `Session ${productRef}` });
  InventorySessionRepository.startCounting(session.id);
  const item = session.items!.find(i => i.product_id === productId)!;
  InventorySessionRepository.countItem(item.id, countedQty);
  InventorySessionRepository.calculateGaps(session.id);
  return { sessionId: session.id, itemId: item.id, productId };
}

describe('Inventaire — P0-4 : empêcher la double validation', () => {
  beforeEach(() => {
    db.exec(`
      DELETE FROM inventory_item_versions;
      DELETE FROM inventory_versions;
      DELETE FROM inventory_items;
      DELETE FROM inventory_sessions;
      DELETE FROM inventory_balances;
      DELETE FROM stock_movements;
      DELETE FROM products;
    `);
  });

  it('validate() → stock 95 ; validate() à nouveau → REFUSED et AUCUN second ajustement', () => {
    const { sessionId, productId } = setupSessionWithCount('INV-DOUBLE', 100, 95);

    const validated = InventorySessionRepository.validate(sessionId);
    expect(validated.status).toBe('VALIDATION');
    expect(stockOf(productId)).toBe(95); // -5 appliqué une seule fois

    const movementCount = stockMovementsCountForDocument(sessionId);
    expect(movementCount).toBe(1); // un seul ADJUSTMENT_OUT (pas 2)

    // Deuxième validation → refusée
    expect(() => InventorySessionRepository.validate(sessionId)).toThrow(/déjà été validée/);
    expect(stockOf(productId)).toBe(95); // pas de -10
    expect(stockMovementsCountForDocument(sessionId)).toBe(1); // toujours 1 mouvement
  });

  it('suppression d’une session VALIDATION → REFUSÉE (historique protégé)', () => {
    const { sessionId } = setupSessionWithCount('INV-REMOVE-VALIDATED', 100, 95);
    InventorySessionRepository.validate(sessionId);
    expect(() => InventorySessionRepository.remove(sessionId)).toThrow(/historique de stock doit être conservé|supprimer un inventaire validé/);
  });
});

describe('Inventaire — P0-3 : state machine stricte', () => {
  beforeEach(() => {
    db.exec(`
      DELETE FROM inventory_item_versions;
      DELETE FROM inventory_versions;
      DELETE FROM inventory_items;
      DELETE FROM inventory_sessions;
      DELETE FROM inventory_balances;
      DELETE FROM stock_movements;
      DELETE FROM products;
    `);
  });

  it('update() refuse de modifier directement le statut', () => {
    const session = InventorySessionRepository.create({ name: 'STATE-MACHINE' });
    expect(() => InventorySessionRepository.update(session.id, { name: 'STATE-MACHINE', status: 'VALIDATION' }))
      .toThrow(/ne peut pas être modifié directement/);
    expect(session.status).toBe('DRAFT'); // inchangé
  });
});

describe('Inventaire — P0-6 : restauration d’une version (nouvelle version, historique intact)', () => {
  beforeEach(() => {
    db.exec(`
      DELETE FROM inventory_item_versions;
      DELETE FROM inventory_versions;
      DELETE FROM inventory_items;
      DELETE FROM inventory_sessions;
      DELETE FROM inventory_balances;
      DELETE FROM stock_movements;
      DELETE FROM products;
    `);
  });

  it('V1=95, V2=97, V3=96 → restore V2 → V4=97, V1/V2/V3 restent intacts', () => {
    const productId = createProduct('INV-VERSION');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100 });
    const session = InventorySessionRepository.create({ name: 'Versioning' });
    InventorySessionRepository.startCounting(session.id);
    const item = session.items!.find(i => i.product_id === productId)!;

    // V1 = 95
    InventorySessionRepository.countItem(item.id, 95);
    InventorySessionRepository.createVersion(session.id, 'V1 = 95');

    // V2 = 97
    InventorySessionRepository.countItem(item.id, 97);
    InventorySessionRepository.createVersion(session.id, 'V2 = 97');

    // V3 = 96
    InventorySessionRepository.countItem(item.id, 96);
    InventorySessionRepository.createVersion(session.id, 'V3 = 96');

    const versionsBefore = InventorySessionRepository.getVersions(session.id);
    expect(versionsBefore).toHaveLength(3);
    expect(versionsBefore.map(v => v.version_number)).toEqual([3, 2, 1]); // ordre DESC

    const v2 = versionsBefore.find(v => v.version_number === 2)!;
    InventorySessionRepository.restoreVersion(session.id, v2.id, 'Restauration V2');

    const versionsAfter = InventorySessionRepository.getVersions(session.id);
    expect(versionsAfter).toHaveLength(4); // nouvelle version créée, pas d'écrasement
    expect(versionsAfter.map(v => v.version_number)).toContain(1);
    expect(versionsAfter.map(v => v.version_number)).toContain(2);
    expect(versionsAfter.map(v => v.version_number)).toContain(3);
    expect(versionsAfter.map(v => v.version_number)).toContain(4);

    // Le comptage courant est celui de V2 (= 97)
    const sessionAfter = InventorySessionRepository.getById(session.id)!;
    expect(sessionAfter.items!.find(i => i.product_id === productId)!.counted_qty).toBe(97);

    // La version 4 contient bien 97 (copie de V2)
    const v4 = versionsAfter.find(v => v.version_number === 4)!;
    const v4Items = db.prepare('SELECT * FROM inventory_item_versions WHERE version_id = ?').all(v4.id) as Array<{ counted_qty: number }>;
    expect(v4Items[0].counted_qty).toBe(97);
  });
});

describe('Inventaire — P0-5 : version / session mismatch refusé', () => {
  beforeEach(() => {
    db.exec(`
      DELETE FROM inventory_item_versions;
      DELETE FROM inventory_versions;
      DELETE FROM inventory_items;
      DELETE FROM inventory_sessions;
      DELETE FROM inventory_balances;
      DELETE FROM stock_movements;
      DELETE FROM products;
    `);
  });

  it('restaurer une version d’une AUTRE session → REFUSÉ', () => {
    const productId = createProduct('INV-MISMATCH');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100 });

    const sessionA = InventorySessionRepository.create({ name: 'Session A' });
    InventorySessionRepository.startCounting(sessionA.id);
    const itemA = sessionA.items!.find(i => i.product_id === productId)!;
    InventorySessionRepository.countItem(itemA.id, 95);
    InventorySessionRepository.createVersion(sessionA.id, 'V1-A');

    const sessionB = InventorySessionRepository.create({ name: 'Session B' });
    InventorySessionRepository.startCounting(sessionB.id);
    const itemB = sessionB.items!.find(i => i.product_id === productId)!;
    InventorySessionRepository.countItem(itemB.id, 98);
    InventorySessionRepository.createVersion(sessionB.id, 'V1-B');

    const versionA = InventorySessionRepository.getVersions(sessionA.id)[0];
    // On tente de restaurer la version de A dans la session B → refusé.
    expect(() => InventorySessionRepository.restoreVersion(sessionB.id, versionA.id))
      .toThrow(/n\'appartient pas à cette session/);
  });
});

describe('Inventaire — P0-7 : correction post-validation', () => {
  beforeEach(() => {
    db.exec(`
      DELETE FROM inventory_item_versions;
      DELETE FROM inventory_versions;
      DELETE FROM inventory_items;
      DELETE FROM inventory_sessions;
      DELETE FROM inventory_balances;
      DELETE FROM stock_movements;
      DELETE FROM products;
    `);
  });

  it('corrige 95 → 97 après validation → ajustement +2 (stock 97)', () => {
    const { sessionId, itemId, productId } = setupSessionWithCount('INV-CORRECT', 100, 95);
    InventorySessionRepository.validate(sessionId);
    expect(stockOf(productId)).toBe(95);

    // Correction : 97 → +2
    InventorySessionRepository.correctValidatedInventory(sessionId, itemId, 97);
    expect(stockOf(productId)).toBe(97);

    // L'inventaire reste VALIDATION
    const session = InventorySessionRepository.getById(sessionId)!;
    expect(session.status).toBe('VALIDATION');
    expect(session.items!.find(i => i.id === itemId)!.counted_qty).toBe(97);
  });
});
