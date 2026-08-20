import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';
import { runInTransaction } from '../database/config/connection';
import { StockLedgerService } from '../services/StockLedgerService';

export interface InventorySession {
  id: string;
  name: string;
  status: 'DRAFT' | 'COMPTAGE' | 'CALCUL' | 'VALIDATION';
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
  items?: InventoryItem[];
  summary?: { total_products: number; counted: number; discrepancies: number };
}

export interface InventoryItem {
  id: string;
  session_id: string;
  product_id: string;
  product_ref?: string;
  product_name?: string;
  unit?: string;
  expected_qty: number;
  counted_qty: number | null;
  difference: number | null;
  status: 'PENDING' | 'COUNTED' | 'ADJUSTED';
  created_at?: string;
}

// ─── Prepared Statements ──────────────────────────────────────────────────────

const stmtGetAll = db.prepare('SELECT * FROM inventory_sessions ORDER BY created_at DESC LIMIT 100');

const stmtGetById = db.prepare('SELECT * FROM inventory_sessions WHERE id = ?');

const stmtGetItems = db.prepare(`
  SELECT ii.*, p.reference AS product_ref, p.designation AS product_name, p.unit AS unit
  FROM inventory_items ii
  LEFT JOIN products p ON p.id = ii.product_id
  WHERE ii.session_id = ?
  ORDER BY p.designation ASC
`);

const stmtInsertSession = db.prepare(`
  INSERT INTO inventory_sessions (id, name, status, notes)
  VALUES (?, ?, ?, ?)
`);

const stmtInsertItem = db.prepare(`
  INSERT INTO inventory_items (id, session_id, product_id, expected_qty, status)
  VALUES (?, ?, ?, ?, 'PENDING')
`);

const stmtUpdateStatus = db.prepare(`
  UPDATE inventory_sessions SET status = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);

const stmtUpdateCountedQty = db.prepare(`
  UPDATE inventory_items SET counted_qty = ?, difference = ? - ?, status = 'COUNTED' WHERE id = ?
`);

const stmtUpdateItemStatus = db.prepare(`
  UPDATE inventory_items SET status = ? WHERE id = ?
`);

const stmtDeleteSession = db.prepare('DELETE FROM inventory_sessions WHERE id = ?');

const stmtGetStockLevel = db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN type IN ('IN','INVENTORY') THEN quantity ELSE -quantity END), 0) AS total
  FROM stock_movements WHERE product_id = ?
`);

const stmtGetActiveProducts = db.prepare(`
  SELECT id, reference, designation, purchase_price, unit FROM products WHERE status = 'ACTIVE' ORDER BY designation ASC
`);

// ─── Repository ──────────────────────────────────────────────────────────────

