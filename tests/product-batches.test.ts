import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/database/config/connection';
import { ProductRepository, type Product } from '../src/repositories/ProductRepository';
import { ProductBatchRepository } from '../src/repositories/ProductBatchRepository';
import { todayDateOnly, addDaysDateOnly, daysBetweenDateOnly } from '../src/utils/date';

/**
 * Phase 3 — Lots / dates d'expiration.
 *
 * Vérifie :
 *  - création de lot (numéro obligatoire, date optionnelle) ;
 *  - alerte d'expiration déclenchée aux bons seuils (7 j / 30 j, déjà expiré) ;
 *  - un produit SANS gestion de lots n'apparaît JAMAIS dans ces alertes.
 */

const P = 'BATCH_';
const productIds: string[] = [];

const isoDays = (n: number): string => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function cleanup(): void {
  if (productIds.length === 0) return;
  const inClause = ` IN (${productIds.map(() => '?').join(',')})`;
  db.prepare(`DELETE FROM product_batches WHERE product_id${inClause}`).run(...productIds);
  db.prepare(`DELETE FROM inventory_balances WHERE product_id${inClause}`).run(...productIds);
  db.prepare(`DELETE FROM stock_movements WHERE product_id${inClause}`).run(...productIds);
  db.prepare(`DELETE FROM products WHERE id${inClause}`).run(...productIds);
  productIds.length = 0;
}

function seedProduct(reference: string, batchManaged: number): Product {
  const id = `${P}${randomUUID().slice(0, 8)}`;
  ProductRepository.create({
    id,
    reference,
    designation: `Produit ${reference}`,
    description: null,
    category_id: null,
    subcategory_id: null,
    barcode: null,
    image_path: null,
    unit: 'PIÈCE',
    purchase_price: 10,
    selling_price: 20,
    wholesale_price: 15,
    min_stock: 0,
    batch_managed: batchManaged,
    status: 'ACTIVE',
  } as Product);
  productIds.push(id);
  return ProductRepository.findById(id)!;
}

describe('Phase 3 — Lots / dates d\'expiration + alertes', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('crée un lot et le liste pour son produit', () => {
    const p = seedProduct('BATCH-A', 1);
    const batch = ProductBatchRepository.create({
      product_id: p.id,
      lot_number: 'LOT-001',
      quantity: 25,
      expiry_date: isoDays(60),
    });

    expect(batch.lot_number).toBe('LOT-001');
    expect(batch.quantity).toBe(25);
    const list = ProductBatchRepository.listByProduct(p.id);
    expect(list).toHaveLength(1);
    expect(list[0].lot_number).toBe('LOT-001');
  });

  it('refuse un numéro de lot vide', () => {
    const p = seedProduct('BATCH-NOLOT', 1);
    expect(() => ProductBatchRepository.create({ product_id: p.id, lot_number: '   ', quantity: 1 }))
      .toThrow(/numéro de lot/i);
  });

  it('déclenche l\'alerte aux bons seuils (7 j / 30 j / expiré)', () => {
    const p = seedProduct('BATCH-THRESH', 1);
    ProductBatchRepository.create({ product_id: p.id, lot_number: 'L3', quantity: 5, expiry_date: isoDays(3) });
    ProductBatchRepository.create({ product_id: p.id, lot_number: 'L10', quantity: 5, expiry_date: isoDays(10) });
    ProductBatchRepository.create({ product_id: p.id, lot_number: 'LPAST', quantity: 5, expiry_date: isoDays(-5) });

    const within7 = ProductBatchRepository.getExpiringBatches(7).map(b => b.lot_number);
    const within30 = ProductBatchRepository.getExpiringBatches(30).map(b => b.lot_number);

    // Seuil 7 jours : L3 (dans 3 j) et LPAST (expiré). PAS L10 (dans 10 j).
    expect(within7).toContain('L3');
    expect(within7).toContain('LPAST');
    expect(within7).not.toContain('L10');

    // Seuil 30 jours : les trois.
    expect(within30).toContain('L3');
    expect(within30).toContain('L10');
    expect(within30).toContain('LPAST');

    // days_left est négatif pour un lot expiré.
    const past = ProductBatchRepository.getExpiringBatches(30).find(b => b.lot_number === 'LPAST');
    expect(past?.days_left).toBeLessThan(0);
  });

  it('n\'alerte JAMAIS un produit sans gestion de lots', () => {
    const plain = seedProduct('BATCH-PLAIN', 0);
    // Même si une ligne de lot existait par erreur, le produit non géré est exclu.
    db.prepare(`INSERT INTO product_batches (id, product_id, lot_number, quantity, expiry_date)
      VALUES (?, ?, ?, ?, ?)`).run(randomUUID(), plain.id, 'GHOST', 10, isoDays(2));

    const expiring = ProductBatchRepository.getExpiringBatches(30);
    expect(expiring.some(b => b.product_id === plain.id)).toBe(false);
  });
});
/**
 * §Phase 2.2 / §Phase 13 — `days_left` est un nombre de JOURS CALENDAIRES.
 *
 * L'ancien calcul SQL (`CAST(julianday(expiry) - julianday('now') AS INTEGER)`)
 * était en UTC et tronquait : un lot expirant « demain » pouvait remonter à 0,
 * et un lot expirant dans 7 jours être exclu du seuil 7. Ces tests verrouillent
 * des valeurs EXACTES, alignées sur le moteur de dates commun.
 */
