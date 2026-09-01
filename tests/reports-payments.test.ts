import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { DashboardRepository } from '../src/repositories/DashboardRepository';

// IDs de test à préfixe unique pour éviter toute collision.
const P = 'TEST_PAY_';
const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
const currentDate = `${currentMonth} 12:00:00`;

function cleanup() {
  db.prepare(`DELETE FROM payments WHERE document_id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM documents WHERE id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM customers WHERE id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM products WHERE id LIKE '${P}%'`).run();
}

function seedCustomer(): string {
  const id = `${P}customer`;
  db.prepare(`INSERT INTO customers (id, name) VALUES (?, ?)`).run(id, 'Client TEST');
  return id;
}

function seedProduct(): string {
  const id = `${P}product`;
  db.prepare(`INSERT INTO products (id, reference, designation) VALUES (?, ?, ?)`).run(id, 'REF-TEST', 'Produit TEST');
  return id;
}

function seedDocument(customerId: string): string {
  const id = `${P}doc-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`INSERT INTO documents (id, type, document_number, entity_id, date, total_incl_tax, status) VALUES (?, 'INVOICE', ?, ?, ?, 1000, 'PAID')`)
    .run(id, `${P}NUM-${id.slice(-5)}`, customerId, currentDate);
  return id;
}

function seedPayment(docId: string, method: string, amount: number) {
  db.prepare(`INSERT INTO payments (id, document_id, amount, payment_method, date) VALUES (?, ?, ?, ?, ?)`)
    .run(`${P}pay-${Math.random().toString(36).slice(2, 8)}`, docId, amount, method, currentDate);
}

describe('Reports — DashboardRepository.getPaymentsByMethod (agrégat GROUP BY)', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('agrège plusieurs modes de paiement du mois courant', () => {
    const c = seedCustomer();
    seedProduct();
    const d1 = seedDocument(c), d2 = seedDocument(c);
    seedPayment(d1, 'CASH', 100);
    seedPayment(d1, 'CHECK', 50);
    seedPayment(d2, 'TRANSFER', 200);

    const rows = DashboardRepository.getPaymentsByMethod();
    const map = Object.fromEntries(rows.map(r => [r.payment_method, r.total]));
    expect(map['CASH']).toBe(100);
    expect(map['CHECK']).toBe(50);
    expect(map['TRANSFER']).toBe(200);
  });

  it('gère un seul mode de paiement utilisé', () => {
    const c = seedCustomer();
    seedProduct();
    const d1 = seedDocument(c);
    seedPayment(d1, 'CASH', 500);

    const rows = DashboardRepository.getPaymentsByMethod();
    expect(rows).toHaveLength(1);
    expect(rows[0].payment_method).toBe('CASH');
    expect(rows[0].total).toBe(500);
  });

  it('retourne une liste vide quand aucun encaissement ce mois-ci', () => {
    expect(DashboardRepository.getPaymentsByMethod()).toEqual([]);
  });
});