export const InventorySessionRepository = {
  getAll(): InventorySession[] {
    return stmtGetAll.all() as InventorySession[];
  },

  getById(id: string): InventorySession | undefined {
    const session = stmtGetById.get(id) as InventorySession | undefined;
    if (session) {
      session.items = stmtGetItems.all(id) as InventoryItem[];
      const items = session.items;
      session.summary = {
        total_products: items.length,
        counted: items.filter(i => i.counted_qty !== null).length,
        discrepancies: items.filter(i => i.difference !== null && i.difference !== 0).length,
      };
    }
    return session;
  },

  /**
   * Crée une session d'inventaire en peuplant tous les produits actifs
   * avec leur stock attendu actuel.
   */
  create(data: { name: string; notes?: string }): InventorySession {
    const id = randomUUID();
    const insertAll = db.transaction(() => {
      stmtInsertSession.run(id, data.name, 'DRAFT', data.notes ?? null);

      const products = stmtGetActiveProducts.all() as Array<{
        id: string; reference: string; designation: string; purchase_price: number; unit: string;
      }>;

      for (const p of products) {
        const level = stmtGetStockLevel.get(p.id) as { total: number };
        stmtInsertItem.run(randomUUID(), id, p.id, level.total ?? 0);
      }
    });

    insertAll();
    return this.getById(id)!;
  },

  /**
   * Passe la session en mode COMPTAGE (permet l'entrée des quantités comptées).
   */
  startCounting(id: string): InventorySession {
    const session = stmtGetById.get(id) as InventorySession | undefined;
    if (!session) throw new Error('Session d\'inventaire introuvable.');
    if (session.status !== 'DRAFT') throw new Error('Seul un brouillon peut passer en mode comptage.');
    stmtUpdateStatus.run('COMPTAGE', null, id);
    return this.getById(id)!;
  },

  /**
   * Enregistre le comptage d'un article.
   * @param countedQty quantité physiquement comptée (>= 0)
   */
  countItem(itemId: string, countedQty: number): void {
    const qty = Number(countedQty);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new Error('Quantité comptée invalide : doit être un nombre positif ou zéro.');
    }

    const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId) as InventoryItem | undefined;
    if (!item) throw new Error('Article d\'inventaire introuvable.');

    const session = stmtGetById.get(item.session_id) as InventorySession | undefined;
    if (!session || session.status !== 'COMPTAGE') {
      throw new Error('Le comptage n\'est autorisé que pendant la phase de comptage.');
    }

    // placeholders : counted_qty = ? ; difference = ? - ? ; WHERE id = ?
    stmtUpdateCountedQty.run(qty, qty, item.expected_qty ?? 0, itemId);
  },

  /**
   * Passe la session en mode CALCUL (montre les écarts).
   */
  calculateGaps(id: string): InventorySession {
    const session = stmtGetById.get(id) as InventorySession | undefined;
    if (!session) throw new Error('Session d\'inventaire introuvable.');
    if (session.status !== 'COMPTAGE') throw new Error('La session doit être en mode comptage.');
    const items = stmtGetItems.all(id) as InventoryItem[];
    const uncounted = items.filter(i => i.counted_qty === null);
    if (uncounted.length > 0) {
      throw new Error(`${uncounted.length} article(s) non compté(s). Veuillez terminer le comptage.`);
    }
    stmtUpdateStatus.run('CALCUL', null, id);
    return this.getById(id)!;
  },

  /**
   * Valide l'inventaire : applique les ajustements de stock via le StockLedgerService.
   *
   * Chaque écart est appliqué avec un mouvement explicite :
   *   écart positif (surplus) → ADJUSTMENT_IN
   *   écart négatif (manque) → ADJUSTMENT_OUT
   *
   * La validation est idempotente : une session déjà validée ne peut pas l'être deux fois.
   */
  validate(id: string): InventorySession {
    return runInTransaction(() => {
      const session = stmtGetById.get(id) as InventorySession | undefined;
      if (!session) throw new Error('Session d\'inventaire introuvable.');
      if (session.status === 'VALIDATION') throw new Error('Cette session d\'inventaire a déjà été validée.');
      if (session.status !== 'CALCUL') throw new Error('La session doit être en mode calcul.');

      const items = stmtGetItems.all(id) as InventoryItem[];

      for (const item of items) {
        if (item.counted_qty === null || item.difference === null || item.difference === 0) continue;

        const product = db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(item.product_id) as { purchase_price: number } | undefined;
        const price = product?.purchase_price ?? 0;
        const sessionName = session.name;

        // Écriture via le moteur central (atomique, traçable, signe correct)
        StockLedgerService.adjustInventory({
          product_id: item.product_id,
          actualCount: item.counted_qty,
          unit_price: price,
          document_id: id,
          notes: `INVENTAIRE — ${sessionName}`,
        });

        stmtUpdateItemStatus.run('ADJUSTED', item.id);
      }

      stmtUpdateStatus.run('VALIDATION', new Date().toISOString(), id);
      return this.getById(id)!;
    });
  },

  remove(id: string): void {
    const session = stmtGetById.get(id) as InventorySession | undefined;
    if (!session) throw new Error('Session d\'inventaire introuvable.');
    if (session.status === 'VALIDATION') throw new Error('Une session validée ne peut pas être supprimée.');
    stmtDeleteSession.run(id);
  }
};
