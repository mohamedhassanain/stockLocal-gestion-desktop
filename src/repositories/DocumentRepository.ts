import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

export type DocumentType = 'QUOTE' | 'DELIVERY_NOTE' | 'INVOICE' | 'CREDIT_NOTE';
export type DocumentStatus = 'DRAFT' | 'PAID' | 'UNPAID' | 'PARTIAL' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'CHECK' | 'TRANSFER';

export interface DocumentItem {
  id: string;
  document_id: string;
  product_id: string;
  product_ref?: string;
  product_name?: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
}

export interface Document {
  id: string;
  type: DocumentType;
  document_number: string;
  entity_id: string;           // customer_id
  customer_name?: string;
  date: string;
  due_date?: string;
  total_excl_tax: number;
  total_incl_tax: number;
  status: DocumentStatus;
  notes?: string;
  created_at?: string;
  updated_at?: string;
  items?: DocumentItem[];
  amount_paid?: number;
}

export interface Payment {
  id: string;
  document_id: string;
  amount: number;
  payment_method: PaymentMethod;
  date: string;
  reference?: string;
}

// ─── Requêtes préparées ───────────────────────────────────────────────────────

const stmtGetAll = db.prepare<[string]>(`
  SELECT d.*, c.name AS customer_name,
    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.document_id = d.id), 0) AS amount_paid
  FROM documents d
  LEFT JOIN customers c ON c.id = d.entity_id
  WHERE d.type = ?
  ORDER BY d.date DESC
  LIMIT 500
`);

const stmtSearch = db.prepare<[string, string, string]>(`
  SELECT d.*, c.name AS customer_name,
    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.document_id = d.id), 0) AS amount_paid
  FROM documents d
  LEFT JOIN customers c ON c.id = d.entity_id
  WHERE d.type = ? AND (c.name LIKE ? OR d.document_number LIKE ?)
  ORDER BY d.date DESC
  LIMIT 200
`);

const stmtGetById = db.prepare<[string]>(`
  SELECT d.*, c.name AS customer_name,
    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.document_id = d.id), 0) AS amount_paid
  FROM documents d
  LEFT JOIN customers c ON c.id = d.entity_id
  WHERE d.id = ?
`);

const stmtGetItems = db.prepare<[string]>(`
  SELECT di.*, p.reference AS product_ref, p.designation AS product_name
  FROM document_items di
  LEFT JOIN products p ON p.id = di.product_id
  WHERE di.document_id = ?
`);

const stmtGetPayments = db.prepare<[string]>(`
  SELECT * FROM payments WHERE document_id = ? ORDER BY date DESC
`);

const stmtInsertDoc = db.prepare<[string, string, string, string, string, string | null, number, number, string, string | null]>(`
  INSERT INTO documents (id, type, document_number, entity_id, date, due_date, total_excl_tax, total_incl_tax, status, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtInsertItem = db.prepare<[string, string, string, number, number, number, number]>(`
  INSERT INTO document_items (id, document_id, product_id, quantity, unit_price, discount, total)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const stmtUpdateStatus = db.prepare<[string, string]>(`
  UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);

const stmtInsertPayment = db.prepare<[string, string, number, string, string, string | null]>(`
  INSERT INTO payments (id, document_id, amount, payment_method, date, reference)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtGetNextNumber = db.prepare<[string, string]>(`
  SELECT COUNT(*) as cnt FROM documents WHERE type = ? AND strftime('%Y', date) = ?
`);

// ─── Repository ───────────────────────────────────────────────────────────────

export const DocumentRepository = {
  generateNumber(type: DocumentType): string {
    const year = new Date().getFullYear().toString();
    const prefixes: Record<DocumentType, string> = {
      QUOTE: 'DEV',
      DELIVERY_NOTE: 'BL',
      INVOICE: 'FAC',
      CREDIT_NOTE: 'AV'
    };
    const result = stmtGetNextNumber.get(type, year) as { cnt: number };
    const seq = String(result.cnt + 1).padStart(5, '0');
    return `${prefixes[type]}-${year}-${seq}`;
  },

  getAll(type: DocumentType): Document[] {
    return stmtGetAll.all(type) as Document[];
  },

  search(type: DocumentType, query: string): Document[] {
    const q = `%${query}%`;
    return stmtSearch.all(type, q, q) as Document[];
  },

  getById(id: string): Document | undefined {
    const doc = stmtGetById.get(id) as Document | undefined;
    if (doc) {
      doc.items = stmtGetItems.all(id) as DocumentItem[];
    }
    return doc;
  },

  create(data: {
    type: DocumentType;
    entity_id: string;
    date: string;
    due_date?: string;
    items: Array<{ product_id: string; quantity: number; unit_price: number; discount: number }>;
    notes?: string;
  }): Document {
    const id = randomUUID();
    const document_number = this.generateNumber(data.type);

    // Calcul des totaux
    let total_excl_tax = 0;
    for (const item of data.items) {
      const lineTotal = item.quantity * item.unit_price * (1 - item.discount / 100);
      total_excl_tax += lineTotal;
    }
    const total_incl_tax = total_excl_tax; // TVA non applicable en V1

    const insertAll = db.transaction(() => {
      stmtInsertDoc.run(
        id, data.type, document_number, data.entity_id,
        data.date, data.due_date ?? null,
        total_excl_tax, total_incl_tax,
        'UNPAID', data.notes ?? null
      );

      for (const item of data.items) {
        const lineTotal = item.quantity * item.unit_price * (1 - item.discount / 100);
        stmtInsertItem.run(
          randomUUID(), id, item.product_id,
          item.quantity, item.unit_price, item.discount, lineTotal
        );
      }
    });

    insertAll();
    return this.getById(id)!;
  },

  addPayment(data: { document_id: string; amount: number; payment_method: PaymentMethod; reference?: string }): void {
    const payId = randomUUID();
    stmtInsertPayment.run(payId, data.document_id, data.amount, data.payment_method, new Date().toISOString(), data.reference ?? null);

    // Recalculer le statut
    const doc = stmtGetById.get(data.document_id) as Document;
    const paidResult = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE document_id = ?`).get(data.document_id) as { total: number };
    const paid = paidResult.total;

    let newStatus: DocumentStatus = 'UNPAID';
    if (paid >= doc.total_incl_tax) newStatus = 'PAID';
    else if (paid > 0) newStatus = 'PARTIAL';

    stmtUpdateStatus.run(newStatus, data.document_id);
  },

  getPayments(documentId: string): Payment[] {
    return stmtGetPayments.all(documentId) as Payment[];
  },

  // Conversion BL → Facture
  convertToInvoice(deliveryNoteId: string): Document {
    const bl = this.getById(deliveryNoteId);
    if (!bl) throw new Error('Bon de livraison introuvable.');
    if (bl.type !== 'DELIVERY_NOTE') throw new Error('Ce document n\'est pas un bon de livraison.');

    return this.create({
      type: 'INVOICE',
      entity_id: bl.entity_id,
      date: new Date().toISOString().split('T')[0],
      items: (bl.items ?? []).map(i => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        discount: i.discount
      })),
      notes: `Converti depuis ${bl.document_number}`
    });
  }
};
