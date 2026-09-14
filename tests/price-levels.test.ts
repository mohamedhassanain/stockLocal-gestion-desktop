import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/database/config/connection';
import {
  resolvePrice,
  normalizePriceLevel,
  describePriceLevel,
  isKnownPriceLevel,
  PRICE_LEVELS,
  DEFAULT_PRICE_LEVEL,
} from '../src/domain/pricing/priceLevels';
import { PricingService } from '../src/services/PricingService';
import { VolumeDiscountRepository } from '../src/repositories/VolumeDiscountRepository';

/**
 * §B3 — Niveaux de prix clients.
 *
 * Priorité vérifiée : prix spécifique client > prix du niveau > remise quantité
 * (volume_discounts) > prix standard. La règle pure est testée isolément, puis
 * l'orchestration `PricingService` est testée contre la base réelle.
 */

const P = 'TEST_PL_';

function purge(): void {
  db.prepare(`DELETE FROM customer_prices WHERE customer_id LIKE '${P}%' OR product_id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM product_price_levels WHERE product_id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM document_items WHERE product_id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM documents WHERE id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM customers WHERE id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM products WHERE id LIKE '${P}%'`).run();
  db.prepare('DELETE FROM volume_discounts').run();
}

function seedProduct(sellingPrice = 100): string {
  const id = `${P}prod-${randomUUID()}`;
  db.prepare(`
    INSERT INTO products
      (id, reference, designation, purchase_price, selling_price, wholesale_price,
       min_stock, vat_rate, vat_inherit_from_category, category_id, status)
    VALUES (?, ?, 'Produit B3', 50, ?, ?, 0, 20, 0, NULL, 'ACTIVE')
  `).run(id, `PL-${id.slice(-6)}`, sellingPrice, sellingPrice);
  return id;
}

function seedCustomer(level?: string): string {
  const id = `${P}cust-${randomUUID()}`;
  if (level) {
    db.prepare('INSERT INTO customers (id, name, price_level) VALUES (?, ?, ?)').run(id, 'Client B3', level);
  } else {
    db.prepare('INSERT INTO customers (id, name) VALUES (?, ?)').run(id, 'Client B3');
  }
  return id;
}

describe('§B3 — résolution de prix (règle pure)', () => {
  it('respecte la priorité : client > niveau > quantité > standard', () => {
    expect(resolvePrice({ standardPrice: 100, customerPrice: 80, levelPrice: 90, level: 'WHOLESALE', volumeDiscountPct: 5 }).source).toBe('CUSTOMER');
    expect(resolvePrice({ standardPrice: 100, levelPrice: 90, level: 'WHOLESALE', volumeDiscountPct: 5 }).source).toBe('LEVEL');
    expect(resolvePrice({ standardPrice: 100, volumeDiscountPct: 5 }).source).toBe('VOLUME');
    expect(resolvePrice({ standardPrice: 100 }).source).toBe('STANDARD');
  });

  it('renvoie le prix, la remise et le motif attendus selon la source', () => {
    const customer = resolvePrice({ standardPrice: 100, customerPrice: 80 });
    expect(customer.unitPrice).toBe(80);
    expect(customer.discountPct).toBe(0);
    expect(customer.reason).toContain('client');

    const level = resolvePrice({ standardPrice: 100, levelPrice: 90, level: 'WHOLESALE' });
    expect(level.unitPrice).toBe(90);
    expect(level.reason).toContain('Grossiste');

    const volume = resolvePrice({ standardPrice: 100, volumeDiscountPct: 12.5 });
    expect(volume.unitPrice).toBe(100);
    expect(volume.discountPct).toBe(12.5);
    expect(volume.reason).toContain('12.5');
  });

  it('borne la remise quantité à [0, 100]', () => {
    // Négative → ignorée (retour au standard).
    expect(resolvePrice({ standardPrice: 100, volumeDiscountPct: -5 }).source).toBe('STANDARD');
    // Supérieure à 100 → plafonnée.
    expect(resolvePrice({ standardPrice: 100, volumeDiscountPct: 150 }).discountPct).toBe(100);
  });

  it('ne confond PAS un prix absent avec un prix à 0', () => {
    const res = resolvePrice({ standardPrice: 100, customerPrice: null, levelPrice: null });
    expect(res.unitPrice).toBe(100);
    expect(res.source).toBe('STANDARD');
  });

  it('normalise et décrit les niveaux de prix', () => {
    expect(normalizePriceLevel('wholesale')).toBe('WHOLESALE');
    expect(normalizePriceLevel(undefined)).toBe(DEFAULT_PRICE_LEVEL);
    expect(normalizePriceLevel('')).toBe(DEFAULT_PRICE_LEVEL);
    expect(describePriceLevel('RETAIL')).toBe('Détail');
    expect(describePriceLevel('VIP')).toBe('VIP');
    // Niveau inconnu → libellé = clé brute (jamais de crash).
    expect(describePriceLevel('AUTRE')).toBe('AUTRE');
    expect(isKnownPriceLevel('vip')).toBe(true);
    expect(isKnownPriceLevel('AUTRE')).toBe(false);
    expect(PRICE_LEVELS.map(l => l.key)).toEqual(['RETAIL', 'WHOLESALE', 'VIP']);
  });
});