describe('§Phase 13 — days_left calendaire exact (pas d’UTC, pas de troncature)', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  const today = todayDateOnly;

  it('expire aujourd’hui → 0 jour, présent au seuil 0', () => {
    const p = seedProduct('BATCH-D0', 1);
    ProductBatchRepository.create({ product_id: p.id, lot_number: 'D0', quantity: 1, expiry_date: today() });

    const within0 = ProductBatchRepository.getExpiringBatches(0);
    const lot = within0.find(b => b.lot_number === 'D0');
    expect(lot).toBeDefined();
    expect(lot!.days_left).toBe(0);
  });

  it('expire demain → 1 jour, ABSENT du seuil 0 et PRÉSENT au seuil 1', () => {
    const p = seedProduct('BATCH-D1', 1);
    const tomorrow = addDaysDateOnly(today(), 1)!;
    ProductBatchRepository.create({ product_id: p.id, lot_number: 'D1', quantity: 1, expiry_date: tomorrow });

    const within0 = ProductBatchRepository.getExpiringBatches(0).map(b => b.lot_number);
    const within1 = ProductBatchRepository.getExpiringBatches(1).map(b => b.lot_number);
    expect(within0).not.toContain('D1');
    expect(within1).toContain('D1');

    const lot = ProductBatchRepository.getExpiringBatches(1).find(b => b.lot_number === 'D1');
    expect(lot!.days_left).toBe(1);
  });

  it('expire dans exactement 7 jours → 7 jours, présent au seuil 7 (borne incluse)', () => {
    const p = seedProduct('BATCH-D7', 1);
    const in7 = addDaysDateOnly(today(), 7)!;
    ProductBatchRepository.create({ product_id: p.id, lot_number: 'D7', quantity: 1, expiry_date: in7 });

    const within6 = ProductBatchRepository.getExpiringBatches(6).map(b => b.lot_number);
    const within7 = ProductBatchRepository.getExpiringBatches(7).map(b => b.lot_number);
    expect(within6).not.toContain('D7');
    expect(within7).toContain('D7');

    const lot = ProductBatchRepository.getExpiringBatches(7).find(b => b.lot_number === 'D7');
    expect(lot!.days_left).toBe(7);
  });

  it('expiré hier → -1 jour (et non 0 par troncature)', () => {
    const p = seedProduct('BATCH-DM1', 1);
    const yesterday = addDaysDateOnly(today(), -1)!;
    ProductBatchRepository.create({ product_id: p.id, lot_number: 'DM1', quantity: 1, expiry_date: yesterday });

    const lot = ProductBatchRepository.getExpiringBatches(0).find(b => b.lot_number === 'DM1');
    expect(lot).toBeDefined();
    expect(lot!.days_left).toBe(-1);
  });

  it('days_left correspond EXACTEMENT à daysBetweenDateOnly (source unique)', () => {
    const p = seedProduct('BATCH-CONSIST', 1);
    const expiries = [addDaysDateOnly(today(), -3)!, today(), addDaysDateOnly(today(), 5)!, addDaysDateOnly(today(), 40)!];
    expiries.forEach((date, i) =>
      ProductBatchRepository.create({ product_id: p.id, lot_number: `C${i}`, quantity: 2, expiry_date: date }));

    // Seuil large pour tout ramener, puis comparer chaque valeur au moteur commun.
    const lots = ProductBatchRepository.getExpiringBatches(60);
    for (const lot of lots) {
      expect(lot.days_left).toBe(daysBetweenDateOnly(today(), lot.expiry_date));
    }
  });
});
