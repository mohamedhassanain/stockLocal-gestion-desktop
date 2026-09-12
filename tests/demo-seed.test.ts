import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { DemoDataService } from '../src/services/DemoDataService';
import { StockLedgerService } from '../src/services/StockLedgerService';

/**
 * §Robustesse — Seed du jeu de démonstration sur une base NEUVE.
 *
 * Bug historique (révélé par le lancement réel du binaire packagé sur un profil
 * vierge) : `seedIfEmpty` insérait dans `stock_movements` SANS `warehouse_id`,
 * colonne NOT NULL depuis le multi-dépôts → « NOT NULL constraint failed:
 * stock_movements.warehouse_id ». Le seed échouait donc à la PREMIÈRE
 * installation, alors qu'il « marchait » sur toute base déjà peuplée.
 */

function cleanAll(): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    DELETE FROM credit_note_refs;
    DELETE FROM cash_movements;
    DELETE FROM expenses;
    DELETE FROM cash_sessions;
    DELETE FROM payments;
    DELETE FROM document_items;
    DELETE FROM stock_movements;
    DELETE FROM purchase_order_items;
    DELETE FROM purchase_orders;
    DELETE FROM price_history;
    DELETE FROM product_batches;
    DELETE FROM unit_conversions;
    DELETE FROM documents;
    DELETE FROM client_credits;
    DELETE FROM supplier_credits;
    DELETE FROM customers;
    DELETE FROM suppliers;
    DELETE FROM inventory_balances;
    DELETE FROM inventory_item_versions;
    DELETE FROM inventory_versions;
    DELETE FROM inventory_items;
    DELETE FROM inventory_sessions;
    DELETE FROM products;
    DELETE FROM subcategories;
    DELETE FROM categories;
    DELETE FROM volume_discounts;
    DELETE FROM global_settings;
    DELETE FROM company_settings;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

describe('§Robustesse — DemoDataService.seedIfEmpty sur base NEUVE', () => {
  beforeEach(() => cleanAll());

  it('crée le jeu de démonstration sans violer stock_movements.warehouse_id (NOT NULL)', () => {
    const res = DemoDataService.seedIfEmpty();
    expect(res.seeded).toBe(true);

    const products = (db.prepare('SELECT COUNT(*) AS c FROM products').get() as { c: number }).c;
    expect(products).toBe(6);

    // AUCUN mouvement de démo sans dépôt (c'était la cause de l'échec).
    const missingWarehouse = (
      db.prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE warehouse_id IS NULL OR warehouse_id = ''").get() as { c: number }
    ).c;
    expect(missingWarehouse).toBe(0);

    // Soldes cohérents avec le journal après le seed.
    expect(StockLedgerService.auditBalances().discrepancyCount).toBe(0);

    const lait = db.prepare("SELECT id FROM products WHERE reference = 'LAIT-1L'").get() as { id: string };
    expect(StockLedgerService.getStockLevel(lait.id)).toBe(120);
  });

  it('ne ré-injecte jamais le jeu de démonstration si la base contient déjà des produits', () => {
    expect(DemoDataService.seedIfEmpty().seeded).toBe(true);
    const second = DemoDataService.seedIfEmpty();
    expect(second.seeded).toBe(false);
    expect((db.prepare('SELECT COUNT(*) AS c FROM products').get() as { c: number }).c).toBe(6);
  });
});
