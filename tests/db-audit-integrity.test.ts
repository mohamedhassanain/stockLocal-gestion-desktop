import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/database/config/connection';
import { StockLedgerService } from '../src/services/StockLedgerService';

/**
 * ─── AUDIT BASE DE DONNÉES — §2 (intégrité référentielle réelle) & §3
 *     (cohérence stock_movements ↔ inventory_balances multi-dépôts) ───────────
 *
 * Ce fichier n'invente rien : il remplit la base RÉELLE ouverte par le pipeline
 * `connection.ts` avec des données représentatives de TOUTES les fonctionnalités
 * (produits, multi-dépôts, documents, paiements, avoirs, achats, inventaire,
 * dépenses, caisse, lots), puis exécute de VRAIES vérifications SQLite.
 */

const W_DEF = 'audit-w-default';
const W_2 = 'audit-w-2';
const P1 = 'audit-p1';
const P2 = 'audit-p2';

function seedRepresentativeData(): void {
  const now = '2026-03-01T10:00:00.000Z';
  db.exec(`
    INSERT INTO categories (id, name) VALUES ('audit-cat', 'Catégorie audit');
    INSERT INTO subcategories (id, category_id, name) VALUES ('audit-sub', 'audit-cat', 'Sous-catégorie audit');

    INSERT INTO warehouses (id, name, is_default) VALUES ('${W_DEF}', 'Dépôt audit', 1);
    INSERT INTO warehouses (id, name, is_default) VALUES ('${W_2}', 'Dépôt audit 2', 0);

    INSERT INTO products (id, reference, designation, category_id, subcategory_id, barcode, unit, purchase_price, selling_price, wholesale_price, min_stock, batch_managed, vat_rate, supplier_id, status)
      VALUES ('${P1}', 'AUD-P1', 'Produit audit 1', 'audit-cat', 'audit-sub', 'BC-AUD-1', 'PIÈCE', 10, 20, 15, 2, 1, 20, 'audit-sup', 'ACTIVE');
    INSERT INTO products (id, reference, designation, unit, purchase_price, selling_price, wholesale_price, min_stock, batch_managed, vat_rate, status)
      VALUES ('${P2}', 'AUD-P2', 'Produit audit 2', 'KG', 4, 9, 7, 1, 0, 20, 'ACTIVE');

    INSERT INTO customers (id, name, category) VALUES ('audit-cust', 'Client audit', 'DÉTAIL');
    INSERT INTO suppliers (id, name) VALUES ('audit-sup', 'Fournisseur audit');

    INSERT INTO client_credits (id, customer_id, type, amount, date) VALUES ('audit-cc', 'audit-cust', 'CREDIT', 100, '${now}');
    INSERT INTO supplier_credits (id, supplier_id, type, amount, date) VALUES ('audit-sc', 'audit-sup', 'DEBT', 200, '${now}');

    INSERT INTO documents (id, type, document_number, entity_id, date, total_excl_tax, total_tax, total_incl_tax, discount_amount, status)
      VALUES ('audit-inv', 'INVOICE', 'AUD-2026-00001', 'audit-cust', '${now}', 100, 20, 120, 0, 'PARTIAL');
    INSERT INTO documents (id, type, document_number, entity_id, original_document_id, date, total_excl_tax, total_tax, total_incl_tax, discount_amount, status)
      VALUES ('audit-cn', 'CREDIT_NOTE', 'AUD-2026-00002', 'audit-cust', 'audit-inv', '${now}', 20, 4, 24, 0, 'PAID');
    -- credit_note_refs référence DEUX documents (avoir + facture) : inséré APRÈS eux.
    INSERT INTO credit_note_refs (id, credit_note_id, original_document_id, product_id, quantity) VALUES ('audit-cnr', 'audit-cn', 'audit-inv', '${P1}', 1);

    INSERT INTO document_items (id, document_id, product_id, quantity, unit_price, discount, total, vat_rate)
      VALUES ('audit-di1', 'audit-inv', '${P1}', 5, 20, 0, 100, 20);
    INSERT INTO payments (id, document_id, amount, payment_method, date) VALUES ('audit-pay', 'audit-inv', 60, 'CASH', '${now}');
    INSERT INTO document_sequences (type, year, last_number) VALUES ('INVOICE', 2026, 1);

    INSERT INTO audit_logs (id, action, entity_type, entity_id) VALUES ('audit-log', 'CREATE', 'PRODUCT', '${P1}');
    INSERT INTO company_settings (key, value) VALUES ('audit-key', 'audit-value');
    INSERT INTO global_settings (key, value) VALUES ('audit-setting', 'audit-value');

    INSERT INTO volume_discounts (id, name, min_qty, discount_pct) VALUES ('audit-vd', 'Remise audit', 10, 5);
    INSERT INTO product_batches (id, product_id, lot_number, quantity, expiry_date) VALUES ('audit-batch', '${P1}', 'LOT-AUD-1', 5, '2027-01-01');
    INSERT INTO unit_conversions (id, from_unit, to_unit, factor, product_id) VALUES ('audit-uc', 'CARTON', 'PIÈCE', 12, '${P1}');
    INSERT INTO price_history (id, product_id, purchase_price, selling_price, changed_at) VALUES ('audit-ph', '${P1}', 10, 20, '${now}');

    INSERT INTO purchase_orders (id, order_number, supplier_id, date, status, total) VALUES ('audit-po', 'CMD-2026-00001', 'audit-sup', '${now}', 'CONFIRMED', 100);
    INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_price, received_qty, total)
      VALUES ('audit-poi', 'audit-po', '${P1}', 10, 10, 0, 100);

    INSERT INTO inventory_sessions (id, name, warehouse_id, status, started_at) VALUES ('audit-is', 'Inventaire audit', '${W_DEF}', 'DRAFT', '${now}');
    INSERT INTO inventory_items (id, session_id, product_id, expected_qty, status) VALUES ('audit-ii', 'audit-is', '${P1}', 5, 'PENDING');
    INSERT INTO inventory_versions (id, session_id, version_number, created_at) VALUES ('audit-iv', 'audit-is', 1, '${now}');
    INSERT INTO inventory_item_versions (id, version_id, product_id, counted_qty) VALUES ('audit-iiv', 'audit-iv', '${P1}', 5);

    INSERT INTO cash_sessions (id, opened_at, opening_float, status, warehouse_id) VALUES ('audit-cs', '${now}', 500, 'OPEN', '${W_DEF}');
    INSERT INTO cash_movements (id, session_id, movement_type, direction, amount, payment_method, date) VALUES ('audit-cm', 'audit-cs', 'SALE_CASH', 'IN', 60, 'CASH', '${now}');
    INSERT INTO expenses (id, date, category, amount, payment_method, cash_session_id, warehouse_id) VALUES ('audit-exp', '${now}', 'TRANSPORT', 30, 'CASH', 'audit-cs', '${W_DEF}');

    INSERT INTO stock_movements (id, product_id, warehouse_id, type, movement_type, quantity, unit_price, date, document_id) VALUES
      ('audit-sm1', '${P1}', '${W_DEF}', 'IN', 'PURCHASE_IN', 10, 10, '${now}', NULL),
      ('audit-sm2', '${P1}', '${W_DEF}', 'OUT', 'SALE_OUT', 5, 20, '${now}', 'audit-inv'),
      ('audit-sm3', '${P2}', '${W_2}', 'IN', 'PURCHASE_IN', 20, 4, '${now}', NULL);
    INSERT INTO inventory_balances (product_id, warehouse_id, quantity, total_in_qty, total_in_value, average_cost) VALUES
      ('${P1}', '${W_DEF}', 5, 10, 100, 10),
      ('${P2}', '${W_2}', 20, 20, 80, 4);
    INSERT INTO stock_transfers (id, product_id, from_warehouse_id, to_warehouse_id, quantity, date) VALUES
      ('audit-st', '${P1}', '${W_DEF}', '${W_2}', 3, '${now}');
  `);
}

