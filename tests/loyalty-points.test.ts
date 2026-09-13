import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { db } from '../src/database/config/connection';
import { GlobalSettingsService } from '../src/services/GlobalSettingsService';
import { ClientRepository } from '../src/repositories/ClientRepository';
import { DocumentRepository } from '../src/repositories/DocumentRepository';
import { LoyaltyService } from '../src/services/LoyaltyService';

/**
 * §Programme de fidélité (points).
 *
 * Règles testées ici :
 *   - GAIN : une FACTURE crédite `floor(TTC / loyalty_mad_per_point)` points ;
 *     les devis et bons de livraison n'en créditent AUCUN (pas de double
 *     comptage d'une même vente) ; une vente comptoir (sans client) non plus.
 *   - DÉSACTIVATION : `loyalty_mad_per_point = 0` → aucun point, aucun effet.
 *   - ÉCHANGE : les points deviennent un VRAI crédit client (`client_credits`
 *     type PAYMENT) et le solde de points diminue d'autant.
 *   - GARDE-FOUS : impossible d'échanger plus que le solde, impossible de
 *     rendre le solde négatif, impossible d'échanger sans valeur configurée.
 *
 * NB : le TTC d'une facture est `prix unitaire HT × (1 + TVA)` (TVA 20 % ici),
 * les attentes sont donc DÉRIVÉES du document réellement créé — jamais d'un
 * montant supposé.
 */

const MAD_PER_POINT = 10;
const POINT_VALUE = 1;

function reset(): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    DELETE FROM credit_note_refs;
    DELETE FROM document_items;
    DELETE FROM payments;
    DELETE FROM stock_movements;
    DELETE FROM inventory_balances;
    DELETE FROM documents;
    DELETE FROM client_credits;
    DELETE FROM customers;
    DELETE FROM products;
    DELETE FROM document_sequences;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
  db.prepare('DELETE FROM global_settings WHERE key = ?').run('loyalty_mad_per_point');
  db.prepare('DELETE FROM global_settings WHERE key = ?').run('loyalty_point_value_mad');
}

/** Active le programme avec un barème donné (0 = désactivé). */
function setProgram(madPerPoint: number, pointValue: number = POINT_VALUE): void {
  GlobalSettingsService.save({
    loyalty_mad_per_point: madPerPoint,
    loyalty_point_value_mad: pointValue,
  } as Parameters<typeof GlobalSettingsService.save>[0]);
}

