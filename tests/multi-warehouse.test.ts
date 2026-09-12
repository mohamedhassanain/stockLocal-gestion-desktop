import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { StockLedgerService } from '../src/services/StockLedgerService';
import { DashboardRepository } from '../src/repositories/DashboardRepository';
import { InventorySessionRepository } from '../src/repositories/InventorySessionRepository';

/**
 * Multi-dépôts (ventilation réelle) — Phase 2.
 * Vérifie : mouvements par dépôt, soldes distincts par dépôt, transferts
 * atomiques (réussis + refusés), et cohérence de rebuildBalances.
 */

const PRODUCT_ID = 'mw-prod-1';
const PRODUCT_REF = 'MW-REF-1';

function cleanup(): void {
  db.exec(`
    DELETE FROM stock_transfers;
    DELETE FROM inventory_balances;
    DELETE FROM stock_movements;
    DELETE FROM products;
    DELETE FROM warehouses;
  `);
}

function seedProduct(): void {
  db.prepare(`
    INSERT INTO products (id, reference, designation, status, purchase_price, selling_price, wholesale_price, min_stock, unit)
    VALUES (?, ?, 'Produit multi-dépôt', 'ACTIVE', 10, 20, 15, 0, 'PIÈCE')
  `).run(PRODUCT_ID, PRODUCT_REF);
}

function createWarehouse(id: string, name: string, isDefault = 0): void {
  db.prepare('INSERT INTO warehouses (id, name, is_default) VALUES (?, ?, ?)').run(id, name, isDefault);
}

function transferCount(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM stock_transfers').get() as { c: number }).c;
}

describe('Multi-dépôts — mouvements et soldes par dépôt', () => {
  beforeEach(() => { cleanup(); seedProduct(); });
  afterEach(() => cleanup());

  it('enregistre un mouvement dans UN dépôt et lit le solde consolidé = somme', () => {
    createWarehouse('w1', 'Dépôt 1', 1);
    createWarehouse('w2', 'Dépôt 2');

    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'PURCHASE_IN', quantity: 10, unit_price: 5, warehouse_id: 'w1' });
    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'PURCHASE_IN', quantity: 4, unit_price: 5, warehouse_id: 'w2' });

    expect(StockLedgerService.getStockLevel(PRODUCT_ID, 'w1')).toBe(10);
    expect(StockLedgerService.getStockLevel(PRODUCT_ID, 'w2')).toBe(4);
    // Lecture sans dépôt → CONSOLIDÉ
    expect(StockLedgerService.getStockLevel(PRODUCT_ID)).toBe(14);
  });

  it('une sortie ne décrémente QUE le dépôt concerné', () => {
    createWarehouse('w1', 'Dépôt 1', 1);
    createWarehouse('w2', 'Dépôt 2');

    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'PURCHASE_IN', quantity: 10, unit_price: 5, warehouse_id: 'w1' });
    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'PURCHASE_IN', quantity: 4, unit_price: 5, warehouse_id: 'w2' });
    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'SALE_OUT', quantity: 3, warehouse_id: 'w1' });

    expect(StockLedgerService.getStockLevel(PRODUCT_ID, 'w1')).toBe(7);
    expect(StockLedgerService.getStockLevel(PRODUCT_ID, 'w2')).toBe(4);
    expect(StockLedgerService.getStockLevel(PRODUCT_ID)).toBe(11);
  });

  it('refuse une sortie si le stock est insuffisant DANS ce dépôt (même si présent ailleurs)', () => {
    createWarehouse('w1', 'Dépôt 1', 1);
    createWarehouse('w2', 'Dépôt 2');

    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'PURCHASE_IN', quantity: 50, unit_price: 5, warehouse_id: 'w2' });

    expect(() => StockLedgerService.recordMovement({
      product_id: PRODUCT_ID, movement_type: 'SALE_OUT', quantity: 1, warehouse_id: 'w1',
    })).toThrow(/insuffisant/i);

    expect(StockLedgerService.getStockLevel(PRODUCT_ID, 'w1')).toBe(0);
    expect(StockLedgerService.getStockLevel(PRODUCT_ID, 'w2')).toBe(50);
  });
});