function cleanup(): void {
  db.exec(`
    DELETE FROM credit_note_refs;
    DELETE FROM inventory_item_versions;
    DELETE FROM inventory_versions;
    DELETE FROM inventory_items;
    DELETE FROM inventory_sessions;
    DELETE FROM purchase_order_items;
    DELETE FROM purchase_orders;
    DELETE FROM cash_movements;
    DELETE FROM expenses;
    DELETE FROM cash_sessions;
    DELETE FROM product_batches;
    DELETE FROM unit_conversions;
    DELETE FROM price_history;
    DELETE FROM volume_discounts;
    DELETE FROM stock_transfers;
    DELETE FROM inventory_balances;
    DELETE FROM stock_movements;
    DELETE FROM payments;
    DELETE FROM document_items;
    DELETE FROM documents;
    DELETE FROM document_sequences;
    DELETE FROM audit_logs;
    DELETE FROM client_credits;
    DELETE FROM supplier_credits;
    DELETE FROM products;
    DELETE FROM customers;
    DELETE FROM suppliers;
    DELETE FROM warehouses;
    -- subcategories référence categories (RESTRICT) : supprimer AVANT categories.
    DELETE FROM subcategories;
    DELETE FROM categories;
  `);
}

beforeAll(() => {
  cleanup();
  seedRepresentativeData();
});

