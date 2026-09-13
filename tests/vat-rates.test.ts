import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/database/config/connection';
import {
  VAT_PRESET_RATES,
  DEFAULT_VAT_RATE,
  roundVatRate,
  parseVatRate,
  isPresetVatRate,
  describeVatRate,
  formatVatRate,
  normalizeVatRates,
  parseVatRates,
  buildVatRateCatalog,
} from '../src/domain/tax/vatRates';
import { calculateLineAmounts } from '../src/utils/money';
import { CategoryRepository } from '../src/repositories/CategoryRepository';
import { TaxRepository } from '../src/repositories/TaxRepository';
import { TaxService, monthRange, yearRange } from '../src/services/TaxService';
import { GlobalSettingsService } from '../src/services/GlobalSettingsService';
import { PurchaseOrderRepository } from '../src/repositories/PurchaseOrderRepository';
import { todayDateOnly } from '../src/utils/date';

/**
 * §TVA — Taux de TVA, résolution produit → catégorie → défaut, TVA sur achats
 * et rapport fiscal (TVA collectée / déductible / nette).
 *
 * Ces tests verrouillent les trois propriétés qui rendent la TVA exploitable :
 *   1. le CATALOGUE (taux légaux marocains toujours proposés + taux libres) ;
 *   2. la RÉSOLUTION (un taux de produit à 0 ne disparaît pas derrière un défaut) ;
 *   3. l'AGRÉGATION (collectée − déductible, avoirs déduits, annulés exclus).
 */

// ─── Jeu de données ──────────────────────────────────────────────────────────

/** Insère un produit minimal (les colonnes NOT NULL sont renseignées). */
function insertProduct(opts: {
  id: string;
  reference: string;
  vatRate: number;
  inherit?: number;
  categoryId?: string | null;
}): void {
  db.prepare(`
    INSERT INTO products
      (id, reference, designation, purchase_price, selling_price, wholesale_price,
       min_stock, vat_rate, vat_inherit_from_category, category_id, status)
    VALUES (?, ?, ?, 10, 20, 15, 0, ?, ?, ?, 'ACTIVE')
  `).run(
    opts.id,
    opts.reference,
    `Produit ${opts.reference}`,
    opts.vatRate,
    opts.inherit ?? 0,
    opts.categoryId ?? null,
  );
}

function insertSupplier(id: string, name: string): void {
  db.prepare('INSERT INTO suppliers (id, name, status) VALUES (?, ?, \'ACTIVE\')').run(id, name);
}

