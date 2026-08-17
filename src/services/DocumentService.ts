import { DocumentRepository, type Document, type DocumentType, type PaymentMethod } from '../repositories/DocumentRepository';
import { db } from '../database/config/connection';
import { AuditService } from './AuditService';

export const DocumentService = {

  createDocument(data: {
    type: DocumentType;
    entity_id: string;
    date: string;
    due_date?: string;
    notes?: string;
    items: Array<{ product_id: string; quantity: number; unit_price: number; discount: number }>;
  }): Document {
    if (!data.entity_id) throw new Error('Veuillez sélectionner un client.');
    if (!data.items || data.items.length === 0) throw new Error('Le document doit contenir au moins une ligne de produit.');

    for (const item of data.items) {
      if (item.quantity <= 0) throw new Error('La quantité doit être supérieure à 0.');
      if (item.unit_price < 0) throw new Error('Le prix unitaire ne peut pas être négatif.');
      if (item.discount < 0 || item.discount > 100) throw new Error('La remise doit être comprise entre 0 et 100%.');
    }

    return DocumentRepository.create(data);
  },

  getDocuments(type: DocumentType, query = ''): Document[] {
    if (query.trim() === '') return DocumentRepository.getAll(type);
    return DocumentRepository.search(type, query.trim());
  },

  getDocument(id: string): Document | undefined {
    return DocumentRepository.getById(id);
  },

  addPayment(data: { document_id: string; amount: number; payment_method: PaymentMethod; reference?: string }): void {
    if (data.amount <= 0) throw new Error('Le montant du paiement doit être supérieur à 0.');
    const doc = DocumentRepository.getById(data.document_id);
    if (!doc) throw new Error('Document introuvable.');
    if (doc.status === 'PAID') throw new Error('Ce document est déjà intégralement payé.');

    const remaining = doc.total_incl_tax - (doc.amount_paid ?? 0);
    if (data.amount > remaining + 0.01) {
      throw new Error(`Le paiement (${data.amount} MAD) dépasse le reste dû (${remaining.toFixed(2)} MAD).`);
    }

    const txn = db.transaction(() => {
      DocumentRepository.addPayment(data);
      AuditService.log('DOCUMENT_PAYMENT', 'document', data.document_id, `Paiement ${data.amount} MAD`);
    });
    txn();
  },

  convertBLToInvoice(deliveryNoteId: string): Document {
    return DocumentRepository.convertToInvoice(deliveryNoteId);
  },

  /**
   * Crée un avoir à partir d'une facture (cahier des charges §7).
   * L'ancienne facture est marquée CANCELLED et un avoir AV-YYYY-NNN est généré.
   */
  createCreditNote(invoiceId: string, reason: string = 'Retour marchandise'): Document {
    const invoice = DocumentRepository.getById(invoiceId);
    if (!invoice) throw new Error('Facture introuvable.');
    if (invoice.type !== 'INVOICE') throw new Error('Seules les factures peuvent générer un avoir.');

    const creditNote = DocumentRepository.create({
      type: 'CREDIT_NOTE',
      entity_id: invoice.entity_id,
      date: new Date().toISOString().split('T')[0],
      notes: `Avoir pour ${invoice.document_number} — ${reason}`,
      items: (invoice.items ?? []).map(i => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: -Math.abs(i.unit_price),  // négatif : retour de marchandise
        discount: i.discount
      }))
    });

    // Marquer la facture originale comme annulée
    DocumentRepository.cancelDocument(invoiceId);

    return creditNote;
  },

  getPayments(documentId: string) {
    return DocumentRepository.getPayments(documentId);
  }
};