describe('§B3 — PricingService (base de données)', () => {
  beforeEach(purge);
  afterEach(purge);

  it('applique le prix STANDARD sans client', () => {
    const productId = seedProduct(100);
    const res = PricingService.resolveProductPrice({ productId });
    expect(res.source).toBe('STANDARD');
    expect(res.unitPrice).toBe(100);
    expect(res.reason).toBe('Prix standard');
  });

  it('applique le prix du NIVEAU du client', () => {
    const productId = seedProduct(100);
    const customerId = seedCustomer('WHOLESALE');
    PricingService.setLevelPrice(productId, 'WHOLESALE', 75);

    const res = PricingService.resolveProductPrice({ productId, customerId });
    expect(res.source).toBe('LEVEL');
    expect(res.unitPrice).toBe(75);
    expect(res.reason).toContain('Grossiste');
  });

  it('le prix SPÉCIFIQUE client prime sur le prix de niveau', () => {
    const productId = seedProduct(100);
    const customerId = seedCustomer('WHOLESALE');
    PricingService.setLevelPrice(productId, 'WHOLESALE', 75);
    PricingService.setCustomerPrice(customerId, productId, 60);

    const res = PricingService.resolveProductPrice({ productId, customerId });
    expect(res.source).toBe('CUSTOMER');
    expect(res.unitPrice).toBe(60);
  });

  it('applique la REMISE QUANTITÉ uniquement en l\'absence de prix négocié', () => {
    const productId = seedProduct(100);
    const customerId = seedCustomer('RETAIL');
    VolumeDiscountRepository.create({ name: 'PL10', min_qty: 10, max_qty: null, discount_pct: 8 });

    const withVolume = PricingService.resolveProductPrice({ productId, customerId, quantity: 10 });
    expect(withVolume.source).toBe('VOLUME');
    expect(withVolume.discountPct).toBe(8);
    expect(withVolume.unitPrice).toBe(100);

    // Dès qu'un prix de niveau existe, la remise quantité ne s'applique plus.
    PricingService.setLevelPrice(productId, 'RETAIL', 95);
    const withLevel = PricingService.resolveProductPrice({ productId, customerId, quantity: 10 });
    expect(withLevel.source).toBe('LEVEL');
    expect(withLevel.discountPct).toBe(0);
    expect(withLevel.unitPrice).toBe(95);
  });

  it('change le niveau d\'un client et le relit (normalisé)', () => {
    const customerId = seedCustomer('RETAIL');
    expect(PricingService.getCustomerLevel(customerId)).toBe('RETAIL');
    expect(PricingService.setCustomerLevel(customerId, 'vip')).toBe('VIP');
    expect(PricingService.getCustomerLevel(customerId)).toBe('VIP');
  });

  it('REFUSE un prix négatif (niveau et prix client)', () => {
    const productId = seedProduct(100);
    const customerId = seedCustomer();
    expect(() => PricingService.setLevelPrice(productId, 'VIP', -1)).toThrow(/positif/i);
    expect(() => PricingService.setCustomerPrice(customerId, productId, -5)).toThrow(/positif/i);
  });

  it('liste puis supprime les prix par niveau d\'un produit', () => {
    const productId = seedProduct(100);
    PricingService.setLevelPrice(productId, 'WHOLESALE', 70);
    PricingService.setLevelPrice(productId, 'VIP', 65);

    const levels = PricingService.listProductLevels(productId);
    expect(levels.map(l => l.level).sort()).toEqual(['VIP', 'WHOLESALE']);

    PricingService.deleteLevelPrice(productId, 'VIP');
    expect(PricingService.listProductLevels(productId).map(l => l.level)).toEqual(['WHOLESALE']);
  });

  it('expose le catalogue des niveaux et le libellé d\'un niveau', () => {
    expect(PricingService.listLevels().map(l => l.key)).toEqual(['RETAIL', 'WHOLESALE', 'VIP']);
    expect(PricingService.describeLevel('WHOLESALE')).toBe('Grossiste');
  });

  it('lève une erreur explicite pour un produit inexistant', () => {
    expect(() => PricingService.resolveProductPrice({ productId: `${P}absent` })).toThrow(/introuvable/i);
  });
});
