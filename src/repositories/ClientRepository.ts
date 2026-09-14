import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';
import { EntityCannotBeDeletedError } from '../domain/errors/EntityCannotBeDeletedError';
// §Solde client — arrondi à la précision monétaire, comme le relevé de compte.
import { roundMoney } from '../utils/money';

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  ice?: string;
  payment_conditions?: string;
  credit_limit: number;
  // Catégorie libre définie par l'utilisateur (Paramètres → Catégories clients).
  category: string;
  // §B3 — Niveau de prix appliqué automatiquement en vente (RETAIL/WHOLESALE/VIP…).
  price_level?: string;
  // §Fidélité — points cumulés (0 si le programme est désactivé).
  loyalty_points?: number;
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
  created_at?: string;
}

// ─── Requêtes Préparées ──────────────────────────────────────────────────────

/**
 * §Solde client — DÉFINITION UNIQUE, identique au relevé de compte
 * (`StatementRepository.getClientStatement`). C'est le SEUL calcul autorisé.
 *
 *   solde = (factures & bons de livraison NON annulés)
 *         + (crédits manuels — client_credits CREDIT)
 *         − (paiements rattachés à un document NON annulé)
 *         − (règlements — client_credits PAYMENT)
 *
 * POURQUOI ce n'est PAS « SUM(client_credits) » : les FACTURES ne sont JAMAIS
 * dupliquées dans `client_credits` (elles vivent dans `documents`). Un solde
 * réduit à `client_credits` renvoyait donc 0 MAD pour un client dont la dette
 * provient d'une vente à crédit : le plafond de crédit n'était jamais appliqué
 * et l'encaissement manuel d'une facture était refusé à tort.
 */
export function clientBalanceSql(customerRef: string): string {
  return `
    COALESCE((SELECT SUM(CASE WHEN cc.type = 'CREDIT' THEN cc.amount ELSE -cc.amount END)
              FROM client_credits cc WHERE cc.customer_id = ${customerRef}), 0)
    + COALESCE((SELECT SUM(d.total_incl_tax) FROM documents d
                WHERE d.entity_id = ${customerRef}
                  AND d.type IN ('INVOICE', 'DELIVERY_NOTE')
                  AND d.status <> 'CANCELLED'), 0)
    - COALESCE((SELECT SUM(p.amount) FROM payments p
                JOIN documents pd ON pd.id = p.document_id
                WHERE pd.entity_id = ${customerRef} AND pd.status <> 'CANCELLED'), 0)
  `;
}

const stmtSearch = db.prepare<[string, string]>(`
  SELECT c.*,
    ${clientBalanceSql('c.id')} AS balance
  FROM customers c
  WHERE c.name LIKE ? OR c.phone LIKE ?
  ORDER BY c.name ASC
  LIMIT 200
`);

const stmtGetAll = db.prepare<[]>(`
  SELECT c.*,
    ${clientBalanceSql('c.id')} AS balance
  FROM customers c
  ORDER BY c.name ASC
  LIMIT 500
`);

const stmtGetById = db.prepare<[string]>(`
  SELECT c.*,
    ${clientBalanceSql('c.id')} AS balance
  FROM customers c
  WHERE c.id = ?
`);

const stmtInsert = db.prepare<[string, string, string | null, string | null, string | null, string | null, number, string, string]>(`
  INSERT INTO customers (id, name, phone, address, ice, payment_conditions, credit_limit, category, price_level)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtUpdate = db.prepare<[string, string | null, string | null, string | null, string | null, number, string, string, string]>(`
  UPDATE customers SET name=?, phone=?, address=?, ice=?, payment_conditions=?, credit_limit=?, category=?, price_level=?, updated_at=CURRENT_TIMESTAMP
  WHERE id=?
`);

const stmtGetHistory = db.prepare<[string]>(`
  SELECT * FROM client_credits WHERE customer_id = ? ORDER BY date DESC LIMIT 200
`);

const stmtAddCredit = db.prepare<[string, string, string, number, string | null]>(`
  INSERT INTO client_credits (id, customer_id, type, amount, description)
  VALUES (?, ?, ?, ?, ?)
`);

// §Solde client — l'ancien calcul « SUM(client_credits) » a été SUPPRIMÉ :
// il ignorait les factures. Le solde provient désormais de l'expression unique
// `clientBalanceSql`, PARTAGÉE avec l'export CSV (ExportService.exportClients)
// pour qu'un export ne puisse jamais afficher un solde différent de l'écran.

// §Fidélité — incrément / décrément ATOMIQUE des points (jamais de lecture
// puis écriture séparées : deux échanges simultanés ne peuvent pas se perdre).
// La clause `loyalty_points >= ?` rend impossible un solde négatif côté SQL.
const stmtAddPoints = db.prepare<[number, string]>(`
  UPDATE customers SET loyalty_points = loyalty_points + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);

