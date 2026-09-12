import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { classifyStock, StockAlertService } from '../src/services/StockAlertService';
import type { StockThresholdRow } from '../src/repositories/StockAlertRepository';
import { ProductService } from '../src/services/ProductService';
import type { ProductInput } from '../src/repositories/ProductRepository';
import { StockService } from '../src/services/StockService';

/**
 * §Phase 15 — Alertes de stock intelligentes + suggestion de commande.
 *
 *   Rupture        current <= 0
 *   Critique       current <= min_stock
 *   Surstock       max_stock > 0 ET current > max_stock
 *   Normal         sinon
 *
 * La suggestion de commande est une INDICATION, jamais un achat automatique.
 */

function row(current: number, min: number, max: number): StockThresholdRow {
  return {
    product_id: 'p1',
    reference: 'REF-1',
    designation: 'Produit test',
    current_stock: current,
    min_stock: min,
    max_stock: max,
  };
}

describe('§Phase 15 — Classification du stock (règles pures)', () => {
  it('stock nul ou négatif → rupture', () => {
    expect(classifyStock(row(0, 30, 100)).status).toBe('OUT_OF_STOCK');
    expect(classifyStock(row(-5, 30, 100)).status).toBe('OUT_OF_STOCK');
  });

  it('exemple du cahier des charges : 15 / min 30 / max 100 → critique, commande 85', () => {
    const item = classifyStock(row(15, 30, 100));
    expect(item.status).toBe('CRITICAL');
    expect(item.suggestedOrder).toBe(85);
  });

  it('stock égal au minimum → critique (seuil inclusif)', () => {
    expect(classifyStock(row(30, 30, 100)).status).toBe('CRITICAL');
  });

  it('stock juste au-dessus du minimum → normal, aucune commande suggérée', () => {
    const item = classifyStock(row(31, 30, 100));
    expect(item.status).toBe('NORMAL');
    expect(item.suggestedOrder).toBe(0);
  });

  it('stock au-dessus du maximum → surstock, aucune commande', () => {
    const item = classifyStock(row(150, 30, 100));
    expect(item.status).toBe('OVERSTOCK');
    expect(item.suggestedOrder).toBe(0);
  });

  it('sans maximum défini, la suggestion remonte au minimum', () => {
    const item = classifyStock(row(5, 30, 0));
    expect(item.status).toBe('CRITICAL');
    expect(item.suggestedOrder).toBe(25); // 30 − 5
  });

  it('sans maximum ni minimum exploitables, la suggestion ne devient jamais négative', () => {
    expect(classifyStock(row(0, 0, 0)).suggestedOrder).toBe(0);
  });

  it('une rupture avec maximum défini commande de quoi remplir le maximum', () => {
    expect(classifyStock(row(0, 10, 40)).suggestedOrder).toBe(40);
  });
});

describe('§Phase 15 — Synthèse sur données réelles', () => {
  beforeEach(() => {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
      DELETE FROM stock_movements;
      DELETE FROM inventory_balances;
      DELETE FROM products;
      DELETE FROM audit_logs;
    `);
    db.exec('PRAGMA foreign_keys = ON;');
  });

  let seq = 0;
  function makeProduct(minStock: number, maxStock: number, initialStock: number): string {
    seq += 1;
    const input: ProductInput = {
      reference: `ALERT-${seq}`,
      designation: `Produit alerte ${seq}`,
      purchase_price: 10,
      selling_price: 20,
      wholesale_price: 18,
      min_stock: minStock,
      max_stock: maxStock,
      unit: 'PIÈCE',
      vat_rate: 0,
      status: 'ACTIVE',
    };
    const id = ProductService.createProduct(input).id;
    if (initialStock > 0) {
      StockService.addStockEntry({ product_id: id, quantity: initialStock, unit_price: 10 });
    }
    return id;
  }

  it('compte chaque catégorie et trie les suggestions par quantité décroissante', () => {
    makeProduct(30, 100, 15); // critique → 85
    makeProduct(10, 40, 0);   // rupture  → 40
    makeProduct(5, 0, 50);    // normal
    makeProduct(10, 20, 99);  // surstock

    const summary = StockAlertService.getStatus();
    expect(summary.critical).toBe(1);
    expect(summary.outOfStock).toBe(1);
    expect(summary.normal).toBe(1);
    expect(summary.overstock).toBe(1);

    const suggestions = summary.restockSuggestions;
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].suggestedOrder).toBe(85); // trié décroissant
    expect(suggestions[1].suggestedOrder).toBe(40);
  });

  it('un stock normal ou en surstock ne produit jamais de suggestion de commande', () => {
    makeProduct(5, 0, 50);
    makeProduct(10, 20, 99);

    const summary = StockAlertService.getStatus();
    expect(summary.restockSuggestions).toHaveLength(0);
  });

  it('les produits archivés sont exclus du classement', () => {
    const id = makeProduct(30, 100, 0);
    ProductService.archiveProduct(id);

    const summary = StockAlertService.getStatus();
    expect(summary.items.some(i => i.product_id === id)).toBe(false);
  });
});