afterAll(() => {
  cleanup();
});

describe('§2 — Intégrité référentielle réelle sur données représentatives', () => {
  it('PRAGMA foreign_key_check ne retourne AUCUNE violation', () => {
    const violations = db.pragma('foreign_key_check') as unknown[];
    expect(violations).toEqual([]);
  });

  it('PRAGMA integrity_check retourne « ok »', () => {
    const result = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    expect(result[0]?.integrity_check).toBe('ok');
  });

  it('chaque table déclarée contient bien les lignes insérées (échantillon)', () => {
    const checks: Array<[string, string, number]> = [
      ['products', 'SELECT COUNT(*) c FROM products WHERE id LIKE ?', 2],
      ['documents', 'SELECT COUNT(*) c FROM documents WHERE id LIKE ?', 2],
      ['stock_movements', 'SELECT COUNT(*) c FROM stock_movements WHERE id LIKE ?', 3],
      ['inventory_balances', 'SELECT COUNT(*) c FROM inventory_balances WHERE product_id LIKE ?', 2],
      ['cash_movements', 'SELECT COUNT(*) c FROM cash_movements WHERE id LIKE ?', 1],
      ['expenses', 'SELECT COUNT(*) c FROM expenses WHERE id LIKE ?', 1],
    ];
    for (const [label, sql, expected] of checks) {
      const row = db.prepare(sql).get('audit-%') as { c: number };
      expect(row.c, `${label}`).toBe(expected);
    }
  });

  it('les règles ON DELETE des FK protègent l historique (documents/stock) et cascadent le disposable', () => {
    const sqlOf = (t: string) => (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(t) as { sql: string }).sql;
    // Historique / comptable → RESTRICT (jamais de suppression en cascade).
    expect(sqlOf('stock_movements')).toContain('ON DELETE RESTRICT');
    expect(sqlOf('payments')).toContain('ON DELETE RESTRICT');
    expect(sqlOf('price_history')).toContain('ON DELETE RESTRICT');
    // Lignes d un document (disposable, rattachées à un document) → CASCADE.
    expect(sqlOf('document_items')).toContain('ON DELETE CASCADE');
    expect(sqlOf('inventory_items')).toContain('ON DELETE CASCADE');
    expect(sqlOf('cash_movements')).toContain('ON DELETE CASCADE');
  });
});

