import { DocumentRepository, type Document, type DocumentType, type PaymentMethod } from '../repositories/DocumentRepository';
import { db } from '../database/config/connection';
import { AuditService } from './AuditService';

export const DocumentService = {

  /**
   * Crée un document (facture, BL, devis) avec vérification et décrémentation
   * atomiques du stock pour les types INVOICE et DELIVERY_NOTE.
   */
  createDocument(data: {
    type: DocumentType;
    entity_id: string;
    date: string;
    due_date?: string;
    notes?: string;
    items: Array<{ product_id: string; quantity: number; unit_price: number; discount: number }>;
  }): Document {
    // entity_id peut être vide pour les ventes comptoir (POS)
    if (!data.items || data.items.length === 0) throw new Error('Le document doit contenir au moins une ligne de produit.');

    for (const item of data.items) {
      if (item.quantity <= 0) throw new Error('La quantité doit être supérieure à 0.');
      if (item.unit_price < 0) throw new Error('Le prix unitaire ne peut pas être négatif.');
      if (item.discount < 0 || item.discount > 100) throw new Error('La remise doit être comprise entre 0 et 100%.');
    }

    // Gérer le stock automatiquement pour factures et BL
    const manageStock = data.type === 'INVOICE' || data.type === 'DELIVERY_NOTE';

    return DocumentRepository.create({ ...data, manageStock });
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
   * Crée un avoir (partiel ou total) à partir d'une facture.
   *
   * @param invoiceId - ID de la facture originale
   * @param returnItems - Produits retournés avec quantités. Si omitted ou vide,
   *                      retour total de tous les articles.
   * @param reason - Motif du retour
   *
   * Le stock est réinjecté atomiquement dans la même transaction.
   * - Retour total → la facture originale passe en CANCELLED
   * - Retour partiel → la facture reste ACTIVE (UNPAID/PARTIAL/PAID)
   */
  createCreditNote(
    invoiceId: string,
    returnItems?: Array<{ product_id: string; quantity: number }>,
    reason: string = 'Retour marchandise',
  ): Document {
    const invoice = DocumentRepository.getById(invoiceId);
    if (!invoice) throw new Error('Facture introuvable.');
    if (invoice.type !== 'INVOICE') throw new Error('Seules les factures peuvent générer un avoir.');
    if (invoice.status === 'CANCELLED') throw new Error('Cette facture est déjà annulée.');

    const invoiceItems = invoice.items ?? [];

    // Construire les articles à retourner
    let itemsToReturn: Array<{ product_id: string; quantity: number; unit_price: number; discount: number }>;

    if (!returnItems || returnItems.length === 0) {
      // Retour total : tous les articles de la facture
      itemsToReturn = invoiceItems.map(item => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount: item.discount,
      }));
    } else {
      // Retour partiel : valider et construire
      itemsToReturn = [];
      for (const ri of returnItems) {
        if (ri.quantity <= 0) continue;

        const originalItem = invoiceItems.find(ii => ii.product_id === ri.product_id);
        if (!originalItem) {
          throw new Error(`Le produit ${ri.product_id} n'existe pas dans la facture originale.`);
        }
        if (ri.quantity > originalItem.quantity) {
          throw new Error(
            `Impossible de retourner ${ri.quantity} unités de "${originalItem.product_ref}" : ` +
            `la facture ne contient que ${originalItem.quantity} unités.`
          );
        }

        itemsToReturn.push({
          product_id: ri.product_id,
          quantity: ri.quantity,
          unit_price: originalItem.unit_price,
          discount: originalItem.discount,
        });
      }
    }

    if (itemsToReturn.length === 0) {
      throw new Error('Aucun article à retourner.');
    }

    // Créer l'avoir via le repository (transaction atomique avec stock)
    const creditNote = DocumentRepository.createCreditNote({
      original_invoice_id: invoiceId,
      entity_id: invoice.entity_id,
      date: new Date().toISOString().split('T')[0],
      return_items: itemsToReturn,
      reason,
    });

    AuditService.log(
      'CREDIT_NOTE_CREATE',
      'document',
      creditNote.id,
      `Avoir ${creditNote.document_number} pour ${reason} (${itemsToReturn.length} article(s))`
    );

    return creditNote;
  },

  getPayments(documentId: string) {
    return DocumentRepository.getPayments(documentId);
  }
};
