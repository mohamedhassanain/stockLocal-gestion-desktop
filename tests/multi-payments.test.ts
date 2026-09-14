import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/database/config/connection';
import { DocumentService } from '../src/services/DocumentService';

/**
 * §B2 — Paiement MULTIPLE sur un même document.
 *
 * Un encaissement peut être réparti sur plusieurs modes en UNE opération
 * (ex. 500 espèces + 700 chèque + 300 virement). On vérifie :
 *   - le paiement complet en un mode ;
 *   - le paiement réparti sur plusieurs modes (statut PAID, toutes les lignes
 *     enregistrées) ;
 *   - le paiement partiel (statut PARTIAL) ;
 *   - le REFUS (atomique : rien n'est écrit) si le total dépasse le reste dû ;
 *   - le refus des montants nuls/négatifs, des listes vides, d'un document
 *     déjà payé / annulé / introuvable.
 *
 * Les documents sont insérés directement (aucun produit ni mouvement de
 * stock) : ces tests portent exclusivement sur l'encaissement.
 */

const P = 'TEST_MP_';

function purge(): void {
  db.prepare(`DELETE FROM payments WHERE document_id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM document_items WHERE document_id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM documents WHERE id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM customers WHERE id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM audit_logs WHERE entity_id LIKE '${P}%'`).run();
}

function seedCustomer(): string {
  const id = `${P}cust-${randomUUID()}`;
  db.prepare('INSERT INTO customers (id, name) VALUES (?, ?)').run(id, 'Client MP');
  return id;
}

function seedDocument(opts?: { total?: number; status?: string }): string {
  const id = `${P}doc-${randomUUID()}`;
  const total = opts?.total ?? 1500;
  const customerId = seedCustomer();
  db.prepare(`
    INSERT INTO documents
      (id, type, document_number, entity_id, date, total_excl_tax, total_tax, total_incl_tax, status)
    VALUES (?, 'INVOICE', ?, ?, '2026-05-10', ?, 0, ?, ?)
  `).run(id, `MP-${id.slice(-8)}`, customerId, total, total, opts?.status ?? 'UNPAID');
  return id;
}

function paymentsOf(documentId: string): Array<{ amount: number; payment_method: string; reference: string | null }> {
  return db.prepare(
    'SELECT amount, payment_method, reference FROM payments WHERE document_id = ? ORDER BY amount ASC',
  ).all(documentId) as Array<{ amount: number; payment_method: string; reference: string | null }>;
}

function statusOf(documentId: string): string {
  return (db.prepare('SELECT status FROM documents WHERE id = ?').get(documentId) as { status: string }).status;
}

describe('§B2 — Paiement multiple sur un même document', () => {
  beforeEach(purge);
  afterEach(purge);

  it('encaisse un paiement complet en UN SEUL mode → PAID', () => {
    const id = seedDocument({ total: 1000 });
    DocumentService.addPayments(id, [{ amount: 1000, payment_method: 'CASH' }]);

    expect(statusOf(id)).toBe('PAID');
    expect(paymentsOf(id)).toHaveLength(1);
  });

  it('encaisse un paiement RÉPARTI sur plusieurs modes → PAID, toutes les lignes conservées', () => {
    const id = seedDocument({ total: 1500 });
    DocumentService.addPayments(id, [
      { amount: 500, payment_method: 'CASH' },
      { amount: 700, payment_method: 'CHECK', reference: 'CHQ-1' },
      { amount: 300, payment_method: 'TRANSFER', reference: 'VIR-9' },
    ]);

    expect(statusOf(id)).toBe('PAID');

    const rows = paymentsOf(id);
    expect(rows).toHaveLength(3);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(1500);
    expect(rows.map(r => r.payment_method).sort()).toEqual(['CASH', 'CHECK', 'TRANSFER']);
    expect(rows.find(r => r.payment_method === 'CHECK')?.reference).toBe('CHQ-1');
  });

  it('laisse le document PARTIAL sur un paiement partiel', () => {
    const id = seedDocument({ total: 1500 });
    DocumentService.addPayments(id, [{ amount: 400, payment_method: 'CASH' }]);

    expect(statusOf(id)).toBe('PARTIAL');
    expect(paymentsOf(id)).toHaveLength(1);
  });

  it('REFUSE — et n\'enregistre RIEN — si le total dépasse le reste dû (atomicité)', () => {
    const id = seedDocument({ total: 1500 });

    expect(() => DocumentService.addPayments(id, [
      { amount: 1000, payment_method: 'CASH' },
      { amount: 600, payment_method: 'CHECK' },
    ])).toThrow(/dépasse/i);

    // Aucune ligne écrite, statut inchangé : l'opération est atomique.
    expect(paymentsOf(id)).toHaveLength(0);
    expect(statusOf(id)).toBe('UNPAID');
  });

  it('REFUSE un montant nul ou négatif', () => {
    const id = seedDocument();

    expect(() => DocumentService.addPayments(id, [{ amount: 0, payment_method: 'CASH' }]))
      .toThrow(/supérieur à 0/i);
    expect(() => DocumentService.addPayments(id, [{ amount: -50, payment_method: 'CASH' }]))
      .toThrow(/supérieur à 0/i);

    expect(paymentsOf(id)).toHaveLength(0);
  });

  it('REFUSE une liste de paiement vide', () => {
    const id = seedDocument();
    expect(() => DocumentService.addPayments(id, [])).toThrow(/au moins une ligne/i);
  });

  it('REFUSE un document déjà intégralement payé', () => {
    const id = seedDocument({ total: 500, status: 'PAID' });
    expect(() => DocumentService.addPayments(id, [{ amount: 100, payment_method: 'CASH' }]))
      .toThrow(/déjà/i);
  });

  it('REFUSE un document annulé', () => {
    const id = seedDocument({ total: 500, status: 'CANCELLED' });
    expect(() => DocumentService.addPayments(id, [{ amount: 100, payment_method: 'CASH' }]))
      .toThrow(/annulé/i);
  });

  it('REFUSE un document inexistant', () => {
    expect(() => DocumentService.addPayments(`${P}absent`, [{ amount: 10, payment_method: 'CASH' }]))
      .toThrow(/introuvable/i);
  });

  it('accepte un centime de tolérance sur le dernier versement', () => {
    // 999.99 + 500.02 = 1500.01, soit exactement le total (+0.01 de tolérance).
    const id = seedDocument({ total: 1500 });
    DocumentService.addPayments(id, [
      { amount: 999.99, payment_method: 'CASH' },
      { amount: 500.02, payment_method: 'TRANSFER' },
    ]);
    expect(statusOf(id)).toBe('PAID');
  });
});
