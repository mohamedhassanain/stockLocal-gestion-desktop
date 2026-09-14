import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/database/config/connection';
import {
  normalizeCommissionRate,
  calculateCommission,
  COMMISSION_RATE_MAX,
} from '../src/domain/sellers/commission';
import { SellerService } from '../src/services/SellerService';

/**
 * §B4 — Vendeurs / commerciaux (FICHES, pas des comptes utilisateurs).
 *
 * On vérifie la règle de commission (module pur) puis le CRUD et le rapport
 * (CA par vendeur, nombre de ventes, commission calculée) contre la base.
 */

function purge(): void {
  db.prepare('DELETE FROM document_items').run();
  db.prepare('DELETE FROM documents').run();
  db.prepare('DELETE FROM sellers').run();
  db.prepare('DELETE FROM customers').run();
}

/** Insère une vente rattachée à un vendeur (aucun produit ni stock). */
function insertSale(opts: {
  sellerId: string;
  type?: string;
  status?: string;
  total?: number;
  date?: string;
}): void {
  const customerId = randomUUID();
  db.prepare('INSERT INTO customers (id, name) VALUES (?, ?)').run(customerId, 'Client Vendeur');
  db.prepare(`
    INSERT INTO documents
      (id, type, document_number, entity_id, seller_id, date, total_excl_tax, total_tax, total_incl_tax, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    randomUUID(),
    opts.type ?? 'INVOICE',
    `S-${randomUUID().slice(0, 8)}`,
    customerId,
    opts.sellerId,
    opts.date ?? '2026-06-10',
    opts.total ?? 1000,
    opts.total ?? 1000,
    opts.status ?? 'PAID',
  );
}

describe('§B4 — commission (règle pure)', () => {
  it('calcule la commission et l\'arrondit au centime', () => {
    expect(calculateCommission(1000, 5)).toBe(50);
    // 1234.567 × 7.5 % = 92.592525 → 92.59
    expect(calculateCommission(1234.567, 7.5)).toBe(92.59);
  });

  it('renvoie 0 pour un taux nul ou un chiffre d\'affaires nul', () => {
    expect(calculateCommission(5000, 0)).toBe(0);
    expect(calculateCommission(0, 10)).toBe(0);
  });

  it('normalise un taux hors bornes (0 si non numérique, plafonné à 100)', () => {
    expect(normalizeCommissionRate(-10)).toBe(0);
    expect(normalizeCommissionRate(150)).toBe(COMMISSION_RATE_MAX);
    expect(normalizeCommissionRate(NaN)).toBe(0);
    expect(normalizeCommissionRate('abc')).toBe(0);
    expect(calculateCommission(1000, -5)).toBe(0);
  });

  it('accepte un taux saisi en texte', () => {
    expect(normalizeCommissionRate('12.5')).toBe(12.5);
  });
});

describe('§B4 — SellerService (base de données)', () => {
  beforeEach(purge);
  afterEach(purge);

  it('crée un vendeur (nom nettoyé, actif par défaut) et le relit', () => {
    const seller = SellerService.createSeller({ name: '  Ahmed  ', commission_rate: 5 });
    expect(seller.name).toBe('Ahmed');
    expect(seller.active).toBe(1);
    expect(seller.commission_rate).toBe(5);
    expect(SellerService.getSeller(seller.id)?.name).toBe('Ahmed');
  });

  it('REFUSE un vendeur sans nom', () => {
    expect(() => SellerService.createSeller({ name: '   ' })).toThrow(/obligatoire/i);
  });

  it('met à jour PARTIELLEMENT (fusion avec l\'existant, rien n\'est perdu)', () => {
    const seller = SellerService.createSeller({ name: 'Youssef', phone: '0600', commission_rate: 3 });
    const updated = SellerService.updateSeller(seller.id, { commission_rate: 8 });

    expect(updated.name).toBe('Youssef');
    expect(updated.phone).toBe('0600');
    expect(updated.commission_rate).toBe(8);
  });

  it('active / désactive un vendeur', () => {
    const seller = SellerService.createSeller({ name: 'Sara' });
    SellerService.setSellerActive(seller.id, false);
    expect(SellerService.getSeller(seller.id)?.active).toBe(0);
    expect(SellerService.getActiveSellers().some(s => s.id === seller.id)).toBe(false);

    SellerService.setSellerActive(seller.id, true);
    expect(SellerService.getActiveSellers().some(s => s.id === seller.id)).toBe(true);
  });

  it('calcule le rapport : CA, nombre de ventes et commission', () => {
    const seller = SellerService.createSeller({ name: 'Karim', commission_rate: 10 });

    insertSale({ sellerId: seller.id, type: 'INVOICE', status: 'PAID', total: 1000, date: '2026-06-10' });
    insertSale({ sellerId: seller.id, type: 'DELIVERY_NOTE', status: 'UNPAID', total: 1000, date: '2026-06-11' });
    // Annulée → ignorée ; devis → ignoré.
    insertSale({ sellerId: seller.id, type: 'INVOICE', status: 'CANCELLED', total: 5000, date: '2026-06-12' });
    insertSale({ sellerId: seller.id, type: 'QUOTE', status: 'DRAFT', total: 9999, date: '2026-06-13' });

    const report = SellerService.getReportForRange('2026-06-01', '2026-06-30');
    const row = report.rows.find(r => r.id === seller.id)!;

    expect(row.sales_count).toBe(2);
    expect(row.revenue).toBe(2000);
    expect(row.commission).toBe(200);
    expect(report.totalRevenue).toBe(2000);
    expect(report.totalCommission).toBe(200);
  });

  it('exclut les ventes hors période', () => {
    const seller = SellerService.createSeller({ name: 'Hors', commission_rate: 10 });
    insertSale({ sellerId: seller.id, total: 1000, date: '2020-01-05' });

    const report = SellerService.getReportForRange('2026-01-01', '2026-12-31');
    const row = report.rows.find(r => r.id === seller.id)!;
    expect(row.sales_count).toBe(0);
    expect(row.revenue).toBe(0);
    expect(row.commission).toBe(0);
  });

  it('affiche un vendeur sans vente (CA et commission à 0)', () => {
    const seller = SellerService.createSeller({ name: 'Sans vente', commission_rate: 7 });
    const report = SellerService.getReportForRange('2026-06-01', '2026-06-30');
    const row = report.rows.find(r => r.id === seller.id)!;
    expect(row.sales_count).toBe(0);
    expect(row.revenue).toBe(0);
    expect(row.commission).toBe(0);
  });

  it('REFUSE la suppression d\'un vendeur référencé par un document', () => {
    const seller = SellerService.createSeller({ name: 'Référencé' });
    insertSale({ sellerId: seller.id, total: 100 });

    expect(() => SellerService.deleteSeller(seller.id)).toThrow(/référencé/i);
    expect(SellerService.getSeller(seller.id)).toBeDefined();
  });

  it('supprime un vendeur non référencé', () => {
    const seller = SellerService.createSeller({ name: 'Libre' });
    SellerService.deleteSeller(seller.id);
    expect(SellerService.getSeller(seller.id)).toBeUndefined();
  });
});