describe('Multi-dépôts — transferts entre dépôts (atomiques)', () => {
  beforeEach(() => { cleanup(); seedProduct(); });
  afterEach(() => cleanup());

  it('transfère du stock : les deux soldes bougent et une ligne stock_transfers est créée', () => {
    createWarehouse('w1', 'Dépôt 1', 1);
    createWarehouse('w2', 'Dépôt 2');
    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'PURCHASE_IN', quantity: 10, unit_price: 5, warehouse_id: 'w1' });

    const transfer = StockLedgerService.transferStock({
      product_id: PRODUCT_ID, from_warehouse_id: 'w1', to_warehouse_id: 'w2', quantity: 4,
    });

    expect(transfer.from_warehouse_id).toBe('w1');
    expect(transfer.to_warehouse_id).toBe('w2');
    expect(transfer.quantity).toBe(4);

    expect(StockLedgerService.getStockLevel(PRODUCT_ID, 'w1')).toBe(6);
    expect(StockLedgerService.getStockLevel(PRODUCT_ID, 'w2')).toBe(4);
    // Le consolidé ne change jamais lors d'un transfert interne.
    expect(StockLedgerService.getStockLevel(PRODUCT_ID)).toBe(10);

    expect(transferCount()).toBe(1);
    const types = (db.prepare("SELECT movement_type FROM stock_movements WHERE movement_type IN ('TRANSFER_OUT','TRANSFER_IN')").all() as Array<{ movement_type: string }>)
      .map(r => r.movement_type).sort();
    expect(types).toEqual(['TRANSFER_IN', 'TRANSFER_OUT']);
  });

  it('refuse un transfert si le stock source est insuffisant (aucun mouvement créé)', () => {
    createWarehouse('w1', 'Dépôt 1', 1);
    createWarehouse('w2', 'Dépôt 2');
    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'PURCHASE_IN', quantity: 2, unit_price: 5, warehouse_id: 'w1' });

    expect(() => StockLedgerService.transferStock({
      product_id: PRODUCT_ID, from_warehouse_id: 'w1', to_warehouse_id: 'w2', quantity: 5,
    })).toThrow(/insuffisant/i);

    expect(StockLedgerService.getStockLevel(PRODUCT_ID, 'w1')).toBe(2);
    expect(StockLedgerService.getStockLevel(PRODUCT_ID, 'w2')).toBe(0);
    expect(transferCount()).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE movement_type IN ('TRANSFER_OUT','TRANSFER_IN')").get() as { c: number }).c).toBe(0);
  });

  it('refuse un transfert vers le même dépôt', () => {
    createWarehouse('w1', 'Dépôt 1', 1);
    expect(() => StockLedgerService.transferStock({
      product_id: PRODUCT_ID, from_warehouse_id: 'w1', to_warehouse_id: 'w1', quantity: 1,
    })).toThrow(/différents/i);
    expect(transferCount()).toBe(0);
  });
});

describe('Multi-dépôts — rebuildBalances reste cohérent', () => {
  beforeEach(() => { cleanup(); seedProduct(); });
  afterEach(() => cleanup());

  it('reconstruit les soldes par (produit, dépôt) à l\'identique', () => {
    createWarehouse('w1', 'Dépôt 1', 1);
    createWarehouse('w2', 'Dépôt 2');

    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'PURCHASE_IN', quantity: 10, unit_price: 5, warehouse_id: 'w1' });
    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'PURCHASE_IN', quantity: 4, unit_price: 5, warehouse_id: 'w2' });
    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'SALE_OUT', quantity: 3, warehouse_id: 'w1' });

    const w1Before = StockLedgerService.getStockLevel(PRODUCT_ID, 'w1');
    const w2Before = StockLedgerService.getStockLevel(PRODUCT_ID, 'w2');

    StockLedgerService.rebuildBalances();

    expect(StockLedgerService.getStockLevel(PRODUCT_ID, 'w1')).toBe(w1Before);
    expect(StockLedgerService.getStockLevel(PRODUCT_ID, 'w2')).toBe(w2Before);
    expect(StockLedgerService.getStockLevel(PRODUCT_ID)).toBe(11);
  });
});

