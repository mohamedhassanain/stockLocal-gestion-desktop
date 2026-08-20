import { db, runInTransaction } from '../database/config/connection';
import { randomUUID } from 'crypto';
import { StockLedgerService } from '../services/StockLedgerService';

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
  vat_rate: number;
}

export interface Document {
  id: string;
  type: DocumentType;
  document_number: string;
  entity_id: string;           // customer_id
  original_document_id?: string | null;
  customer_name?: string;
  date: string;
  due_date?: string;
  total_excl_tax: number;
  total_tax: number;
  total_incl_tax: number;
  discount_amount: number;
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

/** Paiement enrichi pour le registre (Caisse / Paiements) : document + client. */
export interface PaymentRecord {
  id: string;
  document_id: string;
  amount: number;
  payment_method: PaymentMethod;
  date: string;
  reference?: string;
  document_number: string;
  document_type: DocumentType;
  customer_name?: string;
}

interface ItemInput {
  product_id: string;
  quantity: number;
  unit_price: number;
  discount: number;
}

// ─── Requêtes préparées ───────────────────────────────────────────────────────

const stmtGetAll = db.prepare<[string, number, number]>(`
  SELECT d.*, c.name AS customer_name,
    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.document_id = d.id), 0) AS amount_paid
  FROM documents d
  LEFT JOIN customers c ON c.id = d.entity_id
  WHERE d.type = ?
  ORDER BY d.date DESC
  LIMIT ? OFFSET ?
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

const stmtInsertDoc = db.prepare<[string, string, string, string, string | null, string, string | null, number, number, number, number, string, string | null]>(`
  INSERT INTO documents (id, type, document_number, entity_id, original_document_id, date, due_date, total_excl_tax, total_tax, total_incl_tax, discount_amount, status, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtInsertItem = db.prepare<[string, string, string, number, number, number, number, number]>(`
  INSERT INTO document_items (id, document_id, product_id, quantity, unit_price, discount, total, vat_rate)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

const stmtGetProductVat = db.prepare('SELECT vat_rate FROM products WHERE id = ?');

const stmtGetReturnedQty = db.prepare(`
  SELECT COALESCE(SUM(quantity), 0) AS returned
  FROM credit_note_refs
  WHERE original_document_id = ? AND product_id = ?
`);

const stmtInsertCreditRef = db.prepare(`
  INSERT INTO credit_note_refs (id, credit_note_id, original_document_id, product_id, quantity)
  VALUES (?, ?, ?, ?, ?)
`);

const stmtInsertClientCredit = db.prepare(`
  INSERT INTO client_credits (id, customer_id, type, amount, description, date)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtGetPaidTotal = db.prepare(`
  SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE document_id = ?
`);

const stmtGetAllPayments = db.prepare<[number, number]>(`
  SELECT p.id, p.document_id, p.amount, p.payment_method, p.date, p.reference,
    d.document_number, d.type AS document_type, c.name AS customer_name
  FROM payments p
  JOIN documents d ON d.id = p.document_id
  LEFT JOIN customers c ON c.id = d.entity_id
  ORDER BY p.date DESC
  LIMIT ? OFFSET ?
`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Calcule les totaux d'une ligne (TVA incluse dans total_incl_tax). */
function computeLineTotals(item: ItemInput, vatRate: number): { lineExclTax: number; lineTax: number; lineInclTax: number } {
  const base = item.quantity * item.unit_price * (1 - item.discount / 100);
  const lineExclTax = round2(base);
  const lineTax = round2(base * vatRate / 100);
  return { lineExclTax, lineTax, lineInclTax: round2(lineExclTax + lineTax) };
}

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

  getAll(type: DocumentType, limit = 100, offset = 0): Document[] {
    return stmtGetAll.all(type, limit, offset) as Document[];
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
   * Crée un document (facture, BL, devis, avoir).
   *
   * - Les totaux sont calculés avec TVA ligne par ligne (vat_rate figé au moment de la vente) :
   *     sous-total − remise = total HT  →  + TVA = total TTC
   * - Si manageStock=true et type INVOICE/DELIVERY_NOTE, le stock est vérifié et décrémenté
   *   via le StockLedgerService (SALE_OUT) dans la même transaction.
   */
  create(data: {
    type: DocumentType;
    entity_id: string;
    date: string;
    due_date?: string;
    items: ItemInput[];
    notes?: string;
    manageStock?: boolean;
  }): Document {
    const id = randomUUID();
    const document_number = this.generateNumber(data.type);

    // Calcul des totaux avec TVA
    let totalExclTax = 0;
    let totalTax = 0;
    let totalInclTax = 0;
    let discountAmount = 0;

    const itemTotals = data.items.map(item => {
      const vatRow = stmtGetProductVat.get(item.product_id) as { vat_rate: number } | undefined;
      const vatRate = Number(vatRow?.vat_rate ?? 20);
      const totals = computeLineTotals(item, vatRate);
      totalExclTax += totals.lineExclTax;
      totalTax += totals.lineTax;
      totalInclTax += totals.lineInclTax;
      discountAmount += item.quantity * item.unit_price * (item.discount / 100);
      return { vatRate, totals };
    });

    totalExclTax = round2(totalExclTax);
    totalTax = round2(totalTax);
    totalInclTax = round2(totalInclTax);
    discountAmount = round2(discountAmount);

    const insertAll = db.transaction(() => {
      // 1. Décrémenter le stock si demandé (avant insertion du document pour ROLLBACK propre)
      if (data.manageStock && (data.type === 'INVOICE' || data.type === 'DELIVERY_NOTE')) {
        for (let i = 0; i < data.items.length; i++) {
          const item = data.items[i];
          StockLedgerService.recordMovement({
            product_id: item.product_id,
            movement_type: 'SALE_OUT',
            quantity: item.quantity,
            unit_price: item.unit_price,
            reference_doc: document_number,
            document_id: id,
            notes: `${data.type === 'INVOICE' ? 'VENTE' : 'LIVRAISON'} — ${document_number}`,
          });
        }
      }

      // 2. Créer le document
      stmtInsertDoc.run(
        id, data.type, document_number, data.entity_id,
        null, // original_document_id
        data.date, data.due_date ?? null,
        totalExclTax, totalTax, totalInclTax, discountAmount,
        'UNPAID', data.notes ?? null
      );

      // 3. Créer les lignes
      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        const vatRate = itemTotals[i].vatRate;
        stmtInsertItem.run(
          randomUUID(), id, item.product_id,
          item.quantity, item.unit_price, item.discount,
          itemTotals[i].totals.lineExclTax, vatRate
        );
      }
    });

    insertAll();
    return this.getById(id)!;
  },

  /**
   * Crée un avoir (partiel ou total).
   *
   * Protection anti sur-retour :
   *   - la quantité retournée (cumulée sur tous les avoirs précédents) + la nouvelle quantité
   *     ne peut jamais dépasser la quantité facturée initialement.
   *   - application au stock : RETURN_IN via le StockLedgerService.
   *   - impact crédit client : une écriture PAYMENT (réduction de solde) est enregistrée.
   *   - `original_document_id` relie l'avoir à sa facture source.
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

    let totalExclTax = 0;
    let totalTax = 0;
    let totalInclTax = 0;
    const itemTotals = data.return_items.map(item => {
      const vatRow = stmtGetProductVat.get(item.product_id) as { vat_rate: number } | undefined;
      const vatRate = Number(vatRow?.vat_rate ?? 20);
      const totals = computeLineTotals(item, vatRate);
      totalExclTax += totals.lineExclTax;
      totalTax += totals.lineTax;
      totalInclTax += totals.lineInclTax;
      return { vatRate, totals };
    });

    totalExclTax = round2(totalExclTax);
    totalTax = round2(totalTax);
    totalInclTax = round2(totalInclTax);

    const notes = data.reason
      ? `Avoir pour facture — ${data.reason}`
      : 'Avoir — retour marchandise';

    const insertAll = db.transaction(() => {
      // 1. Vérifier la quantité retournable (anti sur-retour) et créer l'avoir
      for (const item of data.return_items) {
        const qty = Number(item.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error('Quantité retournée invalide.');
        }

        // Quantité déjà retournée sur cette facture
        const returnedRow = stmtGetReturnedQty.get(data.original_invoice_id, item.product_id) as { returned: number };
        const alreadyReturned = Number(returnedRow?.returned ?? 0);

        // Quantité facturée à l'origine
        const originalItem = this.getById(data.original_invoice_id)?.items?.find(ii => ii.product_id === item.product_id);
        const originalQty = originalItem?.quantity ?? 0;

        if (alreadyReturned + qty > originalQty) {
          const remaining = Math.max(0, originalQty - alreadyReturned);
          throw new Error(
            `Retour refusé : il ne reste que ${remaining} unité(s) retournable(s) pour ce produit ` +
            `(déjà retourné : ${alreadyReturned}, demandé : ${qty}).`
          );
        }

        // 2. Enregistrer la référence pour la traçabilité
        stmtInsertCreditRef.run(randomUUID(), id, data.original_invoice_id, item.product_id, qty);
      }

      // 3. Réinjecter le stock (RETURN_IN) via le moteur central
      for (let i = 0; i < data.return_items.length; i++) {
        const item = data.return_items[i];
        StockLedgerService.recordMovement({
          product_id: item.product_id,
          movement_type: 'RETURN_IN',
          quantity: item.quantity,
          unit_price: Math.abs(item.unit_price),
          reference_doc: document_number,
          document_id: id,
          notes: `RETOUR_CLIENT — ${document_number}`,
        });
      }

      // 4. Créer le document avoir (lien original_document_id)
      stmtInsertDoc.run(
        id, 'CREDIT_NOTE', document_number, data.entity_id,
        data.original_invoice_id,
        data.date, null,
        totalExclTax, totalTax, totalInclTax, 0,
        'PAID', notes
      );

      // 5. Créer les lignes (montants négatifs pour refléter le crédit)
      for (let i = 0; i < data.return_items.length; i++) {
        const item = data.return_items[i];
        const vatRate = itemTotals[i].vatRate;
        stmtInsertItem.run(
          randomUUID(), id, item.product_id,
          item.quantity, -Math.abs(item.unit_price), item.discount,
          -itemTotals[i].totals.lineExclTax, vatRate
        );
      }

      // 6. Impact crédit client : l'avoir réduit le solde (écriture PAYMENT)
      stmtInsertClientCredit.run(
        randomUUID(), data.entity_id, 'PAYMENT', totalInclTax,
        `Avoir ${document_number} (retour marchandise)`, new Date().toISOString()
      );

      // 7. Si retour total → annuler la facture originale (statut CANCELLED, données conservées)
      const originalInvoice = stmtGetById.get(data.original_invoice_id) as Document | undefined;
      if (originalInvoice) {
        const originalItems = stmtGetItems.all(data.original_invoice_id) as DocumentItem[];
        const allReturned = data.return_items.every(ri => {
          const orig = originalItems.find(oi => oi.product_id === ri.product_id);
          return orig && ri.quantity >= orig.quantity;
        });
        if (allReturned) {
          stmtUpdateStatus.run('CANCELLED', data.original_invoice_id);
        }
        // Retour partiel : la facture reste active
      }
    });

    insertAll();
    return this.getById(id)!;
  },

  addPayment(data: { document_id: string; amount: number; payment_method: PaymentMethod; reference?: string }): void {
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Le montant du paiement doit être supérieur à 0.');
    }

    // Vérifications avant insertion
    const doc = stmtGetById.get(data.document_id) as Document | undefined;
    if (!doc) throw new Error('Document introuvable.');
    if (doc.status === 'PAID') throw new Error('Ce document est déjà intégralement payé.');
    if (doc.status === 'CANCELLED') throw new Error('Ce document est annulé, aucun paiement possible.');

    const paidRow = stmtGetPaidTotal.get(data.document_id) as { total: number };
    const paid = Number(paidRow.total ?? 0);
    const remaining = round2(doc.total_incl_tax - paid);
    if (amount > remaining + 0.01) {
      throw new Error(`Le paiement (${amount} MAD) dépasse le reste dû (${remaining.toFixed(2)} MAD).`);
    }

    runInTransaction(() => {
      stmtInsertPayment.run(
        randomUUID(), data.document_id, amount, data.payment_method,
        new Date().toISOString(), data.reference ?? null
      );

      // Recalculer le statut
      const newPaidRow = stmtGetPaidTotal.get(data.document_id) as { total: number };
      const newPaid = Number(newPaidRow.total ?? 0);
      let newStatus: DocumentStatus = 'UNPAID';
      if (newPaid >= doc.total_incl_tax - 0.01) newStatus = 'PAID';
      else if (newPaid > 0) newStatus = 'PARTIAL';

      stmtUpdateStatus.run(newStatus, data.document_id);
    });
  },

  getPayments(documentId: string): Payment[] {
    return stmtGetPayments.all(documentId) as Payment[];
  },

  /** Registre complet des paiements (Caisse / Paiements) — SQL paginé. */
  getAllPayments(limit: number = 100, offset: number = 0): PaymentRecord[] {
    return stmtGetAllPayments.all(limit, offset) as PaymentRecord[];
  },

  cancelDocument(documentId: string): void {
    db.prepare(`UPDATE documents SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(documentId);
  },

  /**
   * Conversion BL → Facture.
   *
   * IMPORTANT : le stock a déjà été décrémenté lors de la création du BL.
   * La facture est créée SANS nouvelle décrémentation (manageStock=false).
   */
  convertToInvoice(deliveryNoteId: string): Document {
    const bl = this.getById(deliveryNoteId);
    if (!bl) throw new Error('Bon de livraison introuvable.');
    if (bl.type !== 'DELIVERY_NOTE') throw new Error('Ce document n\'est pas un bon de livraison.');
    if (bl.status === 'CANCELLED') throw new Error('Ce bon de livraison est annulé.');

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
      notes: `Converti depuis ${bl.document_number}`,
      manageStock: false, // PAS de double décrémentation
    });
  }
};