const stmtRedeemPoints = db.prepare<[number, string, number]>(`
  UPDATE customers SET loyalty_points = loyalty_points - ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND loyalty_points >= ?
`);

const stmtGetPoints = db.prepare<[string]>('SELECT loyalty_points FROM customers WHERE id = ?');

const stmtDelete = db.prepare('DELETE FROM customers WHERE id = ?');

const stmtCountDocuments = db.prepare('SELECT COUNT(*) AS cnt FROM documents WHERE entity_id = ?');

const stmtArchive = db.prepare("UPDATE customers SET status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const stmtActivate = db.prepare("UPDATE customers SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ?");

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
      data.category ?? 'DÉTAIL',
      data.price_level ?? 'RETAIL'
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
      data.price_level ?? existing.price_level ?? 'RETAIL',
      id
    );
    return this.getById(id)!;
  },

  remove(id: string): void {
    const existing = this.getById(id);
    if (!existing) throw new Error('Client introuvable : ' + id);

    const refs: { name: string; count: number }[] = [];
    const docCount = (stmtCountDocuments.get(id) as { cnt: number }).cnt;
    if (docCount > 0) refs.push({ name: 'documents (factures/avoirs)', count: docCount });

    const creditCount = (db.prepare('SELECT COUNT(*) AS cnt FROM client_credits WHERE customer_id = ?').get(id) as { cnt: number }).cnt;
    if (creditCount > 0) refs.push({ name: 'crédits/paiements', count: creditCount });

    if (refs.length > 0) {
      throw new EntityCannotBeDeletedError('client', refs);
    }

    stmtDelete.run(id);
  },

  archive(id: string): void {
    const existing = this.getById(id);
    if (!existing) throw new Error('Client introuvable : ' + id);
    stmtArchive.run(id);
  },

  activate(id: string): void {
    const existing = this.getById(id);
    if (!existing) throw new Error('Client introuvable : ' + id);
    stmtActivate.run(id);
  },

  getHistory(customerId: string): ClientCredit[] {
    return stmtGetHistory.all(customerId) as ClientCredit[];
  },

  /**
   * Solde client (positif = le client nous doit). Repose sur la MÊME expression
   * que `getAll` / `getById`, donc STRICTEMENT identique au relevé de compte.
   */
  getBalance(customerId: string): number {
    const row = stmtGetById.get(customerId) as Customer | undefined;
    return roundMoney(Number(row?.balance ?? 0));
  },

  /** §Fidélité — solde de points du client (0 si inconnu). */
  getLoyaltyPoints(customerId: string): number {
    const row = stmtGetPoints.get(customerId) as { loyalty_points: number } | undefined;
    return Math.max(0, Math.floor(Number(row?.loyalty_points ?? 0)));
  },

  /** §Fidélité — crédite des points (delta > 0 uniquement). Renvoie le nouveau solde. */
  addLoyaltyPoints(customerId: string, points: number): number {
    const delta = Math.floor(Number(points));
    const existing = this.getById(customerId);
    if (!existing) throw new Error('Client introuvable.');
    if (!Number.isFinite(delta) || delta <= 0) return this.getLoyaltyPoints(customerId);
    stmtAddPoints.run(delta, customerId);
    return this.getLoyaltyPoints(customerId);
  },

  /**
   * §Fidélité — débite des points. REFUSE (erreur explicite) si le solde est
   * insuffisant : la condition est appliquée DANS la requête SQL, donc aucune
   * course entre la vérification et l'écriture.
   */
  redeemLoyaltyPoints(customerId: string, points: number): number {
    const delta = Math.floor(Number(points));
    const existing = this.getById(customerId);
    if (!existing) throw new Error('Client introuvable.');
    if (!Number.isFinite(delta) || delta <= 0) {
      throw new Error('Le nombre de points à échanger doit être supérieur à 0.');
    }
    const available = this.getLoyaltyPoints(customerId);
    if (delta > available) {
      throw new Error(`Points fidélité insuffisants : ${available} disponible(s), ${delta} demandé(s).`);
    }
    const result = stmtRedeemPoints.run(delta, customerId, delta);
    if (result.changes === 0) {
      throw new Error('Points fidélité insuffisants.');
    }
    return this.getLoyaltyPoints(customerId);
  },

  addCredit(data: { customer_id: string; type: 'CREDIT' | 'PAYMENT'; amount: number; description?: string }): ClientCredit {
    const id = randomUUID();
    stmtAddCredit.run(id, data.customer_id, data.type, data.amount, data.description ?? null);
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
    `).all(customerId) as Array<{
      id: string;
      type: string;
      document_number: string;
      date: string;
      total_incl_tax: number;
      status: string;
    }>;
  }
};