describe('§3 — Cohérence stock_movements ↔ inventory_balances (multi-dépôts)', () => {
  // Ids DÉDIÉS à §3 (jamais partagés avec §2) : la remise à zéro est SCOPÉE,
  // elle ne touche aucune autre donnée de la base d'audit.
  const WA = 'audit3-wa';
  const WB = 'audit3-wb';
  const P3 = 'audit3-p';

  function resetStock(): void {
    db.prepare('DELETE FROM stock_transfers WHERE product_id = ?').run(P3);
    db.prepare('DELETE FROM inventory_balances WHERE product_id = ?').run(P3);
    db.prepare('DELETE FROM stock_movements WHERE product_id = ?').run(P3);
    db.prepare('DELETE FROM products WHERE id = ?').run(P3);
    db.prepare('DELETE FROM warehouses WHERE id IN (?, ?)').run(WA, WB);
    db.prepare('INSERT INTO warehouses (id, name, is_default) VALUES (?, ?, 1)').run(WA, 'Dépôt A');
    db.prepare('INSERT INTO warehouses (id, name, is_default) VALUES (?, ?, 0)').run(WB, 'Dépôt B');
    db.prepare(`INSERT INTO products (id, reference, designation, unit, purchase_price, selling_price, wholesale_price, min_stock, status)
      VALUES (?, ?, 'Produit stock', 'PIÈCE', 10, 20, 15, 0, 'ACTIVE')`).run(P3, 'STK-3');
  }

  afterAll(() => {
    db.prepare('DELETE FROM stock_transfers WHERE product_id = ?').run(P3);
    db.prepare('DELETE FROM inventory_balances WHERE product_id = ?').run(P3);
    db.prepare('DELETE FROM stock_movements WHERE product_id = ?').run(P3);
    db.prepare('DELETE FROM products WHERE id = ?').run(P3);
    db.prepare('DELETE FROM warehouses WHERE id IN (?, ?)').run(WA, WB);
  });

  it('rebuildBalances produit EXACTEMENT les mêmes soldes que l enregistrement direct (mix de types)', () => {
    resetStock();

    // Mix multi-dépôts : achats, vente, transfert, ajustement, retour.
    StockLedgerService.recordMovement({ product_id: P3, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10, warehouse_id: WA });
    StockLedgerService.recordMovement({ product_id: P3, movement_type: 'PURCHASE_IN', quantity: 40, unit_price: 12, warehouse_id: WB });
    StockLedgerService.recordMovement({ product_id: P3, movement_type: 'SALE_OUT', quantity: 30, unit_price: 20, warehouse_id: WA });
    StockLedgerService.transferStock({ product_id: P3, from_warehouse_id: WA, to_warehouse_id: WB, quantity: 25 });
    StockLedgerService.adjustInventory({ product_id: P3, actualCount: 45, warehouse_id: WA, unit_price: 10 }); // ajuste le dépôt A
    StockLedgerService.recordMovement({ product_id: P3, movement_type: 'RETURN_IN', quantity: 5, unit_price: 10, warehouse_id: WA });
    StockLedgerService.recordMovement({ product_id: P3, movement_type: 'RETURN_OUT', quantity: 2, unit_price: 20, warehouse_id: WB });
    StockLedgerService.recordMovement({ product_id: P3, movement_type: 'DAMAGE_OUT', quantity: 3, unit_price: 20, warehouse_id: WB });

    const before = db.prepare('SELECT product_id, warehouse_id, quantity, total_in_qty, total_in_value, average_cost FROM inventory_balances ORDER BY warehouse_id').all() as Array<Record<string, number | string>>;

    StockLedgerService.rebuildBalances();

    const after = db.prepare('SELECT product_id, warehouse_id, quantity, total_in_qty, total_in_value, average_cost FROM inventory_balances ORDER BY warehouse_id').all() as Array<Record<string, number | string>>;

    expect(after).toEqual(before);
    // Le solde stocké correspond à l agrégat du journal.
    const audit = StockLedgerService.auditBalances();
    expect(audit.discrepancyCount).toBe(0);
  });

  it('aucun mouvement n a de warehouse_id NULL ou vide', () => {
    const rows = db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE warehouse_id IS NULL OR warehouse_id = ''").get() as { c: number };
    expect(rows.c).toBe(0);
  });

  it('chaque warehouse_id de mouvement et de solde référence un dépôt existant', () => {
    const orphanMov = db.prepare('SELECT COUNT(*) c FROM stock_movements sm LEFT JOIN warehouses w ON w.id = sm.warehouse_id WHERE w.id IS NULL').get() as { c: number };
    const orphanBal = db.prepare('SELECT COUNT(*) c FROM inventory_balances ib LEFT JOIN warehouses w ON w.id = ib.warehouse_id WHERE w.id IS NULL').get() as { c: number };
    expect(orphanMov.c).toBe(0);
    expect(orphanBal.c).toBe(0);
  });

  it('aucune quantité NEGATIVE INCOHERENTE : le moteur refuse une sortie au-delà du disponible', () => {
    resetStock();
    StockLedgerService.recordMovement({ product_id: P3, movement_type: 'PURCHASE_IN', quantity: 10, unit_price: 10, warehouse_id: WA });

    // Une vente supérieure au stock du dépôt est refusée → jamais de solde négatif.
    expect(() => StockLedgerService.recordMovement({
      product_id: P3, movement_type: 'SALE_OUT', quantity: 11, warehouse_id: WA,
    })).toThrow(/insuffisant/i);

    const neg = db.prepare('SELECT COUNT(*) c FROM inventory_balances WHERE quantity < 0').get() as { c: number };
    expect(neg.c).toBe(0);
  });
});
