import { db, runInTransaction } from '../database/config/connection';
import { randomUUID } from 'crypto';
// §Phase 2.2 — l'expiration d'un lot est une date MÉTIER : `julianday('now')`
// est en UTC et sa troncature décalait les alertes 🔴/🟠/🟡 d'un jour.
import { todayDateOnly, daysBetweenDateOnly } from '../utils/date';

/**
 * Phase 3 — Lots / dates d'expiration (`product_batches`).
 *
 * Complémentaire au moteur de stock global (StockLedgerService) : les lots
 * N'ONT PAS d'impact sur `inventory_balances` ni sur les mouvements. Ils
 * enregistrent uniquement un détail qualité (numéro de lot + date d'expiration)
 * pour les produits marqués `batch_managed = 1`.
 *
 * §Phase 13 — FEFO (« First Expired, First Out ») : la consommation de lots
 * (vente, perte, transfert sortant…) se fait TOUJOURS par expiration croissante.
 * La règle vit ici et nulle part ailleurs (Rule A).
 */

export interface ProductBatch {
  id: string;
  product_id: string;
  lot_number: string;
  quantity: number;
  expiry_date: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ExpiringBatch {
  id: string;
  product_id: string;
  product_ref?: string;
  product_name?: string;
  lot_number: string;
  quantity: number;
  expiry_date: string | null;
  days_left: number | null;
}

/** Une part de quantité prélevée sur un lot précis (FEFO, §Phase 13). */
export interface FefoAllocation {
  batch_id: string;
  lot_number: string;
  expiry_date: string | null;
  /** Quantité prélevée sur ce lot. */
  taken: number;
  /** Quantité restante sur ce lot APRÈS prélèvement. */
  remaining: number;
}

/** Résultat d'une consommation FEFO. */
export interface FefoConsumption {
  product_id: string;
  /** Quantité demandée. */
  requested: number;
  /** Quantité effectivement prélevée sur les lots. */
  allocated: number;
  allocations: FefoAllocation[];
  /** true si le produit n'est PAS géré par lots → aucune allocation FEFO. */
  skipped: boolean;
}

/** Plan FEFO (LECTURE SEULE) : ce qui SERAIT prélevé, sans rien modifier. */
export interface FefoPlan {
  product_id: string;
  requested: number;
  available: number;
  sufficient: boolean;
  allocations: Array<{
    batch_id: string;
    lot_number: string;
    expiry_date: string | null;
    taken: number;
    available_on_lot: number;
  }>;
}

/**
 * Requêtes préparées PARESSEUSEMENT (lazy).
 *
 * Pourquoi : préparer les statements au niveau MODULE crée une dépendance à une
 * connexion OUVERTE au moment de l'import. Quand ce module est (ré)évalué après
 * la fermeture de la base — ce qui arrive pendant les tests (isolation des
 * modules) — better-sqlite3 lève « The database connection is not open » sous
 * forme de rejet NON GÉRÉ. On prépare donc à la PREMIÈRE UTILISATION : aucune
 * dépendance à la connexion à l'import, et le cache évite tout coût répété.
 */
/**
 * Surface MINIMALE dont ce module a besoin sur une requête préparée.
 * Décrite structurellement (au lieu de `ReturnType<typeof db.prepare>`, dont le
 * paramètre générique de liaison se résout mal ici) : `Statement` de
 * better-sqlite3 y est assignable — les méthodes sont bivariantes.
 */
interface PreparedStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

interface BatchStatements {
  listByProduct: PreparedStatement;
  getById: PreparedStatement;
  insert: PreparedStatement;
  updateQuantity: PreparedStatement;
  remove: PreparedStatement;
  listFefo: PreparedStatement;
  batchManaged: PreparedStatement;
  expiring: PreparedStatement;
}

let cachedStatements: BatchStatements | null = null;

function statements(): BatchStatements {
  if (cachedStatements) return cachedStatements;
  cachedStatements = {
    listByProduct: db.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiry_date ASC'),
    getById: db.prepare('SELECT * FROM product_batches WHERE id = ?'),
    insert: db.prepare(`
      INSERT INTO product_batches (id, product_id, lot_number, quantity, expiry_date)
      VALUES (?, ?, ?, ?, ?)
    `),
    updateQuantity: db.prepare(`
      UPDATE product_batches SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `),
    remove: db.prepare('DELETE FROM product_batches WHERE id = ?'),

    // §Phase 13 — Ordre FEFO : `(expiry_date IS NULL) ASC` place d'abord les lots
    // AVEC date (0) et repousse les lots SANS date en dernier (1) : un lot sans
    // date ne doit jamais être consommé avant un lot dont l'expiration est connue.
    listFefo: db.prepare(`
      SELECT * FROM product_batches
      WHERE product_id = ? AND quantity > 0
      ORDER BY (expiry_date IS NULL) ASC, expiry_date ASC, created_at ASC
    `),

    batchManaged: db.prepare('SELECT batch_managed FROM products WHERE id = ?'),

    // §Phase 2.2 / §Phase 13 — le SQL ne calcule PLUS `days_left` : `julianday('now')`
    // est en UTC et la troncature décalait d'un jour les seuils 🔴/🟠/🟡. On filtre
    // sur le CALENDRIER local (expiration ≤ aujourd'hui + N jours) ; `days_left` est
    // ensuite calculé par le moteur de dates commun.
    expiring: db.prepare(`
      SELECT pb.id, pb.product_id, p.reference AS product_ref, p.designation AS product_name,
        pb.lot_number, pb.quantity, pb.expiry_date
      FROM product_batches pb
      JOIN products p ON p.id = pb.product_id
      WHERE p.batch_managed = 1
        AND p.status = 'ACTIVE'
        AND pb.expiry_date IS NOT NULL
        AND pb.quantity > 0
        AND date(pb.expiry_date) <= date(?, ?)
      ORDER BY pb.expiry_date ASC
      LIMIT 200
    `),
  };
  return cachedStatements;
}

interface ExpiringBatchRow {
  id: string;
  product_id: string;
  product_ref: string;
  product_name: string;
  lot_number: string;
  quantity: number;
  expiry_date: string;
}

export const ProductBatchRepository = {
  listByProduct(productId: string): ProductBatch[] {
    return statements().listByProduct.all(productId) as ProductBatch[];
  },

  getById(id: string): ProductBatch | undefined {
    return statements().getById.get(id) as ProductBatch | undefined;
  },

  /** Crée un lot (numéro de lot obligatoire, date d'expiration optionnelle). */
  create(data: { product_id: string; lot_number: string; quantity: number; expiry_date?: string | null }): ProductBatch {
    const lotNumber = data.lot_number.trim();
    if (!lotNumber) throw new Error('Le numéro de lot est obligatoire.');
    const quantity = Number(data.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Quantité de lot invalide.');

    const id = randomUUID();
    statements().insert.run(id, data.product_id, lotNumber, quantity, data.expiry_date ?? null);
    return this.getById(id)!;
  },

  updateQuantity(id: string, quantity: number): void {
    const q = Number(quantity);
    if (!Number.isFinite(q) || q < 0) throw new Error('Quantité de lot invalide.');
    statements().updateQuantity.run(q, id);
  },

  remove(id: string): void {
    statements().remove.run(id);
  },

  /**
   * Lots dont l'expiration est à venir dans `withinDays` (ou déjà dépassée).
   * Les produits sans gestion de lots (`batch_managed = 0`) n'apparaissent
   * JAMAIS dans cette liste.
   */
  getExpiringBatches(withinDays: number = 30): ExpiringBatch[] {
    // ATTENTION : `Number(x) || 30` serait FAUX pour x = 0 (0 est falsy -> 30).
    // Un seuil de 0 jour (« expire aujourd'hui ») doit rester 0. On ne remplace que NaN.
    const requested = Number(withinDays);
    const days = Number.isFinite(requested) ? Math.max(0, Math.min(3650, Math.trunc(requested))) : 30;
    const today = todayDateOnly();
    const rows = statements().expiring.all(today, `+${days} days`) as ExpiringBatchRow[];
    return rows.map(row => ({
      id: row.id,
      product_id: row.product_id,
      product_ref: row.product_ref,
      product_name: row.product_name,
      lot_number: row.lot_number,
      quantity: row.quantity,
      expiry_date: row.expiry_date,
      // Négatif = lot déjà expiré (même moteur de dates que le reste du projet).
      days_left: daysBetweenDateOnly(today, row.expiry_date),
    }));
  },

  /** Le produit est-il en gestion par lots ? (`products.batch_managed = 1`) */
  isBatchManaged(productId: string): boolean {
    const row = statements().batchManaged.get(productId) as { batch_managed: number } | undefined;
    return Number(row?.batch_managed ?? 0) === 1;
  },

  /** Lots disponibles d'un produit, en ORDRE FEFO. */
  listFefo(productId: string): ProductBatch[] {
    return statements().listFefo.all(productId) as ProductBatch[];
  },

  /**
   * §Phase 13 — PLAN FEFO (LECTURE SEULE, n'écrit jamais).
   * Permet d'afficher à l'utilisateur quels lots seront consommés avant de valider.
   */
  getFefoPlan(productId: string, quantity: number): FefoPlan {
    const requested = Number(quantity);
    if (!Number.isFinite(requested) || requested <= 0) {
      throw new Error('Quantité FEFO invalide : elle doit être supérieure à 0.');
    }

    const lots = this.listFefo(productId);
    const available = lots.reduce((sum, lot) => sum + Number(lot.quantity ?? 0), 0);

    const allocations: FefoPlan['allocations'] = [];
    let remainingToTake = requested;
    for (const lot of lots) {
      if (remainingToTake <= 0) break;
      const lotQty = Number(lot.quantity ?? 0);
      const taken = Math.min(lotQty, remainingToTake);
      allocations.push({
        batch_id: lot.id,
        lot_number: lot.lot_number,
        expiry_date: lot.expiry_date,
        taken,
        available_on_lot: lotQty,
      });
      remainingToTake -= taken;
    }

    return {
      product_id: productId,
      requested,
      available,
      sufficient: remainingToTake <= 0,
      allocations,
    };
  },

  /**
   * §Phase 13 — Consommation FEFO À L'INTÉRIEUR d'une transaction déjà ouverte.
   *
   * ⚠️ Ne pas appeler hors transaction : utiliser `consumeFefo` pour cela.
   * better-sqlite3 refuse les transactions imbriquées — cette variante existe
   * pour être appelée depuis `StockLedgerService.recordMovement`, qui ouvre
   * déjà la sienne (mouvement + solde + lots = une seule unité atomique).
   *
   * Produit NON géré par lots → aucune action, `skipped: true` : on n'impose
   * JAMAIS la gestion par lots à un produit qui ne l'utilise pas.
   * Produit géré par lots mais aucun lot suivi → `skipped: true` (les lots sont
   * un détail qualité ; le solde de stock reste la source de vérité).
   * Produit géré par lots avec lots INSUFFISANTS → erreur : jamais de
   * prélèvement partiel silencieux.
   */
  consumeFefoInTransaction(productId: string, quantity: number): FefoConsumption {
    const requested = Number(quantity);
    if (!Number.isFinite(requested) || requested <= 0) {
      throw new Error('Quantité FEFO invalide : elle doit être supérieure à 0.');
    }

    if (!this.isBatchManaged(productId)) {
      return { product_id: productId, requested, allocated: 0, allocations: [], skipped: true };
    }

    const lots = this.listFefo(productId);
    if (lots.length === 0) {
      return { product_id: productId, requested, allocated: 0, allocations: [], skipped: true };
    }

    const available = lots.reduce((sum, lot) => sum + Number(lot.quantity ?? 0), 0);
    if (available < requested) {
      const product = db.prepare('SELECT reference, designation FROM products WHERE id = ?')
        .get(productId) as { reference: string; designation: string } | undefined;
      throw new Error(
        `Lots insuffisants pour "${product?.reference ?? productId} (${product?.designation ?? ''})" : ` +
        `demandé ${requested}, disponible dans les lots ${available}.`
      );
    }

    const allocations: FefoAllocation[] = [];
    let remainingToTake = requested;

    for (const lot of lots) {
      if (remainingToTake <= 0) break;
      const lotQty = Number(lot.quantity ?? 0);
      const taken = Math.min(lotQty, remainingToTake);
      const remaining = lotQty - taken;
      this.updateQuantity(lot.id, remaining);
      allocations.push({
        batch_id: lot.id,
        lot_number: lot.lot_number,
        expiry_date: lot.expiry_date,
        taken,
        remaining,
      });
      remainingToTake -= taken;
    }

    return { product_id: productId, requested, allocated: requested, allocations, skipped: false };
  },

  /**
   * §Phase 13 — Consommation FEFO autonome (ouvre sa propre transaction).
   * À utiliser pour un prélèvement isolé ; `StockLedgerService.recordMovement`
   * utilise la variante transactionnelle ci-dessus.
   */
  consumeFefo(productId: string, quantity: number): FefoConsumption {
    return runInTransaction(() => this.consumeFefoInTransaction(productId, quantity));
  },
};
