import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

// ─── Prepared statements pour le stock ────────────────────────────────────────

const stmtGetStockLevel = db.prepare(`
  SELECT 
    COALESCE(SUM(CASE WHEN type IN ('IN', 'INVENTORY') THEN quantity ELSE 0 END), 0) - 
    COALESCE(SUM(CASE WHEN type = 'OUT' THEN quantity ELSE 0 END), 0) as total_stock
  FROM stock_movements 
  WHERE product_id = ?
`);

const stmtInsertMovement = db.prepare(`
  INSERT INTO stock_movements (id, product_id, type, quantity, unit_price, reference_doc, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const stmtGetProductRef = db.prepare(`
  SELECT reference, designation FROM products WHERE id = ?
`);

// ─── Helper: vérifier et décrémenter le stock dans une transaction ────────────

function decrementStockForItems(
  items: Array<{ product_id: string; quantity: number; unit_price: number }>,
  documentNumber: string,
): void {
  for (const item of items) {
    const stockResult = stmtGetStockLevel.get(item.product_id) as { total_stock: number };
    const currentStock = stockResult?.total_stock ?? 0;
    if (currentStock < item.quantity) {
    const prod = stmtGetProductRef.get(item.product_id) as { reference: string; designation: string } | undefined;
    const label = prod ? `${prod.reference} (${prod.designation})` : item.product_id;
      throw new Error(
        `Stock insuffisant pour "${label}" : demandé ${item.quantity}, disponible ${currentStock}.`
      );
    }
    const movementId = randomUUID();
    stmtInsertMovement.run(
      movementId,
      item.product_id,
      'OUT',
      item.quantity,
      item.unit_price,
      documentNumber,
      `VENTE — ${documentNumber}`
    );
  }
}

function incrementStockForReturns(
  items: Array<{ product_id: string; quantity: number; unit_price: number }>,
  documentNumber: string,
): void {
  for (const item of items) {
    const movementId = randomUUID();
    stmtInsertMovement.run(
      movementId,
      item.product_id,
      'IN',
      item.quantity,
      Math.abs(item.unit_price),
      documentNumber,
      `RETOUR_CLIENT — ${documentNumber}`
    );
  }
}

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

  /**
   * Crée un document. Si manageStock=true, le stock est vérifié et décrémenté
   * atomiquement dans la même transaction SQLite (INVOICE / DELIVERY_NOTE).
   */
  create(data: {
    type: DocumentType;
    entity_id: string;
    date: string;
    due_date?: string;
    items: Array<{ product_id: string; quantity: number; unit_price: number; discount: number }>;
    notes?: string;
    manageStock?: boolean;
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
      // 1. Décrémenter le stock si demandé (avant l'insertion du document pour que le
      //    ROLLBACK restore le stock en cas d'erreur)
      if (data.manageStock && (data.type === 'INVOICE' || data.type === 'DELIVERY_NOTE')) {
        decrementStockForItems(data.items, document_number);
      }

      // 2. Créer le document
      stmtInsertDoc.run(
        id, data.type, document_number, data.entity_id,
        data.date, data.due_date ?? null,
        total_excl_tax, total_incl_tax,
        'UNPAID', data.notes ?? null
      );

      // 3. Créer les lignes
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

  /**
   * Crée un avoir (partiel ou total) et réinjecte le stock correspondant
   * dans une transaction atomique.
   */
  createCreditNote(data: {
    original_invoice_id: string;
    entity_id: string;
    date: string;
    return_items: Array<{ product_id: string; quantity: number; unit_price: number; discount: number }>;
    reason?: string;
  }): Document {
    const id = randomUUID();
    const document_number = this.generateNumber('CREDIT_NOTE');

    // Calcul des totaux (valeurs négatives = retour)
    let total_excl_tax = 0;
    for (const item of data.return_items) {
      const lineTotal = item.quantity * Math.abs(item.unit_price) * (1 - item.discount / 100);
      total_excl_tax += lineTotal;
    }
    const total_incl_tax = total_excl_tax;

    const notes = data.reason
      ? `Avoir pour facture — ${data.reason}`
      : 'Avoir — retour marchandise';

    const insertAll = db.transaction(() => {
      // 1. Réinjecter le stock (IN) pour les produits retournés
      incrementStockForReturns(data.return_items, document_number);

      // 2. Créer le document avoir
      stmtInsertDoc.run(
        id, 'CREDIT_NOTE', document_number, data.entity_id,
        data.date, null,
        total_excl_tax, total_incl_tax,
        'PAID', notes
      );

      // 3. Créer les lignes (quantités positives, montants négatifs pour refléter le crédit)
      for (const item of data.return_items) {
        const lineTotal = item.quantity * Math.abs(item.unit_price) * (1 - item.discount / 100);
        stmtInsertItem.run(
          randomUUID(), id, item.product_id,
          item.quantity, -Math.abs(item.unit_price), item.discount, -lineTotal
        );
      }

      // 4. Si c'est un retour partiel, ne PAS annuler la facture originale
      //    Si c'est un retour total, annuler la facture originale
      const originalInvoice = stmtGetById.get(data.original_invoice_id) as Document | undefined;
      if (originalInvoice) {
        const originalItems = stmtGetItems.all(data.original_invoice_id) as DocumentItem[];
        const allReturned = data.return_items.every(ri => {
          const orig = originalItems.find(oi => oi.product_id === ri.product_id);
          return orig && ri.quantity >= orig.quantity;
        });
        if (allReturned) {
          stmtUpdateStatus.run('CANCELLED', data.original_invoice_id);
        } else {
          // Partiel : la facture reste ACTIVE mais on note le retour
          // On ne change pas le statut — il reste UNPAID/PARTIAL/PAID
        }
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

  // Annulation d'un document (pour la création d'avoir)
  cancelDocument(documentId: string): void {
    db.prepare(`UPDATE documents SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(documentId);
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
