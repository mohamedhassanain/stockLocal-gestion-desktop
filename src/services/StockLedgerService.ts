import { db, runInTransaction } from '../database/config/connection';
import { randomUUID } from 'crypto';

/**
 * ─── StockLedgerService ────────────────────────────────────────────────────────
 * Moteur central et unique de toutes les opérations de stock.
 *
 * Chaque mouvement de stock est :
 *   - atomique (transaction SQLite)
 *   - traçable (movement_type explicite + lien document source)
 *   - validé (quantité > 0, stock suffisant pour les sorties)
 *   - lié à son document source (document_id)
 *
 * Types de mouvements explicites :
 *   PURCHASE_IN   → réception d'achat / entrée fournisseur
 *   SALE_OUT      → vente
 *   RETURN_IN     → retour client (réintègre le stock)
 *   RETURN_OUT    → retour fournisseur
 *   ADJUSTMENT_IN → ajustement inventaire (surplus)
 *   ADJUSTMENT_OUT→ ajustement inventaire (manque)
 *   TRANSFER_IN   → réception de transfert entre dépôts
 *   TRANSFER_OUT  → expédition de transfert entre dépôts
 *   DAMAGE_OUT    → casse
 *   LOSS_OUT      → perte
 *   OPENING_BALANCE → stock initial
 * ───────────────────────────────────────────────────────────────────────────────
 */

export type MovementType =
  | 'PURCHASE_IN'
  | 'SALE_OUT'
  | 'RETURN_IN'
  | 'RETURN_OUT'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'DAMAGE_OUT'
  | 'LOSS_OUT'
  | 'OPENING_BALANCE';

export type MovementDirection = 'IN' | 'OUT';

export interface StockMovementRow {
  id: string;
  product_id: string;
  type: MovementDirection;
  movement_type: MovementType;
  quantity: number;
  unit_price: number;
  date?: string;
  reference_doc?: string;
  document_id?: string;
  supplier_id?: string;
  notes?: string;
}

interface MovementInput {
  product_id: string;
  movement_type: MovementType;
  quantity: number; // toujours positive
  /** Direction physique. Dérivée automatiquement du movement_type si absente. */
  direction?: MovementDirection;
  unit_price?: number;
  date?: string;
  reference_doc?: string;
  document_id?: string;
  supplier_id?: string;
  notes?: string;
}

const MOVEMENT_DIRECTION: Record<MovementType, MovementDirection> = {
  PURCHASE_IN: 'IN',
  SALE_OUT: 'OUT',
  RETURN_IN: 'IN',
  RETURN_OUT: 'OUT',
  ADJUSTMENT_IN: 'IN',
  ADJUSTMENT_OUT: 'OUT',
  TRANSFER_IN: 'IN',
  TRANSFER_OUT: 'OUT',
  DAMAGE_OUT: 'OUT',
  LOSS_OUT: 'OUT',
  OPENING_BALANCE: 'IN',
};

// Requêtes préparées
const stmtInsert = db.prepare(`
  INSERT INTO stock_movements
    (id, product_id, type, movement_type, quantity, unit_price, date, reference_doc, document_id, supplier_id, notes)
  VALUES
    (@id, @product_id, @type, @movement_type, @quantity, @unit_price, @date, @reference_doc, @document_id, @supplier_id, @notes)
`);

const stmtGetStock = db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN type = 'IN' THEN quantity ELSE -quantity END), 0) AS total
  FROM stock_movements WHERE product_id = ?
