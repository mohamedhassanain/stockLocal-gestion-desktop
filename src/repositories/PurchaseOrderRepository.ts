import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';
import { runInTransaction } from '../database/config/connection';

export interface PurchaseOrder {
  id: string;
  order_number: string;
  supplier_id: string;
  supplier_name?: string;
  date: string;
  expected_date: string | null;
  status: 'DRAFT' | 'CONFIRMED' | 'RECEIVED' | 'CANCELLED';
  total: number;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: string;
  product_ref?: string;
  product_name?: string;
  quantity: number;
  unit_price: number;
  received_qty: number;
  total: number;
}

// ─── Prepared Statements ──────────────────────────────────────────────────────

const stmtGetAll = db.prepare(`
  SELECT po.*, s.name AS supplier_name
  FROM purchase_orders po
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  ORDER BY po.date DESC
  LIMIT 500
`);

const stmtSearch = db.prepare(`
  SELECT po.*, s.name AS supplier_name
  FROM purchase_orders po
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  WHERE po.order_number LIKE ? OR s.name LIKE ?
  ORDER BY po.date DESC
  LIMIT 200
`);

const stmtGetById = db.prepare(`
  SELECT po.*, s.name AS supplier_name
  FROM purchase_orders po
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  WHERE po.id = ?
`);

const stmtGetItems = db.prepare(`
  SELECT poi.*, p.reference AS product_ref, p.designation AS product_name
  FROM purchase_order_items poi
  LEFT JOIN products p ON p.id = poi.product_id
  WHERE poi.purchase_order_id = ?
`);

const stmtInsertOrder = db.prepare(`
  INSERT INTO purchase_orders (id, order_number, supplier_id, date, expected_date, status, total, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtInsertItem = db.prepare(`
  INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_price, received_qty, total)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const stmtUpdateOrder = db.prepare(`
  UPDATE purchase_orders SET status = ?, total = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);

const stmtUpdateItemReceived = db.prepare(`
  UPDATE purchase_order_items SET received_qty = ? WHERE id = ?
`);

const stmtUpdateStatus = db.prepare(`
  UPDATE purchase_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);

const stmtDeleteOrder = db.prepare('DELETE FROM purchase_orders WHERE id = ?');

const stmtGetNextNumber = db.prepare(`
  SELECT COUNT(*) as cnt FROM purchase_orders WHERE strftime('%Y', date) = ?
`);

const stmtInsertMovement = db.prepare(`
  INSERT INTO stock_movements (id, product_id, type, quantity, unit_price, reference_doc, supplier_id, notes)
  VALUES (?, ?, 'IN', ?, ?, ?, ?, ?)
`);

// ─── Repository ──────────────────────────────────────────────────────────────

export const PurchaseOrderRepository = {
  generateNumber(): string {
    const year = new Date().getFullYear().toString();
    const result = stmtGetNextNumber.get(year) as { cnt: number };
    const seq = String(result.cnt + 1).padStart(5, '0');
    return `PA-${year}-${seq}`;
  },

  getAll(): PurchaseOrder[] {
    return stmtGetAll.all() as PurchaseOrder[];
  },

  search(query: string): PurchaseOrder[] {
    const q = `%${query}%`;
    return stmtSearch.all(q, q) as PurchaseOrder[];
  },

  getById(id: string): PurchaseOrder | undefined {
    const order = stmtGetById.get(id) as PurchaseOrder | undefined;
    if (order) {
      order.items = stmtGetItems.all(id) as PurchaseOrderItem[];
    }
    return order;
  },

  /**
   * Crée une commande d'achat avec ses lignes dans une transaction atomique.
   */
  create(data: {
    supplier_id: string;
    expected_date?: string;
    notes?: string;
    items: Array<{ product_id: string; quantity: number; unit_price: number }>;
  }): PurchaseOrder {
    const id = randomUUID();
    const order_number = this.generateNumber();
    const date = new Date().toISOString();

    let total = 0;
    for (const item of data.items) {
      total += item.quantity * item.unit_price;
    }

    const insertAll = db.transaction(() => {
      stmtInsertOrder.run(
        id, order_number, data.supplier_id, date,
        data.expected_date ?? null, 'DRAFT', total, data.notes ?? null
      );

      for (const item of data.items) {
        const itemTotal = item.quantity * item.unit_price;
        stmtInsertItem.run(
          randomUUID(), id, item.product_id,
          item.quantity, item.unit_price, 0, itemTotal
        );
      }
    });

    insertAll();
    return this.getById(id)!;
  },

  /**
   * Passe une commande de DRAFT → CONFIRMED.
   */
  confirm(id: string): PurchaseOrder {
    const order = this.getById(id);
    if (!order) throw new Error('Commande introuvable.');
    if (order.status !== 'DRAFT') throw new Error('Seules les commandes en brouillon peuvent être confirmées.');
    stmtUpdateStatus.run('CONFIRMED', id);
    return this.getById(id)!;
  },

  /**
   * Réceptionne les produits d'une commande :
   * - Met à jour received_qty pour chaque ligne
   * - Crée les entrées de stock
   * - Passe le statut à RECEIVED
   */
  receive(id: string, receivedItems?: Array<{ item_id: string; received_qty: number }>): PurchaseOrder {
    return runInTransaction(() => {
      const order = this.getById(id);
      if (!order) throw new Error('Commande introuvable.');
      if (order.status !== 'CONFIRMED') throw new Error('Seules les commandes confirmées peuvent être réceptionnées.');

      const items = order.items ?? [];

      // Si des quantités spécifiques sont fournies, les utiliser, sinon réceptionner tout
      for (const item of items) {
        const received = receivedItems?.find(ri => ri.item_id === item.id);
        const qtyToReceive = received ? received.received_qty : item.quantity;

        if (qtyToReceive > 0) {
          // Mettre à jour la quantité reçue
          stmtUpdateItemReceived.run(qtyToReceive, item.id);

          // Créer l'entrée de stock si pas déjà réceptionné
          if (item.received_qty === 0 && qtyToReceive > 0) {
            stmtInsertMovement.run(
              randomUUID(), item.product_id, qtyToReceive, item.unit_price,
              order.order_number, order.supplier_id,
              `Réception commande ${order.order_number}`
            );
          }
        }
      }

      // Recalculer le total
      let total = 0;
      const updatedItems = stmtGetItems.all(id) as PurchaseOrderItem[];
      for (const item of updatedItems) {
        total += item.received_qty * item.unit_price;
      }

      // Vérifier si tout est reçu
      const allReceived = updatedItems.every(i => i.received_qty >= i.quantity);
      const anyReceived = updatedItems.some(i => i.received_qty > 0);

      const newStatus = allReceived ? 'RECEIVED' : anyReceived ? 'CONFIRMED' : 'CONFIRMED';
      stmtUpdateOrder.run(newStatus, total, id);

      return this.getById(id)!;
    });
  },

  /**
   * Annule une commande.
   */
  cancel(id: string): PurchaseOrder {
    const order = this.getById(id);
    if (!order) throw new Error('Commande introuvable.');
    if (order.status === 'CANCELLED') throw new Error('Cette commande est déjà annulée.');
    if (order.status === 'RECEIVED') throw new Error('Une commande déjà réceptionnée ne peut pas être annulée.');
    stmtUpdateStatus.run('CANCELLED', id);
    return this.getById(id)!;
  },

  remove(id: string): void {
    const order = this.getById(id);
    if (!order) throw new Error('Commande introuvable.');
    if (order.status !== 'DRAFT') throw new Error('Seules les commandes en brouillon peuvent être supprimées.');
    stmtDeleteOrder.run(id);
  }
};