function createProduct(reference: string, sellingPrice: number): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO products (id, reference, designation, purchase_price, selling_price, vat_rate, min_stock, status, unit)
    VALUES (?, ?, ?, ?, ?, 20, 0, 'ACTIVE', 'PIÈCE')
  `).run(id, reference, `Produit ${reference}`, sellingPrice / 2, sellingPrice);
  return id;
}

function createClient(name: string): string {
  return ClientRepository.create({ name, credit_limit: 0, category: 'DÉTAIL' }).id;
}

/** Crée une facture d'un article et renvoie le document créé. */
function createInvoice(customerId: string, productId: string, quantity: number, unitPrice: number) {
  return DocumentRepository.create({
    type: 'INVOICE',
    entity_id: customerId,
    date: '2026-01-15',
    items: [{ product_id: productId, quantity, unit_price: unitPrice, discount: 0 }],
  });
}

/** Nombre de points ATTENDU pour un montant TTC donné. */
function expectedPoints(totalInclTax: number): number {
  return Math.floor(totalInclTax / MAD_PER_POINT);
}

describe('§Fidélité — attribution des points', () => {
  beforeEach(() => { reset(); });

  it('programme désactivé (0 MAD/point) : aucune facture ne crédite de points', () => {
    setProgram(0);
    const clientId = createClient('Client Désactivé');
    const productId = createProduct('P-OFF', 100);

    createInvoice(clientId, productId, 1, 100);

    expect(ClientRepository.getLoyaltyPoints(clientId)).toBe(0);
    expect(LoyaltyService.isEnabled()).toBe(false);
  });

  it('une facture crédite floor(TTC / MAD par point) points au client', () => {
    setProgram(MAD_PER_POINT);
    const clientId = createClient('Client Fidèle');
    const productId = createProduct('P-100', 120);

    const invoice = createInvoice(clientId, productId, 1, 120);

    // 120 HT + 20 % de TVA = 144 TTC → 14 points (1 point / 10 MAD TTC)
    expect(invoice.total_incl_tax).toBe(144);
    expect(ClientRepository.getLoyaltyPoints(clientId)).toBe(14);
    expect(ClientRepository.getLoyaltyPoints(clientId)).toBe(expectedPoints(invoice.total_incl_tax));
  });

  it('arrondit VERS LE BAS : on ne crédite jamais un point non mérité', () => {
    setProgram(MAD_PER_POINT);
    const clientId = createClient('Client Arrondi');
    const productId = createProduct('P-99', 99);

    const invoice = createInvoice(clientId, productId, 1, 99); // 118,80 TTC → 11 points
    expect(invoice.total_incl_tax).toBe(118.8);
    expect(ClientRepository.getLoyaltyPoints(clientId)).toBe(11); // 11,88 → 11 (jamais 12)
  });

  it('cumule les points sur plusieurs factures', () => {
    setProgram(MAD_PER_POINT);
    const clientId = createClient('Client Cumul');
    const productId = createProduct('P-CUM', 50);

    const first = createInvoice(clientId, productId, 2, 50); // 120 TTC → 12 points
    const second = createInvoice(clientId, productId, 1, 50); // 60 TTC  → 6 points

    const total = expectedPoints(first.total_incl_tax) + expectedPoints(second.total_incl_tax);
    expect(ClientRepository.getLoyaltyPoints(clientId)).toBe(total);
    expect(ClientRepository.getLoyaltyPoints(clientId)).toBe(18);
  });

  it('un DEVIS ne crédite aucun point (seules les factures comptent)', () => {
    setProgram(MAD_PER_POINT);
    const clientId = createClient('Client Devis');
    const productId = createProduct('P-DEV', 100);

    DocumentRepository.create({
      type: 'QUOTE',
      entity_id: clientId,
      date: '2026-01-15',
      items: [{ product_id: productId, quantity: 1, unit_price: 100, discount: 0 }],
    });

    expect(ClientRepository.getLoyaltyPoints(clientId)).toBe(0);
  });

  it('un BON DE LIVRAISON ne crédite aucun point (la facture le fera)', () => {
    setProgram(MAD_PER_POINT);
    const clientId = createClient('Client BL');
    const productId = createProduct('P-BL', 100);

    DocumentRepository.create({
      type: 'DELIVERY_NOTE',
      entity_id: clientId,
      date: '2026-01-15',
      items: [{ product_id: productId, quantity: 1, unit_price: 100, discount: 0 }],
    });

    expect(ClientRepository.getLoyaltyPoints(clientId)).toBe(0);
  });

  it('une vente comptoir (client inconnu) est ignorée sans erreur', () => {
    setProgram(MAD_PER_POINT);
    const productId = createProduct('P-COMPTOIR', 100);

    expect(() => DocumentRepository.create({
      type: 'INVOICE',
      entity_id: 'client-inexistant',
      date: '2026-01-15',
      items: [{ product_id: productId, quantity: 1, unit_price: 100, discount: 0 }],
    })).not.toThrow();
  });
});

describe('§Fidélité — échange des points contre un crédit client', () => {
  beforeEach(() => { reset(); });

  it('convertit les points en crédit client (type PAYMENT) et décrémente le solde', () => {
    setProgram(MAD_PER_POINT, POINT_VALUE);
    const clientId = createClient('Client Échange');
    const productId = createProduct('P-ECH', 300);

    const invoice = createInvoice(clientId, productId, 1, 300); // 360 TTC → 36 points
    const available = ClientRepository.getLoyaltyPoints(clientId);
    expect(available).toBe(36);

    const pointsToUse = 20;
    const balanceBefore = ClientRepository.getBalance(clientId);
    const result = LoyaltyService.redeemPoints(clientId, pointsToUse);

    // 20 points × 1 MAD = 20 MAD de crédit accordé
    expect(result.value).toBe(pointsToUse * POINT_VALUE);
    expect(result.remaining).toBe(available - pointsToUse);
    expect(ClientRepository.getLoyaltyPoints(clientId)).toBe(available - pointsToUse);

    // Un VRAI crédit client a été créé (réduit le solde dû).
    const credits = ClientRepository.getHistory(clientId);
    const loyaltyCredit = credits.find(c => c.type === 'PAYMENT' && (c.description ?? '').includes('Fidélité'));
    expect(loyaltyCredit).toBeDefined();
    expect(Number(loyaltyCredit?.amount)).toBe(pointsToUse * POINT_VALUE);
    expect(ClientRepository.getBalance(clientId)).toBe(balanceBefore - pointsToUse * POINT_VALUE);
    // Le solde initial correspond bien au TTC de la facture.
    expect(balanceBefore).toBe(invoice.total_incl_tax);
  });

  it('refuse un échange supérieur au solde (aucun débit, aucun crédit)', () => {
    setProgram(MAD_PER_POINT, POINT_VALUE);
    const clientId = createClient('Client Insuffisant');
    const productId = createProduct('P-INS', 50);

    createInvoice(clientId, productId, 1, 50);
    const available = ClientRepository.getLoyaltyPoints(clientId);
    expect(available).toBeGreaterThan(0);

    expect(() => LoyaltyService.redeemPoints(clientId, available + 1)).toThrow(/insuffisant/i);
    expect(ClientRepository.getLoyaltyPoints(clientId)).toBe(available);
    expect(ClientRepository.getHistory(clientId).filter(c => c.type === 'PAYMENT')).toHaveLength(0);
  });

  it('refuse un échange si la valeur du point n\'est pas configurée', () => {
    setProgram(MAD_PER_POINT, 0); // gain actif mais valeur nulle
    const clientId = createClient('Client Sans Valeur');
    const productId = createProduct('P-NOVAL', 100);

    createInvoice(clientId, productId, 1, 100);
    const available = ClientRepository.getLoyaltyPoints(clientId);

    expect(() => LoyaltyService.redeemPoints(clientId, 5)).toThrow(/valeur/i);
    // Aucun point consommé : l'échange a été refusé AVANT tout débit.
    expect(ClientRepository.getLoyaltyPoints(clientId)).toBe(available);
  });

  it('refuse un nombre de points invalide (0, négatif, non numérique)', () => {
    setProgram(MAD_PER_POINT, POINT_VALUE);
    const clientId = createClient('Client Invalide');
    const productId = createProduct('P-INV', 100);
    createInvoice(clientId, productId, 1, 100);
    const available = ClientRepository.getLoyaltyPoints(clientId);

    expect(() => LoyaltyService.redeemPoints(clientId, 0)).toThrow();
    expect(() => LoyaltyService.redeemPoints(clientId, -5)).toThrow();
    expect(() => LoyaltyService.redeemPoints(clientId, Number.NaN)).toThrow();
    expect(ClientRepository.getLoyaltyPoints(clientId)).toBe(available);
  });

  it('le solde de points ne peut jamais devenir négatif (garde SQL)', () => {
    setProgram(MAD_PER_POINT, POINT_VALUE);
    const clientId = createClient('Client Garde');
    const productId = createProduct('P-GARDE', 30);
    createInvoice(clientId, productId, 1, 30);
    const available = ClientRepository.getLoyaltyPoints(clientId);

    // Appel direct au repository : la garde `loyalty_points >= ?` doit refuser.
    expect(() => ClientRepository.redeemLoyaltyPoints(clientId, available + 100)).toThrow(/insuffisant/i);
    expect(ClientRepository.getLoyaltyPoints(clientId)).toBe(available);
  });

  it('un échange partiel peut être répété jusqu\'à épuisement des points', () => {
    setProgram(MAD_PER_POINT, POINT_VALUE);
    const clientId = createClient('Client Répété');
    const productId = createProduct('P-REP', 100);
    createInvoice(clientId, productId, 1, 100);

    const available = ClientRepository.getLoyaltyPoints(clientId);
    expect(available).toBe(12);

    LoyaltyService.redeemPoints(clientId, 4);
    LoyaltyService.redeemPoints(clientId, available - 4);

    expect(ClientRepository.getLoyaltyPoints(clientId)).toBe(0);
    const payments = ClientRepository.getHistory(clientId).filter(c => c.type === 'PAYMENT');
    expect(payments).toHaveLength(2);
    expect(payments.reduce((sum, p) => sum + Number(p.amount), 0)).toBe(available * POINT_VALUE);
  });
});