`);

const stmtGetProduct = db.prepare('SELECT reference, designation FROM products WHERE id = ?');

export const StockLedgerService = {
  /** Niveau de stock actuel d'un produit. */
  getStockLevel(productId: string): number {
    const row = stmtGetStock.get(productId) as { total: number } | undefined;
    return Number(row?.total ?? 0);
  },

  /**
   * Coût moyen pondéré (CMUP) d'un produit (§16).
   *
   * CMUP = Σ(quantité_entrée × prix_unitaire_entrée) / Σ(quantité_entrée)
   * Seules les entrées valorisantes sont comptées : PURCHASE_IN, RETURN_IN,
   * OPENING_BALANCE, ADJUSTMENT_IN, TRANSFER_IN. Les sorties (SALE_OUT, etc.)
   * ne modifient pas le coût moyen : la marge historique reste stable.
   */
  getAverageCost(productId: string): number {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'IN' THEN quantity * unit_price ELSE 0 END), 0) AS total_value,
        COALESCE(SUM(CASE WHEN type = 'IN' THEN quantity ELSE 0 END), 0) AS total_qty
      FROM stock_movements
      WHERE product_id = ?
    `).get(productId) as { total_value: number; total_qty: number } | undefined;

    const value = Number(row?.total_value ?? 0);
    const qty = Number(row?.total_qty ?? 0);
    if (qty <= 0) {
      const fallback = db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(productId) as { purchase_price: number } | undefined;
      return Number(fallback?.purchase_price ?? 0);
    }
    return value / qty;
  },

  /**
   * Valorisation du stock au CMUP : Σ(stock physique × coût moyen),
   * sur les produits actifs uniquement.
   */
  getStockValue(): number {
    const rows = db.prepare(`
      SELECT p.id,
        COALESCE(SUM(CASE WHEN sm.type = 'IN' THEN sm.quantity ELSE -sm.quantity END), 0) AS stock
      FROM products p
      LEFT JOIN stock_movements sm ON sm.product_id = p.id
      WHERE p.status = 'ACTIVE'
      GROUP BY p.id
      HAVING stock > 0
    `).all() as Array<{ id: string; stock: number }>;

    let total = 0;
    for (const row of rows) {
      total += Number(row.stock) * this.getAverageCost(row.id);
    }
    return total;
  },

  /** Historique des mouvements d'un produit. */
  getHistory(productId: string, limit = 200, offset = 0): StockMovementRow[] {
    return db.prepare(`
      SELECT * FROM stock_movements
      WHERE product_id = ?
      ORDER BY date DESC
      LIMIT ? OFFSET ?
    `).all(productId, limit, offset) as StockMovementRow[];
  },

  /** Historique global (avec référence produit). */
  getAllHistory(limit = 500, offset = 0): Array<StockMovementRow & { product_ref?: string; product_name?: string }> {
    return db.prepare(`
      SELECT sm.*, p.reference AS product_ref, p.designation AS product_name
      FROM stock_movements sm
      LEFT JOIN products p ON p.id = sm.product_id
      ORDER BY sm.date DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as any[];
  },

  /**
   * Enregistre un mouvement de stock. Point d'entrée UNIQUE pour toutes les écritures.
   *
   * Garanties :
   *  - quantité > 0 (sinon erreur)
   *  - produit existant (sinon erreur)
   *  - pour une sortie : stock suffisant (sinon erreur)
   *  - atomique : inséré dans une transaction SQLite
   */
  recordMovement(input: MovementInput): StockMovementRow {
    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Quantité invalide : le mouvement doit avoir une quantité supérieure à 0.');
    }

    const direction = MOVEMENT_DIRECTION[input.movement_type];
    if (!direction) {
      throw new Error(`Type de mouvement inconnu : ${input.movement_type}`);
    }

    return runInTransaction(() => {
      const product = stmtGetProduct.get(input.product_id) as { reference: string; designation: string } | undefined;
      if (!product) {
        throw new Error('Produit introuvable : impossible de créer un mouvement de stock.');
      }

      // Vérification du stock pour les sorties
      if (direction === 'OUT') {
        const current = this.getStockLevel(input.product_id);
        if (current < quantity) {
          throw new Error(
            `Stock insuffisant pour "${product.reference} (${product.designation})" : ` +
            `demandé ${quantity}, disponible ${current}.`
          );
        }
      }

      const movement: StockMovementRow = {
        id: randomUUID(),
        product_id: input.product_id,
        type: direction,
        movement_type: input.movement_type,
        quantity,
        unit_price: Number(input.unit_price ?? 0),
        date: input.date ?? new Date().toISOString(),
        reference_doc: input.reference_doc,
        document_id: input.document_id,
        supplier_id: input.supplier_id,
        notes: input.notes,
      };

      stmtInsert.run({
        id: movement.id,
        product_id: movement.product_id,
        type: movement.type,
        movement_type: movement.movement_type,
        quantity: movement.quantity,
        unit_price: movement.unit_price,
        date: movement.date,
        reference_doc: movement.reference_doc ?? null,
        document_id: movement.document_id ?? null,
        supplier_id: movement.supplier_id ?? null,
        notes: movement.notes ?? null,
      });

      return movement;
    });
  },

  /**
   * Ajustement d'inventaire directionnel.
   *
   *   Stock théorique = 100, comptage = 90  → ADJUSTMENT_OUT 10 → stock = 90
   *   Stock théorique = 100, comptage = 110 → ADJUSTMENT_IN  10 → stock = 110
   *
   * @returns le mouvement créé, ou null si aucun écart
   */
  adjustInventory(input: {
    product_id: string;
    actualCount: number;
    unit_price?: number;
    document_id?: string;
    notes?: string;
  }): StockMovementRow | null {
    const current = this.getStockLevel(input.product_id);
    const actual = Number(input.actualCount);
    if (!Number.isFinite(actual) || actual < 0) {
      throw new Error('Quantité comptée invalide.');
    }

    const difference = actual - current;
    if (difference === 0) return null;

    const isSurplus = difference > 0;
    return this.recordMovement({
      product_id: input.product_id,
      movement_type: isSurplus ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
      quantity: Math.abs(difference),
      unit_price: input.unit_price,
      document_id: input.document_id,
      notes: input.notes
        ? `${input.notes} — écart ${difference > 0 ? '+' : ''}${difference} (compté ${actual})`
        : `Inventaire : écart ${difference > 0 ? '+' : ''}${difference} (compté ${actual})`,
    });
  },

  /**
   * Transfert entre dépôts (atomique).
   * Si toProductId est renseigné, crée les deux mouvements
   * (TRANSFER_OUT côté source + TRANSFER_IN côté destination).
   */
  transfer(input: {
    from_product_id: string;
    to_product_id: string;
    quantity: number;
    notes?: string;
  }): { out: StockMovementRow; in: StockMovementRow } {
    return runInTransaction(() => {
      const out = this.recordMovement({
        product_id: input.from_product_id,
        movement_type: 'TRANSFER_OUT',
        quantity: input.quantity,
        notes: input.notes ?? 'Transfert entre dépôts',
      });
      const inMovement = this.recordMovement({
        product_id: input.to_product_id,
        movement_type: 'TRANSFER_IN',
        quantity: input.quantity,
        notes: input.notes ?? 'Transfert entre dépôts',
      });
      return { out, in: inMovement };
    });
  },
};
