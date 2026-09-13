import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../src/database/config/connection';
// L'ordre suit `tests/multi-warehouse.test.ts` : `StockLedgerService` est chargé
// AVANT les repositories pour éviter tout cycle d'imports.
import { StockLedgerService } from '../src/services/StockLedgerService';
import { ProductRepository } from '../src/repositories/ProductRepository';
import { DashboardRepository } from '../src/repositories/DashboardRepository';

/**
 * §Multi-dépôts — SOLDE CONSOLIDÉ dans les lectures « produit ».
 *
 * `inventory_balances` a une clé primaire COMPOSITE (product_id, warehouse_id) :
 * un produit stocké dans deux dépôts y possède DEUX lignes. Joindre cette table
 * directement (au lieu de l'agréger par produit) produisait trois bugs :
 *
 *   1. DOUBLONS — listes et menus déroulants affichaient le produit plusieurs
 *      fois, d'où les avertissements React « Encountered two children with the
 *      same key » (Transferts, Alertes stock…).
 *   2. STOCK FAUX — `findById().current_stock` ne renvoyait le stock que d'UN
 *      SEUL dépôt au lieu du stock total.
 *   3. PAGINATION FAUSSE — `LIMIT/OFFSET` comptait les lignes dupliquées, donc
 *      une page renvoyait moins de produits distincts que demandé.
 *
 * Ces tests verrouillent les trois propriétés.
 */

const PRODUCT_ID = 'cons-1';
const PRODUCT_REF = 'CONS-REF-1';
const PRODUCT_BARCODE = '2000000000015';
const SECOND_ID = 'cons-2';
const SECOND_REF = 'CONS-REF-2';

function cleanup(): void {
  db.exec(`
    DELETE FROM stock_transfers;
    DELETE FROM inventory_balances;
    DELETE FROM stock_movements;
    DELETE FROM products;
    DELETE FROM warehouses;
  `);
}

function seedProduct(opts: {
  id: string; reference: string; designation: string; barcode?: string | null; minStock?: number;
}): void {
  db.prepare(`
    INSERT INTO products
      (id, reference, designation, barcode, status, purchase_price, selling_price,
       wholesale_price, min_stock, max_stock, vat_rate, vat_inherit_from_category, unit)
    VALUES (?, ?, ?, ?, 'ACTIVE', 10, 20, 15, ?, 0, 20, 0, 'PIÈCE')
  `).run(opts.id, opts.reference, opts.designation, opts.barcode ?? null, opts.minStock ?? 0);
}

function createWarehouse(id: string, name: string, isDefault = 0): void {
  db.prepare('INSERT INTO warehouses (id, name, is_default) VALUES (?, ?, ?)').run(id, name, isDefault);
}

/** Alimente UN dépôt pour un produit donné. */
function stockIn(productId: string, quantity: number, warehouseId: string): void {
  StockLedgerService.recordMovement({
    product_id: productId,
    movement_type: 'PURCHASE_IN',
    quantity,
    unit_price: 5,
    warehouse_id: warehouseId,
  });
}

describe('§Multi-dépôts — lectures produit : une seule ligne, stock consolidé', () => {
  beforeEach(() => {
    cleanup();
    seedProduct({ id: PRODUCT_ID, reference: PRODUCT_REF, designation: 'Produit consolidé', barcode: PRODUCT_BARCODE });
    createWarehouse('w1', 'Dépôt 1', 1);
    createWarehouse('w2', 'Dépôt 2');
    // 10 dans w1 + 4 dans w2 = 14 consolidé.
    stockIn(PRODUCT_ID, 10, 'w1');
    stockIn(PRODUCT_ID, 4, 'w2');
  });
  afterEach(cleanup);

  it('la recherche ne renvoie le produit qu\'UNE SEULE FOIS (plus de clé React dupliquée)', () => {
    const rows = ProductRepository.search('');
    const occurrences = rows.filter(p => p.id === PRODUCT_ID);

    expect(occurrences).toHaveLength(1);
    // Aucun doublon d'identifiant, quel que soit le produit.
    expect(new Set(rows.map(p => p.id)).size).toBe(rows.length);
  });

  it('renvoie le stock CONSOLIDÉ (somme des dépôts), pas celui d\'un seul dépôt', () => {
    expect(ProductRepository.findById(PRODUCT_ID)?.current_stock).toBe(14);
    expect(ProductRepository.search('')[0].current_stock).toBe(14);
  });

  it('consolide aussi la recherche par référence et par code-barres', () => {
    expect(ProductRepository.findByReference(PRODUCT_REF)?.current_stock).toBe(14);
    expect(ProductRepository.findByBarcode(PRODUCT_BARCODE)?.current_stock).toBe(14);
  });

  it('la pagination compte des produits DISTINCTS (LIMIT/OFFSET fiables)', () => {
    seedProduct({ id: SECOND_ID, reference: SECOND_REF, designation: 'ZZZ Produit suivant' });

    const firstPage = ProductRepository.search('', 1, 0);
    expect(firstPage).toHaveLength(1);

    // La seconde page doit renvoyer un AUTRE produit, jamais le doublon du premier.
    const secondPage = ProductRepository.search('', 1, 1);
    expect(secondPage).toHaveLength(1);
    expect(secondPage[0].id).not.toBe(firstPage[0].id);
  });

  it('les alertes de stock bas (vue consolidée) ne dupliquent aucun produit et comparent au stock TOTAL', () => {
    // Seuil 20 : le consolidé (14) est sous le seuil, mais AUCUN dépôt pris
    // isolément ne l'était « deux fois ».
    db.prepare('UPDATE products SET min_stock = 20 WHERE id = ?').run(PRODUCT_ID);

    const alerts = DashboardRepository.getLowStockAlerts();
    const forProduct = alerts.filter(a => a.id === PRODUCT_ID);

    expect(forProduct).toHaveLength(1);
    expect(forProduct[0].current_stock).toBe(14);
    expect(new Set(alerts.map(a => a.id)).size).toBe(alerts.length);
    expect(DashboardRepository.getAlertSummary().low_stock_count).toBe(1);
  });

  it('un produit au-dessus du seuil en consolidé n\'est PAS signalé (le seuil compare le total)', () => {
    // 14 consolidé > seuil 5 → aucune alerte, alors qu'un raisonnement par dépôt
    // sur données partielles aurait pu en produire.
    db.prepare('UPDATE products SET min_stock = 5 WHERE id = ?').run(PRODUCT_ID);
    expect(DashboardRepository.getLowStockAlerts()).toHaveLength(0);
  });

  it('le filtre PAR DÉPÔT reste exact (une alerte par dépôt concerné)', () => {
    db.prepare('UPDATE products SET min_stock = 20 WHERE id = ?').run(PRODUCT_ID);

    // w1 = 10 (< 20) → alerte ; w2 = 4 (< 20) → alerte. Chacune une seule fois.
    expect(DashboardRepository.getLowStockAlerts('w1')).toHaveLength(1);
    expect(DashboardRepository.getLowStockAlerts('w2')).toHaveLength(1);
    expect(DashboardRepository.getLowStockAlerts('w1')[0].current_stock).toBe(10);
    expect(DashboardRepository.getLowStockAlerts('w2')[0].current_stock).toBe(4);
  });

  it('un produit sans AUCUN mouvement reste listé une seule fois, à 0', () => {
    seedProduct({ id: SECOND_ID, reference: SECOND_REF, designation: 'Produit jamais entré' });

    const rows = ProductRepository.search('');
    const occurrences = rows.filter(p => p.id === SECOND_ID);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].current_stock).toBe(0);
  });
});
