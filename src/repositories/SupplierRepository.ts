import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';
import { EntityCannotBeDeletedError } from '../domain/errors/EntityCannotBeDeletedError';

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  ice?: string;
  created_at?: string;
  updated_at?: string;
  // Calculé dynamiquement (dette envers le fournisseur)
  balance?: number;
}

export interface SupplierCredit {
  id: string;
  supplier_id: string;
  type: 'DEBT' | 'PAYMENT';
  amount: number;
  description?: string;
  date: string;
  created_at?: string;
}

// ─── Requêtes Préparées ──────────────────────────────────────────────────────

const stmtSearch = db.prepare<[string, string]>(`
  SELECT s.*,
    COALESCE(
      (SELECT SUM(CASE WHEN sc.type='DEBT' THEN sc.amount ELSE -sc.amount END)
       FROM supplier_credits sc WHERE sc.supplier_id = s.id),
    0) AS balance
  FROM suppliers s
  WHERE s.name LIKE ? OR s.phone LIKE ?
  ORDER BY s.name ASC
  LIMIT 200
`);

const stmtGetAll = db.prepare<[]>(`
  SELECT s.*,
    COALESCE(
      (SELECT SUM(CASE WHEN sc.type='DEBT' THEN sc.amount ELSE -sc.amount END)
       FROM supplier_credits sc WHERE sc.supplier_id = s.id),
    0) AS balance
  FROM suppliers s
  ORDER BY s.name ASC
  LIMIT 500
`);

const stmtGetById = db.prepare<[string]>(`
  SELECT s.*,
    COALESCE(
      (SELECT SUM(CASE WHEN sc.type='DEBT' THEN sc.amount ELSE -sc.amount END)
       FROM supplier_credits sc WHERE sc.supplier_id = s.id),
    0) AS balance
  FROM suppliers s
  WHERE s.id = ?
`);

const stmtInsert = db.prepare<[string, string, string | null, string | null, string | null]>(`
  INSERT INTO suppliers (id, name, phone, address, ice)
  VALUES (?, ?, ?, ?, ?)
`);

const stmtUpdate = db.prepare<[string, string | null, string | null, string | null, string]>(`
  UPDATE suppliers SET name=?, phone=?, address=?, ice=?, updated_at=CURRENT_TIMESTAMP
  WHERE id=?
`);

const stmtGetHistory = db.prepare<[string]>(`
  SELECT * FROM supplier_credits WHERE supplier_id = ? ORDER BY date DESC LIMIT 200
`);

const stmtAddCredit = db.prepare<[string, string, string, number, string | null]>(`
  INSERT INTO supplier_credits (id, supplier_id, type, amount, description)
  VALUES (?, ?, ?, ?, ?)
`);

const stmtGetBalance = db.prepare<[string]>(`
  SELECT COALESCE(SUM(CASE WHEN type='DEBT' THEN amount ELSE -amount END), 0) AS balance
  FROM supplier_credits
  WHERE supplier_id = ?
`);

const stmtDelete = db.prepare('DELETE FROM suppliers WHERE id = ?');

const stmtCountStock = db.prepare('SELECT COUNT(*) AS cnt FROM stock_movements WHERE supplier_id = ?');

const stmtArchive = db.prepare("UPDATE suppliers SET status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const stmtActivate = db.prepare("UPDATE suppliers SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ?");

// ─── Repository ──────────────────────────────────────────────────────────────

export const SupplierRepository = {
  getAll(): Supplier[] {
    return stmtGetAll.all() as Supplier[];
  },

  search(query: string): Supplier[] {
    const q = `%${query}%`;
    return stmtSearch.all(q, q) as Supplier[];
  },

  getById(id: string): Supplier | undefined {
    return stmtGetById.get(id) as Supplier | undefined;
  },

  create(data: Omit<Supplier, 'id' | 'created_at' | 'updated_at' | 'balance'>): Supplier {
    const id = randomUUID();
    stmtInsert.run(
      id,
      data.name,
      data.phone ?? null,
      data.address ?? null,
      data.ice ?? null
    );
    return this.getById(id)!;
  },

  update(id: string, data: Partial<Omit<Supplier, 'id' | 'created_at' | 'updated_at' | 'balance'>>): Supplier {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Fournisseur introuvable : ${id}`);
    stmtUpdate.run(
      data.name ?? existing.name,
      data.phone ?? existing.phone ?? null,
      data.address ?? existing.address ?? null,
      data.ice ?? existing.ice ?? null,
      id
    );
    return this.getById(id)!;
  },

  remove(id: string): void {
    const existing = this.getById(id);
    if (!existing) throw new Error('Fournisseur introuvable : ' + id);

    const refs: { name: string; count: number }[] = [];
    const stockCount = (stmtCountStock.get(id) as { cnt: number }).cnt;
    if (stockCount > 0) refs.push({ name: 'mouvements de stock', count: stockCount });

    const poCount = (db.prepare("SELECT COUNT(*) AS cnt FROM purchase_orders WHERE supplier_id = ?").get(id) as { cnt: number }).cnt;
    if (poCount > 0) refs.push({ name: "commandes d'achat", count: poCount });

    const creditCount = (db.prepare('SELECT COUNT(*) AS cnt FROM supplier_credits WHERE supplier_id = ?').get(id) as { cnt: number }).cnt;
    if (creditCount > 0) refs.push({ name: 'crédits/paiements', count: creditCount });

    if (refs.length > 0) {
      throw new EntityCannotBeDeletedError('fournisseur', refs);
    }

    stmtDelete.run(id);
  },

  archive(id: string): void {
    const existing = this.getById(id);
    if (!existing) throw new Error('Fournisseur introuvable : ' + id);
    stmtArchive.run(id);
  },

  activate(id: string): void {
    const existing = this.getById(id);
    if (!existing) throw new Error('Fournisseur introuvable : ' + id);
    stmtActivate.run(id);
  },

  getHistory(supplierId: string): SupplierCredit[] {
    return stmtGetHistory.all(supplierId) as SupplierCredit[];
  },

  getBalance(supplierId: string): number {
    const result = stmtGetBalance.get(supplierId) as { balance: number };
    return result.balance;
  },

  addCredit(data: { supplier_id: string; type: 'DEBT' | 'PAYMENT'; amount: number; description?: string }): SupplierCredit {
    const id = randomUUID();
    stmtAddCredit.run(id, data.supplier_id, data.type, data.amount, data.description ?? null);
    return { id, ...data, date: new Date().toISOString() };
  }
};
