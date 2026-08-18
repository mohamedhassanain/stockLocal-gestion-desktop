import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  ice?: string;
  payment_conditions?: string;
  credit_limit: number;
  category: 'DÉTAIL' | 'GROSSISTE' | 'VIP';
  created_at?: string;
  updated_at?: string;
  // Calculé dynamiquement
  balance?: number;
}

export interface ClientCredit {
  id: string;
  customer_id: string;
  type: 'CREDIT' | 'PAYMENT';
  amount: number;
  description?: string;
  date: string;
  user_id: string;
  created_at?: string;
}

// ─── Requêtes Préparées ──────────────────────────────────────────────────────

const stmtSearch = db.prepare<[string, string]>(`
  SELECT c.*,
    COALESCE(
      (SELECT SUM(CASE WHEN cc.type='CREDIT' THEN cc.amount ELSE -cc.amount END)
       FROM client_credits cc WHERE cc.customer_id = c.id),
    0) AS balance
  FROM customers c
  WHERE c.name LIKE ? OR c.phone LIKE ?
  ORDER BY c.name ASC
  LIMIT 200
`);

const stmtGetAll = db.prepare<[]>(`
  SELECT c.*,
    COALESCE(
      (SELECT SUM(CASE WHEN cc.type='CREDIT' THEN cc.amount ELSE -cc.amount END)
       FROM client_credits cc WHERE cc.customer_id = c.id),
    0) AS balance
  FROM customers c
  ORDER BY c.name ASC
  LIMIT 500
`);

const stmtGetById = db.prepare<[string]>(`
  SELECT c.*,
    COALESCE(
      (SELECT SUM(CASE WHEN cc.type='CREDIT' THEN cc.amount ELSE -cc.amount END)
       FROM client_credits cc WHERE cc.customer_id = c.id),
    0) AS balance
  FROM customers c
  WHERE c.id = ?
`);

const stmtInsert = db.prepare<[string, string, string | null, string | null, string | null, string | null, number, string]>(`
  INSERT INTO customers (id, name, phone, address, ice, payment_conditions, credit_limit, category)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtUpdate = db.prepare<[string, string | null, string | null, string | null, string | null, number, string, string]>(`
  UPDATE customers SET name=?, phone=?, address=?, ice=?, payment_conditions=?, credit_limit=?, category=?, updated_at=CURRENT_TIMESTAMP
  WHERE id=?
`);

const stmtGetHistory = db.prepare<[string]>(`
  SELECT * FROM client_credits WHERE customer_id = ? ORDER BY date DESC LIMIT 200
`);

const stmtAddCredit = db.prepare<[string, string, string, number, string | null, string]>(`
  INSERT INTO client_credits (id, customer_id, type, amount, description, user_id)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtGetBalance = db.prepare<[string]>(`
  SELECT COALESCE(SUM(CASE WHEN type='CREDIT' THEN amount ELSE -amount END), 0) AS balance
  FROM client_credits
  WHERE customer_id = ?
`);

const stmtDelete = db.prepare('DELETE FROM customers WHERE id = ?');

const stmtCountDocuments = db.prepare('SELECT COUNT(*) AS cnt FROM documents WHERE entity_id = ?');

// ─── Repository ──────────────────────────────────────────────────────────────

export const ClientRepository = {
  getAll(): Customer[] {
    return stmtGetAll.all() as Customer[];
  },

  search(query: string): Customer[] {
    const q = `%${query}%`;
    return stmtSearch.all(q, q) as Customer[];
  },

  getById(id: string): Customer | undefined {
    return stmtGetById.get(id) as Customer | undefined;
  },

  create(data: Omit<Customer, 'id' | 'created_at' | 'updated_at' | 'balance'>): Customer {
    const id = randomUUID();
    stmtInsert.run(
      id,
      data.name,
      data.phone ?? null,
      data.address ?? null,
      data.ice ?? null,
      data.payment_conditions ?? null,
      data.credit_limit ?? 0,
      data.category ?? 'DÉTAIL'
    );
    return this.getById(id)!;
  },

  update(id: string, data: Partial<Omit<Customer, 'id' | 'created_at' | 'updated_at' | 'balance'>>): Customer {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Client introuvable : ${id}`);
    stmtUpdate.run(
      data.name ?? existing.name,
      data.phone ?? existing.phone ?? null,
      data.address ?? existing.address ?? null,
      data.ice ?? existing.ice ?? null,
      data.payment_conditions ?? existing.payment_conditions ?? null,
      data.credit_limit ?? existing.credit_limit ?? 0,
      data.category ?? existing.category ?? 'DÉTAIL',
      id
    );
    return this.getById(id)!;
  },

  remove(id: string): void {
    const existing = this.getById(id);
    if (!existing) throw new Error('Client introuvable : ' + id);
    const result = stmtCountDocuments.get(id) as { cnt: number };
    if (result.cnt > 0) {
      throw new Error('Impossible de supprimer ce client : des documents sont encore lies (factures/avoirs).');
    }
    stmtDelete.run(id);
  },

  getHistory(customerId: string): ClientCredit[] {
    return stmtGetHistory.all(customerId) as ClientCredit[];
  },

  getBalance(customerId: string): number {
    const result = stmtGetBalance.get(customerId) as { balance: number };
    return result.balance;
  },

  addCredit(data: { customer_id: string; type: 'CREDIT' | 'PAYMENT'; amount: number; description?: string; user_id: string }): ClientCredit {
    const id = randomUUID();
    stmtAddCredit.run(id, data.customer_id, data.type, data.amount, data.description ?? null, data.user_id);
    return { id, ...data, date: new Date().toISOString() };
  },

  /** Les documents (factures, avoirs) liés au client — historique complet §5 */
  getDocuments(customerId: string): Array<{
    id: string;
    type: string;
    document_number: string;
    date: string;
    total_incl_tax: number;
    status: string;
  }> {
    return db.prepare(`
      SELECT d.id, d.type, d.document_number, d.date, d.total_incl_tax, d.status
      FROM documents d
      WHERE d.entity_id = ?
      ORDER BY d.date DESC
      LIMIT 200
    `).all(customerId) as any;
  }
};