describe('Multi-depots - lectures (alertes, repartition) par depot', () => {
  beforeEach(() => { cleanup(); seedProduct(); });
  afterEach(() => cleanup());

  it('alertes de stock bas calculees PAR depot', () => {
    db.prepare('UPDATE products SET min_stock = 5 WHERE id = ?').run(PRODUCT_ID);
    createWarehouse('w1', 'Depot 1', 1);
    createWarehouse('w2', 'Depot 2');

    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'PURCHASE_IN', quantity: 10, unit_price: 5, warehouse_id: 'w1' });

    expect(DashboardRepository.getLowStockAlerts()).toHaveLength(0);
    expect(DashboardRepository.getLowStockAlerts('w1')).toHaveLength(0);
    const w2Alerts = DashboardRepository.getLowStockAlerts('w2');
    expect(w2Alerts).toHaveLength(1);
    expect(w2Alerts[0].current_stock).toBe(0);
  });

  it('repartit le stock dun produit par depot (getWarehouseBreakdown)', () => {
    createWarehouse('w1', 'Depot 1', 1);
    createWarehouse('w2', 'Depot 2');
    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'PURCHASE_IN', quantity: 7, unit_price: 5, warehouse_id: 'w1' });
    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'PURCHASE_IN', quantity: 3, unit_price: 5, warehouse_id: 'w2' });

    const breakdown = StockLedgerService.getWarehouseBreakdown(PRODUCT_ID);
    const byId = Object.fromEntries(breakdown.map(b => [b.warehouse_id, b.quantity]));
    expect(byId['w1']).toBe(7);
    expect(byId['w2']).toBe(3);
    expect(breakdown.every(b => typeof b.warehouse_name === 'string')).toBe(true);
  });
});

describe('Multi-depots - inventaire physique par depot', () => {
  function cleanupInventory(): void {
    db.exec(`
      DELETE FROM inventory_item_versions;
      DELETE FROM inventory_versions;
      DELETE FROM inventory_items;
      DELETE FROM inventory_sessions;
      DELETE FROM stock_transfers;
      DELETE FROM inventory_balances;
      DELETE FROM stock_movements;
      DELETE FROM products;
      DELETE FROM warehouses;
    `);
  }

  beforeEach(() => { cleanupInventory(); seedProduct(); });
  afterEach(() => cleanupInventory());

  it('cree un inventaire pour UN depot : stock attendu + validation dans ce depot', () => {
    createWarehouse('w1', 'Depot 1', 1);
    createWarehouse('w2', 'Depot 2');
    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'PURCHASE_IN', quantity: 10, unit_price: 5, warehouse_id: 'w1' });
    StockLedgerService.recordMovement({ product_id: PRODUCT_ID, movement_type: 'PURCHASE_IN', quantity: 2, unit_price: 5, warehouse_id: 'w2' });

    const session = InventorySessionRepository.create({ name: 'Inventaire depot 2', warehouse_id: 'w2' });
    expect(session.warehouse_id).toBe('w2');
    const item = (session.items ?? []).find(i => i.product_id === PRODUCT_ID);
    expect(item?.expected_qty).toBe(2);

    InventorySessionRepository.startCounting(session.id);
    InventorySessionRepository.countItem(item!.id, 5);
    InventorySessionRepository.calculateGaps(session.id);
    InventorySessionRepository.validate(session.id);

    expect(StockLedgerService.getStockLevel(PRODUCT_ID, 'w2')).toBe(5);
    expect(StockLedgerService.getStockLevel(PRODUCT_ID, 'w1')).toBe(10);
    expect(StockLedgerService.getStockLevel(PRODUCT_ID)).toBe(15);
  });
});