/** Insère un document de vente avec des lignes (aucun service métier requis). */
function insertDocument(opts: {
  id: string;
  number: string;
  type: 'INVOICE' | 'DELIVERY_NOTE' | 'CREDIT_NOTE';
  status?: string;
  exclTax: number;
  tax: number;
  date: string;
  lines: Array<{ productId: string; quantity: number; total: number; vatRate: number }>;
}): void {
  const inclTax = opts.exclTax + opts.tax;
  db.prepare(`
    INSERT INTO documents
      (id, type, document_number, entity_id, date, total_excl_tax, total_tax, total_incl_tax, status)
    VALUES (?, ?, ?, '', ?, ?, ?, ?, ?)
  `).run(opts.id, opts.type, opts.number, opts.date, opts.exclTax, opts.tax, inclTax, opts.status ?? 'UNPAID');

  for (const line of opts.lines) {
    db.prepare(`
      INSERT INTO document_items (id, document_id, product_id, quantity, unit_price, total, vat_rate)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), opts.id, line.productId, line.quantity, line.total / line.quantity, line.total, line.vatRate);
  }
}

/**
 * Purge tout ce que ces tests écrivent (ordre imposé par les FK).
 *
 * Les MOUVEMENTS DE STOCK et la BALANCE doivent partir avant les produits :
 * `stock_movements.product_id` est en ON DELETE RESTRICT, donc une réception
 * (qui crée un PURCHASE_IN) bloquerait la suppression du produit.
 *
 * Sûr ici : `vitest.config.ts` utilise `pool: 'forks'`, chaque fichier de test
 * s'exécute donc dans son propre processus avec SA propre base temporaire
 * (tests/setup.ts) — aucun autre fichier de test n'est affecté.
 */
function purgeAll(): void {
  db.prepare('DELETE FROM purchase_order_items').run();
  db.prepare('DELETE FROM purchase_orders').run();
  db.prepare('DELETE FROM document_items').run();
  db.prepare('DELETE FROM documents').run();
  db.prepare('DELETE FROM stock_movements').run();
  db.prepare('DELETE FROM inventory_balances').run();
  db.prepare('DELETE FROM products').run();
  db.prepare('DELETE FROM categories').run();
  db.prepare('DELETE FROM suppliers').run();
}

describe('§TVA — catalogue des taux (domaine pur)', () => {
  it('propose TOUJOURS les 5 taux légaux marocains', () => {
    expect([...VAT_PRESET_RATES]).toEqual([0, 7, 10, 14, 20]);
    expect(DEFAULT_VAT_RATE).toBe(20);
  });

  it('formate un taux pour l\'affichage (0 = « Exonéré », virgule décimale)', () => {
    expect(formatVatRate(0)).toBe('Exonéré');
    expect(formatVatRate(20)).toBe('20 %');
    expect(formatVatRate(7)).toBe('7 %');
    expect(formatVatRate(5.5)).toBe('5,5 %');
  });

  it('arrondit un taux à 2 décimales sans perdre les demis', () => {
    expect(roundVatRate(5.555)).toBe(5.56);
    expect(roundVatRate(5.5)).toBe(5.5);
    expect(roundVatRate(20.000000001)).toBe(20);
  });

  it('REFUSE un taux non numérique, négatif ou supérieur à 100 %', () => {
    expect(() => parseVatRate('abc')).toThrow(/numérique/i);
    expect(() => parseVatRate(-1)).toThrow(/négatif/i);
    expect(() => parseVatRate(101)).toThrow(/100/);
    expect(() => parseVatRate(Infinity)).toThrow(/numérique/i);
  });

  it('accepte et normalise un taux valide', () => {
    expect(parseVatRate(20)).toBe(20);
    expect(parseVatRate('7')).toBe(7);
    expect(parseVatRate(5.555)).toBe(5.56);
  });

  it('identifie les taux légaux', () => {
    expect(isPresetVatRate(20)).toBe(true);
    expect(isPresetVatRate(0)).toBe(true);
    expect(isPresetVatRate(5.5)).toBe(false);
  });

  it('marque un taux hors barème comme personnalisé', () => {
    const custom = describeVatRate(5.5);
    expect(custom.isPreset).toBe(false);
    expect(custom.shortLabel).toBe('5,5 %');
    expect(custom.label).toContain('personnalisé');

    const preset = describeVatRate(20);
    expect(preset.isPreset).toBe(true);
    expect(preset.label).toContain('normal');
  });

  it('normalise une liste saisie : doublons supprimés, valeurs invalides ignorées, tri croissant, presets CONSERVÉS', () => {
    const result = normalizeVatRates([20, 5.5, '5.5', -3, 200, 'x', 0, 14]);
    expect(result).toEqual([0, 5.5, 7, 10, 14, 20]);
  });

  it('retombe sur les taux légaux si la valeur stockée est vide ou illisible', () => {
    expect(parseVatRates(null)).toEqual([0, 7, 10, 14, 20]);
    expect(parseVatRates('{pas du json')).toEqual([0, 7, 10, 14, 20]);
    expect(parseVatRates('[]')).toEqual([0, 7, 10, 14, 20]);
    expect(parseVatRates('[15]')).toEqual([0, 7, 10, 14, 15, 20]);
  });

  it('construit le catalogue complet prêt pour l\'UI', () => {
    const catalog = buildVatRateCatalog([15]);
    const rates = catalog.map(c => c.rate);
    expect(rates).toEqual([0, 7, 10, 14, 15, 20]);
    expect(catalog.find(c => c.rate === 15)?.isPreset).toBe(false);
    expect(catalog.find(c => c.rate === 0)?.shortLabel).toBe('Exonéré');
  });
});

describe('§TVA — calcul des montants de ligne (money)', () => {
  it('calcule la TVA au taux normal (20 %)', () => {
    const amounts = calculateLineAmounts({ quantity: 1, unitPrice: 100, vatRate: 20 });
    expect(amounts.exclTax).toBe(100);
    expect(amounts.tax).toBe(20);
    expect(amounts.inclTax).toBe(120);
  });

  it('n\'applique aucune TVA sur un produit exonéré (0 %)', () => {
    const amounts = calculateLineAmounts({ quantity: 3, unitPrice: 50, vatRate: 0 });
    expect(amounts.exclTax).toBe(150);
    expect(amounts.tax).toBe(0);
    expect(amounts.inclTax).toBe(150);
  });

  it('applique les taux réduits (7 / 10 / 14 %)', () => {
    expect(calculateLineAmounts({ quantity: 1, unitPrice: 1000, vatRate: 7 }).tax).toBe(70);
    expect(calculateLineAmounts({ quantity: 1, unitPrice: 1000, vatRate: 10 }).tax).toBe(100);
    expect(calculateLineAmounts({ quantity: 1, unitPrice: 1000, vatRate: 14 }).tax).toBe(140);
  });

  it('arrondit correctement la TVA au centime', () => {
    // 33.33 × 20 % = 6.666 → 6.67 (et non 6.66).
    const amounts = calculateLineAmounts({ quantity: 1, unitPrice: 33.33, vatRate: 20 });
    expect(amounts.exclTax).toBe(33.33);
    expect(amounts.tax).toBe(6.67);
    expect(amounts.inclTax).toBe(40);
  });

  it('calcule la TVA APRÈS la remise (base hors taxe remisée)', () => {
    const amounts = calculateLineAmounts({ quantity: 2, unitPrice: 100, discountPct: 10, vatRate: 20 });
    expect(amounts.exclTax).toBe(180);
    expect(amounts.tax).toBe(36);
    expect(amounts.inclTax).toBe(216);
    expect(amounts.discount).toBe(20);
  });
});
describe('§TVA — résolution du taux applicable (produit → catégorie → défaut)', () => {
  beforeEach(purgeAll);
  afterEach(purgeAll);

  it('utilise le taux PROPRE du produit', () => {
    const productId = randomUUID();
    insertProduct({ id: productId, reference: 'P-7', vatRate: 7 });
    expect(TaxService.resolveRate(productId)).toBe(7);
  });

  it('respecte un taux de produit à 0 : « exonéré » est une VALEUR, pas une absence', () => {
    const productId = randomUUID();
    insertProduct({ id: productId, reference: 'P-EXO', vatRate: 0 });
    // Ne doit JAMAIS retomber sur 20 % : la vente serait fiscalement fausse.
    expect(TaxService.resolveRate(productId)).toBe(0);
  });

  it('hérite du taux de la CATÉGORIE quand le produit le demande', () => {
    const category = CategoryRepository.create({ name: `Cat-${randomUUID()}`, vat_rate: 10 });
    const productId = randomUUID();
    insertProduct({ id: productId, reference: 'P-HERIT', vatRate: 20, inherit: 1, categoryId: category.id });

    // Le taux propre (20) est IGNORÉ au profit de celui de la catégorie (10).
    expect(TaxService.resolveRate(productId)).toBe(10);
  });

  it('retombe sur le taux par défaut si la catégorie héritée ne définit aucun taux', () => {
    const previousDefault = GlobalSettingsService.getAll().default_vat_rate;
    GlobalSettingsService.save({ default_vat_rate: 14 });

    try {
      const category = CategoryRepository.create({ name: `Cat-sans-taux-${randomUUID()}` });
      const productId = randomUUID();
      insertProduct({ id: productId, reference: 'P-DEF', vatRate: 20, inherit: 1, categoryId: category.id });
      expect(TaxService.resolveRate(productId)).toBe(14);
    } finally {
      GlobalSettingsService.save({ default_vat_rate: previousDefault });
    }
  });

  it('retombe sur le taux par défaut pour un produit sans catégorie qui demande l\'héritage', () => {
    const productId = randomUUID();
    insertProduct({ id: productId, reference: 'P-ORPH', vatRate: 20, inherit: 1, categoryId: null });
    expect(TaxService.resolveRate(productId)).toBe(GlobalSettingsService.getAll().default_vat_rate);
  });

  it('le taux d\'un produit NON hérité prime sur celui de sa catégorie', () => {
    const category = CategoryRepository.create({ name: `Cat-prime-${randomUUID()}`, vat_rate: 10 });
    const productId = randomUUID();
    insertProduct({ id: productId, reference: 'P-PRIME', vatRate: 7, inherit: 0, categoryId: category.id });
    expect(TaxService.resolveRate(productId)).toBe(7);
  });

  it('expose le taux propre du produit ET son indicateur d\'héritage', () => {
    const productId = randomUUID();
    insertProduct({ id: productId, reference: 'P-INFO', vatRate: 14, inherit: 1 });

    const info = TaxRepository.getProductVat(productId);
    expect(info).toEqual({ vat_rate: 14, inheritFromCategory: true });

    // Produit inexistant → null (jamais une valeur par défaut silencieuse).
    expect(TaxRepository.getProductVat('inexistant')).toBeNull();
  });

  it('expose le taux de catégorie, modifiable et effaçable', () => {
    const category = CategoryRepository.create({ name: `Cat-crud-${randomUUID()}` });
    expect(CategoryRepository.getVatRate(category.id)).toBeNull();

    CategoryRepository.setVatRate(category.id, 14);
    expect(CategoryRepository.getVatRate(category.id)).toBe(14);

    CategoryRepository.setVatRate(category.id, null);
    expect(CategoryRepository.getVatRate(category.id)).toBeNull();
  });
});

describe('§TVA — catalogue persistant (Paramètres)', () => {
  it('ajoute un taux personnalisé, refuse les doublons, puis le supprime', () => {
    const previous = TaxService.getRates();
    try {
      const added = TaxService.addRate(5.5);
      expect(added).toContain(5.5);

      // Idempotent : un second ajout ne duplique pas.
      expect(TaxService.addRate(5.5).filter(r => r === 5.5)).toHaveLength(1);

      const removed = TaxService.removeRate(5.5);
      expect(removed).not.toContain(5.5);
      // Les taux légaux restent tous proposés après retrait.
      expect(removed).toEqual([0, 7, 10, 14, 20]);
    } finally {
      GlobalSettingsService.save({ vat_rates: previous });
    }
  });

  it('REFUSE la suppression d\'un taux légal marocain', () => {
    expect(() => TaxService.removeRate(7)).toThrow(/légal/i);
    expect(TaxService.getRates()).toContain(7);
  });

  it('valide le taux avant de l\'ajouter', () => {
    expect(() => TaxService.addRate(150)).toThrow(/100/);
    expect(TaxService.getRates()).not.toContain(150);
  });
});

describe('§TVA — TVA sur les achats (TVA déductible)', () => {
  beforeEach(purgeAll);
  afterEach(purgeAll);

  it('décompose une commande : HT, TVA et TTC, avec le taux FIGÉ sur la ligne', () => {
    const supplierId = randomUUID();
    insertSupplier(supplierId, 'Fournisseur TVA');
    const productId = randomUUID();
    insertProduct({ id: productId, reference: 'A-20', vatRate: 20 });

    const order = PurchaseOrderRepository.create({
      supplier_id: supplierId,
      items: [{ product_id: productId, quantity: 2, unit_price: 100 }],
    });

    expect(order.total).toBe(200);
    expect(order.total_excl_tax).toBe(200);
    expect(order.total_tax).toBe(40);
    expect(order.total_incl_tax).toBe(240);
    expect(order.items?.[0].vat_rate).toBe(20);
  });

  it('applique le taux réduit du produit sur la commande', () => {
    const supplierId = randomUUID();
    insertSupplier(supplierId, 'Fournisseur 7%');
    const productId = randomUUID();
    insertProduct({ id: productId, reference: 'A-07', vatRate: 7 });

    const order = PurchaseOrderRepository.create({
      supplier_id: supplierId,
      items: [{ product_id: productId, quantity: 1, unit_price: 1000 }],
    });

    expect(order.total).toBe(1000);
    expect(order.total_tax).toBe(70);
    expect(order.total_incl_tax).toBe(1070);
  });

  it('n\'applique aucune TVA sur un achat exonéré', () => {
    const supplierId = randomUUID();
    insertSupplier(supplierId, 'Fournisseur exonéré');
    const productId = randomUUID();
    insertProduct({ id: productId, reference: 'A-EXO', vatRate: 0 });

    const order = PurchaseOrderRepository.create({
      supplier_id: supplierId,
      items: [{ product_id: productId, quantity: 5, unit_price: 20 }],
    });

    expect(order.total_excl_tax).toBe(100);
    expect(order.total_tax).toBe(0);
    expect(order.total_incl_tax).toBe(100);
  });

  it('recalcule la TVA sur les quantités RÉELLEMENT reçues (réception partielle)', () => {
    const supplierId = randomUUID();
    insertSupplier(supplierId, 'Fournisseur réception');
    const productId = randomUUID();
    insertProduct({ id: productId, reference: 'A-REC', vatRate: 20 });

    const order = PurchaseOrderRepository.create({
      supplier_id: supplierId,
      items: [{ product_id: productId, quantity: 10, unit_price: 100 }],
    });
    PurchaseOrderRepository.confirm(order.id);

    const itemId = order.items![0].id;
    const received = PurchaseOrderRepository.receive(order.id, [{ item_id: itemId, received_qty: 4 }]);

    // Seuls 4 articles sont entrés : la TVA déductible ne porte QUE sur eux.
    expect(received.status).toBe('CONFIRMED');
    expect(received.total_excl_tax).toBe(400);
    expect(received.total_tax).toBe(80);
    expect(received.total_incl_tax).toBe(480);
  });
});

describe('§TVA — rapport fiscal (collectée, déductible, nette)', () => {
  beforeEach(purgeAll);
  afterEach(purgeAll);

  it('agrège ventes et achats d\'une période et calcule la TVA nette', () => {
    const productId = randomUUID();
    insertProduct({ id: productId, reference: 'R-20', vatRate: 20 });
    const supplierId = randomUUID();
    insertSupplier(supplierId, 'Fournisseur rapport');
    // Date métier LOCALE (jamais UTC) : le rapport filtre sur le calendrier.
    const date = todayDateOnly();

    // Vente facturée : 1000 HT / 200 TVA.
    insertDocument({
      id: randomUUID(), number: `F-${randomUUID()}`, type: 'INVOICE',
      exclTax: 1000, tax: 200, date,
      lines: [{ productId, quantity: 10, total: 1000, vatRate: 20 }],
    });
    // Avoir (retour) : −100 HT / −20 TVA → vient en DÉDUCTION des ventes.
    insertDocument({
      id: randomUUID(), number: `AV-${randomUUID()}`, type: 'CREDIT_NOTE',
      exclTax: -100, tax: -20, date,
      lines: [{ productId, quantity: 1, total: -100, vatRate: 20 }],
    });
    // Document ANNULÉ : doit être totalement ignoré.
    insertDocument({
      id: randomUUID(), number: `FX-${randomUUID()}`, type: 'INVOICE', status: 'CANCELLED',
      exclTax: 5000, tax: 1000, date,
      lines: [{ productId, quantity: 1, total: 5000, vatRate: 20 }],
    });
    // Achat : 500 HT / 100 TVA déductible.
    db.prepare(`
      INSERT INTO purchase_orders
        (id, order_number, supplier_id, date, status, total, total_excl_tax, total_tax, total_incl_tax)
      VALUES (?, ?, ?, ?, 'RECEIVED', 500, 500, 100, 600)
    `).run(randomUUID(), `PA-${randomUUID()}`, supplierId, date);

    const report = TaxService.getReportForRange(date, date);

    expect(report.sales.exclTax).toBe(900);
    expect(report.sales.tax).toBe(180);
    expect(report.sales.inclTax).toBe(1080);
    expect(report.sales.count).toBe(2);

    expect(report.purchases.exclTax).toBe(500);
    expect(report.purchases.tax).toBe(100);
    expect(report.purchases.inclTax).toBe(600);
    expect(report.purchases.count).toBe(1);

    // TVA nette = collectée (180) − déductible (100).
    expect(report.netVat).toBe(80);

    // Ventilation par taux : une seule tranche, à 20 %.
    expect(report.salesByRate).toEqual([{ rate: 20, exclTax: 900, tax: 180 }]);
    expect(report.purchasesByRate).toEqual([]);
  });

  it('exclut les documents hors période', () => {
    const productId = randomUUID();
    insertProduct({ id: productId, reference: 'R-HORS', vatRate: 20 });

    insertDocument({
      id: randomUUID(), number: `F-${randomUUID()}`, type: 'INVOICE',
      exclTax: 1000, tax: 200, date: '2020-06-15',
      lines: [{ productId, quantity: 1, total: 1000, vatRate: 20 }],
    });

    const report = TaxService.getReportForRange('2026-01-01', '2026-12-31');
    expect(report.sales.count).toBe(0);
    expect(report.sales.tax).toBe(0);
    expect(report.netVat).toBe(0);
  });

  it('renvoie un rapport VIDE (et non une erreur) quand la période n\'a aucun mouvement', () => {
    const report = TaxService.getReportForRange('1999-01-01', '1999-12-31');
    expect(report.sales).toEqual({ exclTax: 0, tax: 0, inclTax: 0, count: 0 });
    expect(report.purchases).toEqual({ exclTax: 0, tax: 0, inclTax: 0, count: 0 });
    expect(report.netVat).toBe(0);
    expect(report.salesByRate).toEqual([]);
  });

  it('CONSERVE un crédit de TVA négatif (jamais ramené à 0)', () => {
    const productId = randomUUID();
    insertProduct({ id: productId, reference: 'R-CREDIT', vatRate: 20 });
    const supplierId = randomUUID();
    insertSupplier(supplierId, 'Fournisseur crédit');

    db.prepare(`
      INSERT INTO purchase_orders
        (id, order_number, supplier_id, date, status, total, total_excl_tax, total_tax, total_incl_tax)
      VALUES (?, ?, ?, '2026-03-10', 'RECEIVED', 1000, 1000, 200, 1200)
    `).run(randomUUID(), `PA-${randomUUID()}`, supplierId);

    const report = TaxService.getReportForRange('2026-03-01', '2026-03-31');
    // Aucune vente, 200 de TVA déductible → crédit de 200 (négatif).
    expect(report.netVat).toBe(-200);
  });

  it('EXCLUT les commandes en brouillon : la TVA n\'est déductible que sur une marchandise reçue', () => {
    const supplierId = randomUUID();
    insertSupplier(supplierId, 'Fournisseur brouillon');

    // Commande simplement SAISIE (DRAFT) : jamais reçue → TVA non déductible.
    db.prepare(`
      INSERT INTO purchase_orders
        (id, order_number, supplier_id, date, status, total, total_excl_tax, total_tax, total_incl_tax)
      VALUES (?, ?, ?, '2026-04-05', 'DRAFT', 1000, 1000, 200, 1200)
    `).run(randomUUID(), `PA-${randomUUID()}`, supplierId);

    const report = TaxService.getReportForRange('2026-04-01', '2026-04-30');
    expect(report.purchases.count).toBe(0);
    expect(report.purchases.tax).toBe(0);
    expect(report.netVat).toBe(0);
  });

  it('INCLUT une commande partiellement reçue, à hauteur de ce qui est réellement entré', () => {
    const supplierId = randomUUID();
    insertSupplier(supplierId, 'Fournisseur partiel');
    const productId = randomUUID();
    insertProduct({ id: productId, reference: 'R-PARTIEL', vatRate: 20 });

    // Commande de 10 × 100 (TVA théorique 200), puis réception de 4 seulement.
    const order = PurchaseOrderRepository.create({
      supplier_id: supplierId,
      items: [{ product_id: productId, quantity: 10, unit_price: 100 }],
    });
    PurchaseOrderRepository.confirm(order.id);
    PurchaseOrderRepository.receive(order.id, [{ item_id: order.items![0].id, received_qty: 4 }]);

    const date = todayDateOnly();
    const report = TaxService.getReportForRange(date, date);

    // Seule la part reçue (400 HT / 80 TVA) est déductible.
    expect(report.purchases.count).toBe(1);
    expect(report.purchases.exclTax).toBe(400);
    expect(report.purchases.tax).toBe(80);
    expect(report.purchasesByRate).toEqual([{ rate: 20, exclTax: 400, tax: 80 }]);
  });
});

describe('§TVA — bornes de période (mois / année)', () => {
  it('calcule le premier et le dernier jour d\'un mois', () => {
    expect(monthRange('2026-01')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    // Année bissextile : février compte 29 jours.
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthRange('2026-04')).toEqual({ from: '2026-04-01', to: '2026-04-30' });
  });

  it('REFUSE un mois mal formé ou hors bornes', () => {
    expect(() => monthRange('2026-1')).toThrow(/invalide/i);
    expect(() => monthRange('2026-13')).toThrow(/invalide/i);
    expect(() => monthRange('janvier')).toThrow(/invalide/i);
  });

  it('calcule les bornes d\'une année civile et refuse une année invalide', () => {
    expect(yearRange(2026)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(() => yearRange(1800)).toThrow(/invalide/i);
  });

  it('getReportForMonth / getReportForYear utilisent les bonnes bornes', () => {
    const monthly = TaxService.getReportForMonth('2026-02');
    expect(monthly.from).toBe('2026-02-01');
    expect(monthly.to).toBe('2026-02-28');

    const yearly = TaxService.getReportForYear(2026);
    expect(yearly.from).toBe('2026-01-01');
    expect(yearly.to).toBe('2026-12-31');
  });
});
