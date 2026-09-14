import { ipcMain } from 'electron';
import { requireId, toHumanError } from '../ipcValidation';
import { StockService } from '../../src/services/StockService';
import { StockLedgerService } from '../../src/services/StockLedgerService';
import { StockMovementRepository } from '../../src/repositories/StockMovementRepository';
import { ClientService } from '../../src/services/ClientService';
import { ClientRepository } from '../../src/repositories/ClientRepository';
import { LoyaltyService } from '../../src/services/LoyaltyService';
import { SupplierService } from '../../src/services/SupplierService';
import { SupplierRepository } from '../../src/repositories/SupplierRepository';
import { DocumentService } from '../../src/services/DocumentService';
import { DocumentRepository, type DocumentType } from '../../src/repositories/DocumentRepository';
import { StatementRepository } from '../../src/repositories/StatementRepository';
import { AuditService } from '../../src/services/AuditService';
import { PDFService } from '../../src/services/PDFService';
// §B4 — Vendeurs (fiches) + §B3 — Niveaux de prix.
import { SellerService } from '../../src/services/SellerService';
import { PricingService } from '../../src/services/PricingService';
import {
  safeParse,
  nullToUndefined,
  StockEntrySchema,
  StockExitSchema,
  InventorySchema,
  SaleSchema,
  DocumentUpdateSchema,
  PaymentSchema,
  PaymentsBatchSchema,
  CreditNoteCreateSchema,
  ClientCreateSchema,
  ClientUpdateSchema,
  ClientDebtSchema,
  SupplierCreateSchema,
  SupplierUpdateSchema,
  SupplierDebtSchema,
  SellerCreateSchema,
  SellerUpdateSchema,
  SellerActiveSchema,
  SellerPeriodSchema,
  ProductLevelPriceSchema,
  CustomerPriceSchema,
  LevelKeySchema,
  CustomerProductKeySchema,
  ResolvePriceSchema,
} from '../../src/validation/schemas';
import { shell } from 'electron';

async function run(action: () => unknown): Promise<unknown> {
  try {
    return await action();
  } catch (error: unknown) {
    return { success: false, error: toHumanError(error) };
  }
}

export function registerBusinessDataHandlers(): void {
  // ─── Stock ─────────────────────────────────────────────────────────────────
  ipcMain.handle('stock:getHistory', async (_, productId: unknown) => {
    const safeId = requireId(productId, 'id produit');
    return StockMovementRepository.getHistoryWithUser(safeId);
  });

  ipcMain.handle('stock:getAllHistory', async (_, params?: unknown) => {
    const p = (params ?? {}) as { limit?: unknown; offset?: unknown };
    const limit = Math.min(Math.max(Number(p.limit ?? 200) || 200, 1), 1000);
    const offset = Math.max(Number(p.offset ?? 0) || 0, 0);
    return StockMovementRepository.getAllHistory(limit, offset);
  });

  ipcMain.handle('stock:getLevel', async (_, productId: unknown) => {
    return StockMovementRepository.getStockLevel(requireId(productId, 'id produit'));
  });

  ipcMain.handle('stock:addEntry', async (_, data: unknown) => {
    return run(() => {
      const safe = nullToUndefined(safeParse(StockEntrySchema, data, 'Entrée de stock'));
      const mvt = StockService.addStockEntry(safe);
      AuditService.log('STOCK_IN', 'stock', safe.product_id, `Entrée de ${safe.quantity}`);
      return { success: true, data: mvt };
    });
  });

  ipcMain.handle('stock:addExit', async (_, data: unknown) => {
    return run(() => {
      const safe = nullToUndefined(safeParse(StockExitSchema, data, 'Sortie de stock'));
      const mvt = StockService.addStockExit({ ...safe, exitType: safe.exitType });
      AuditService.log('STOCK_OUT', 'stock', safe.product_id, `Sortie de ${safe.quantity} (${safe.exitType})`);
      return { success: true, data: mvt };
    });
  });

  ipcMain.handle('stock:addInventory', async (_, { data, actualCount }: { data: unknown; actualCount: unknown }) => {
    return run(() => {
      const safe = safeParse(InventorySchema, data, 'Inventaire');
      const count = Number(actualCount);
      if (!Number.isFinite(count)) throw new Error('Quantité comptée invalide.');
      const mvt = StockService.addInventory({
        product_id: safe.product_id,
        warehouse_id: safe.warehouse_id ?? undefined,
        unit_price: safe.unit_price ?? 0,
        notes: safe.notes ?? undefined,
      }, count);
      AuditService.log('STOCK_INVENTORY', 'stock', safe.product_id, `Inventaire : compté ${count}`);
      return { success: true, data: mvt };
    });
  });

  // Multi-dépôts : répartition du stock d'un produit par dépôt (avec le nom du
  // dépôt), pour l'affichage détaillé de la page Stock.
  ipcMain.handle('stock:getWarehouseBreakdown', async (_, productId: unknown) => {
    const safeId = requireId(productId, 'id produit');
    return StockLedgerService.getWarehouseBreakdown(safeId);
  });

  // §Phase 3.1 — Audit de cohérence du stock (LECTURE SEULE : aucune écriture).
  // Compare le solde stocké au solde attendu recalculé depuis les mouvements.
  ipcMain.handle('stock:auditBalances', async () => {
    return run(() => StockLedgerService.auditBalances());
  });

  // §Phase 3.1 — Réparation CONTRÔLÉE : ne touche que les couples (produit,
  // dépôt) explicitement transmis, journalise chaque correction.
  ipcMain.handle('stock:repairBalances', async (_, items: unknown) => {
    return run(() => {
      if (!Array.isArray(items)) throw new Error('Liste d\'éléments à réparer invalide.');
      const safeItems = items
        .slice(0, 5000)
        .map(it => {
          const row = (it ?? {}) as { product_id?: unknown; warehouse_id?: unknown };
          return {
            product_id: requireId(row.product_id, 'id produit'),
            warehouse_id: requireId(row.warehouse_id, 'id dépôt'),
          };
        });
      const result = StockLedgerService.repairBalances(safeItems);
      AuditService.log(
        'STOCK_REPAIR',
        'stock',
        'inventory_balances',
        `Réparation de ${result.repaired} solde(s) depuis les mouvements`,
        undefined,
        result.details,
      );
      return { success: true, data: result };
    });
  });

  // ─── Clients ───────────────────────────────────────────────────────────────
  ipcMain.handle('clients:search', async (_, query: unknown) => {
    return ClientService.searchClients(typeof query === 'string' ? query.trim() : '');
  });

  ipcMain.handle('clients:create', async (_, data: unknown) => {
    return run(() => {
      const safe = nullToUndefined(safeParse(ClientCreateSchema, data, 'Création client'));
      const client = ClientService.createClient(safe);
      AuditService.log('CLIENT_CREATE', 'client', client.id, `Client ${client.name}`);
      return { success: true, data: client };
    });
  });

  ipcMain.handle('clients:update', async (_, { id, data }: { id: unknown; data: unknown }) => {
    return run(() => {
      const safeId = requireId(id, 'id client');
      const safe = nullToUndefined(safeParse(ClientUpdateSchema, data, 'Modification client'));
      return { success: true, data: ClientService.updateClient(safeId, safe) };
    });
  });

  ipcMain.handle('clients:delete', async (_, id: unknown) => {
    return run(() => {
      const safeId = requireId(id, 'id client');
      ClientService.deleteClient(safeId);
      AuditService.log('CLIENT_DELETE', 'client', safeId, 'Client supprimé');
      return { success: true };
    });
  });

  ipcMain.handle('clients:getHistory', async (_, customerId: unknown) => {
    return ClientService.getClientHistory(requireId(customerId, 'id client'));
  });

  ipcMain.handle('clients:getDocuments', async (_, customerId: unknown) => {
    return ClientRepository.getDocuments(requireId(customerId, 'id client'));
  });

  ipcMain.handle('clients:addDebt', async (_, payload: unknown) => {
    return run(() => {
      const safe = nullToUndefined(safeParse(ClientDebtSchema, payload, 'Dette client'));
      const credit = ClientService.addDebt(safe.customerId, safe.amount, safe.description ?? '');
      AuditService.log('CLIENT_DEBT', 'client', safe.customerId, `Dette ${safe.amount} MAD`);
      return { success: true, data: credit };
    });
  });

  ipcMain.handle('clients:addPayment', async (_, payload: unknown) => {
    return run(() => {
      const safe = nullToUndefined(safeParse(ClientDebtSchema, payload, 'Paiement client'));
      const payment = ClientService.recordPayment(safe.customerId, safe.amount, safe.description ?? '');
      AuditService.log('CLIENT_PAYMENT', 'client', safe.customerId, `Paiement ${safe.amount} MAD`);
      return { success: true, data: payment };
    });
  });

  // §Phase 8 — Relevé de compte client (lignes débit/crédit + solde + échéances).
  ipcMain.handle('clients:getStatement', async (_, customerId: unknown) => {
    return run(() => StatementRepository.getClientStatement(requireId(customerId, 'id client')));
  });

  ipcMain.handle('clients:exportStatement', async (_, customerId: unknown) => {
    return run(async () => {
      const safeId = requireId(customerId, 'id client');
      const client = ClientRepository.getById(safeId);
      if (!client) throw new Error('Client introuvable');
      const history = ClientRepository.getHistory(safeId);
      const filePath = await PDFService.generateClientStatement(client, history);
      shell.openPath(filePath);
      return { success: true, filePath };
    });
  });

  // §Fidélité — solde de points du client + barème en vigueur (lecture seule).
  ipcMain.handle('clients:getLoyalty', async (_, customerId: unknown) => {
    return run(() => {
      const safeId = requireId(customerId, 'id client');
      const customer = ClientRepository.getById(safeId);
      if (!customer) throw new Error('Client introuvable.');
      return {
        success: true,
        points: ClientRepository.getLoyaltyPoints(safeId),
        valuePerPoint: LoyaltyService.valueOfPoints(1),
        enabled: LoyaltyService.isEnabled(),
      };
    });
  });

  // §Fidélité — échange de points contre un crédit client (réduit le solde dû).
  // L'opération est atomique côté service : jamais de débit sans crédit.
  ipcMain.handle('clients:redeemLoyalty', async (_, payload: unknown) => {
    return run(() => {
      const body = (payload ?? {}) as { customerId?: unknown; points?: unknown };
      const safeId = requireId(body.customerId, 'id client');
      const points = Math.floor(Number(body.points));
      if (!Number.isFinite(points) || points <= 0) {
        throw new Error('Le nombre de points à échanger doit être supérieur à 0.');
      }
      const result = LoyaltyService.redeemPoints(safeId, points);
      AuditService.log('LOYALTY_REDEEM', 'customer', safeId,
        `Échange de ${points} point(s) fidélité → ${result.value.toFixed(2)} MAD de crédit client`);
      return { success: true, value: result.value, remaining: result.remaining };
    });
  });

  // ─── Fournisseurs ──────────────────────────────────────────────────────────
  ipcMain.handle('suppliers:search', async (_, query: unknown) => {
    return SupplierService.searchSuppliers(typeof query === 'string' ? query.trim() : '');
  });

  ipcMain.handle('suppliers:create', async (_, data: unknown) => {
    return run(() => {
      const safe = nullToUndefined(safeParse(SupplierCreateSchema, data, 'Création fournisseur'));
      const supplier = SupplierService.createSupplier(safe);
      AuditService.log('SUPPLIER_CREATE', 'supplier', supplier.id, `Fournisseur ${supplier.name}`);
      return { success: true, data: supplier };
    });
  });

  ipcMain.handle('suppliers:update', async (_, { id, data }: { id: unknown; data: unknown }) => {
    return run(() => {
      const safeId = requireId(id, 'id fournisseur');
      const safe = nullToUndefined(safeParse(SupplierUpdateSchema, data, 'Modification fournisseur'));
      return { success: true, data: SupplierService.updateSupplier(safeId, safe) };
    });
  });

  ipcMain.handle('suppliers:delete', async (_, id: unknown) => {
    return run(() => {
      const safeId = requireId(id, 'id fournisseur');
      SupplierService.deleteSupplier(safeId);
      AuditService.log('SUPPLIER_DELETE', 'supplier', safeId, 'Fournisseur supprimé');
      return { success: true };
    });
  });

  ipcMain.handle('suppliers:getHistory', async (_, supplierId: unknown) => {
    return SupplierService.getSupplierHistory(requireId(supplierId, 'id fournisseur'));
  });

  ipcMain.handle('suppliers:addDebt', async (_, payload: unknown) => {
    return run(() => {
      const safe = nullToUndefined(safeParse(SupplierDebtSchema, payload, 'Dette fournisseur'));
      const credit = SupplierService.addDebt(safe.supplierId, safe.amount, safe.description ?? '');
      AuditService.log('SUPPLIER_DEBT', 'supplier', safe.supplierId, `Dette ${safe.amount} MAD`);
      return { success: true, data: credit };
    });
  });

  ipcMain.handle('suppliers:addPayment', async (_, payload: unknown) => {
    return run(() => {
      const safe = nullToUndefined(safeParse(SupplierDebtSchema, payload, 'Paiement fournisseur'));
      const payment = SupplierService.recordPayment(safe.supplierId, safe.amount, safe.description ?? '');
      AuditService.log('SUPPLIER_PAYMENT', 'supplier', safe.supplierId, `Paiement ${safe.amount} MAD`);
      return { success: true, data: payment };
    });
  });

  // §Phase 9 — Relevé fournisseur (achats / règlements / solde / échéances).
  ipcMain.handle('suppliers:getStatement', async (_, supplierId: unknown) => {
    return run(() => StatementRepository.getSupplierStatement(requireId(supplierId, 'id fournisseur')));
  });

  ipcMain.handle('suppliers:exportStatement', async (_, supplierId: unknown) => {
    return run(async () => {
      const safeId = requireId(supplierId, 'id fournisseur');
      const supplierData = SupplierRepository.getById(safeId);
      if (!supplierData) throw new Error('Fournisseur introuvable');
      const history = SupplierRepository.getHistory(safeId);
      const filePath = await PDFService.generateSupplierStatement(supplierData, history);
      shell.openPath(filePath);
      return { success: true, filePath };
    });
  });

  // ─── Documents / Facturation ───────────────────────────────────────────────
  const DOCUMENT_TYPES: readonly DocumentType[] = ['QUOTE', 'DELIVERY_NOTE', 'INVOICE', 'CREDIT_NOTE'];

  /** Whitelist stricte : tout type inconnu venant du renderer → INVOICE (jamais de `any`). */
  function safeDocumentType(value: unknown): DocumentType {
    return typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value)
      ? (value as DocumentType)
      : 'INVOICE';
  }

  ipcMain.handle('documents:getAll', async (_, type: unknown, params?: unknown) => {
    const safeType = safeDocumentType(type);
    const p = (params ?? {}) as { limit?: unknown; offset?: unknown; status?: unknown };
    const limit = Math.min(Math.max(Number(p.limit ?? 100) || 100, 1), 500);
    const offset = Math.max(Number(p.offset ?? 0) || 0, 0);
    const status = typeof p.status === 'string' && p.status ? p.status : undefined;
    return DocumentService.getDocuments(safeType, '', limit, offset, status);
  });

  ipcMain.handle('documents:search', async (_, { type, query, status }: { type: unknown; query: unknown; status?: unknown }) => {
    const safeType = safeDocumentType(type);
    const safeStatus = typeof status === 'string' && status ? status : undefined;
    return DocumentService.getDocuments(safeType, typeof query === 'string' ? query.trim().slice(0, 200) : '', undefined, undefined, safeStatus);
  });

  ipcMain.handle('documents:getById', async (_, id: unknown) => {
    return DocumentService.getDocument(requireId(id, 'id document'));
  });

  ipcMain.handle('documents:create', async (_, data: unknown) => {
    return run(() => {
      const safe = nullToUndefined(safeParse(SaleSchema, data, 'Création document'));
      const doc = DocumentService.createDocument({
        type: safe.type,
        entity_id: safe.entity_id,
        date: safe.date,
        due_date: safe.due_date ?? undefined,
        notes: safe.notes ?? undefined,
        seller_id: safe.seller_id ?? undefined,
        items: safe.items.map(i => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          discount: i.discount ?? 0,
        })),
      });
      AuditService.log('DOCUMENT_CREATE', 'document', doc.id, `${doc.type} ${doc.document_number}`);
      return { success: true, data: doc };
    });
  });

  ipcMain.handle('documents:addPayment', async (_, data: unknown) => {
    return run(() => {
      const safe = nullToUndefined(safeParse(PaymentSchema, data, 'Paiement document'));
      DocumentService.addPayment(safe);
      AuditService.log('DOCUMENT_PAYMENT', 'document', safe.document_id, `Paiement ${safe.amount} MAD`);
      return { success: true };
    });
  });

  // §B2 — Paiement RÉPARTI sur plusieurs modes en une seule transaction.
  // Zod valide la structure ; le SERVICE valide la somme contre le reste dû.
  ipcMain.handle('documents:addPayments', async (_, payload: unknown) => {
    return run(() => {
      const safe = safeParse(PaymentsBatchSchema, payload, 'Paiement multi-modes');
      DocumentService.addPayments(safe.document_id, safe.payments.map(p => ({
        amount: p.amount,
        payment_method: p.payment_method,
        reference: p.reference ?? null,
      })));
      return { success: true };
    });
  });

  ipcMain.handle('documents:convertBL', async (_, deliveryNoteId: unknown) => {
    return run(() => {
      const safeId = requireId(deliveryNoteId, 'id bon de livraison');
      const doc = DocumentService.convertBLToInvoice(safeId);
      AuditService.log('BL_TO_INVOICE', 'document', safeId, `BL converti en ${doc.document_number}`);
      return { success: true, data: doc };
    });
  });

  ipcMain.handle('documents:convertQuoteToDeliveryNote', async (_, quoteId: unknown) => {
    return run(() => {
      const safeId = requireId(quoteId, 'id devis');
      const doc = DocumentService.convertQuoteToDeliveryNote(safeId);
      AuditService.log('QUOTE_TO_BL', 'document', safeId, `Devis converti en ${doc.document_number}`);
      return { success: true, data: doc };
    });
  });

  ipcMain.handle('documents:convertQuoteToInvoice', async (_, quoteId: unknown) => {
    return run(() => {
      const safeId = requireId(quoteId, 'id devis');
      const doc = DocumentService.convertQuoteToInvoice(safeId);
      AuditService.log('QUOTE_TO_INVOICE', 'document', safeId, `Devis converti en ${doc.document_number}`);
      return { success: true, data: doc };
    });
  });

  ipcMain.handle('documents:createCreditNote', async (_, payload: unknown) => {
    return run(() => {
      const safe = safeParse(CreditNoteCreateSchema, payload, 'Création avoir');
      const doc = DocumentService.createCreditNote(safe.invoiceId, safe.returnItems, safe.reason ?? 'Retour marchandise');
      AuditService.log('CREDIT_NOTE', 'document', doc.id, `Avoir ${doc.document_number} pour ${safe.reason ?? 'retour'}`);
      return { success: true, data: doc };
    });
  });

  ipcMain.handle('documents:getPayments', async (_, documentId: unknown) => {
    return DocumentService.getPayments(requireId(documentId, 'id document'));
  });

  // §Phase 7 — quantités retournables d'une facture (lecture seule).
  ipcMain.handle('documents:getReturnableQuantities', async (_, invoiceId: unknown) => {
    return DocumentService.getReturnableQuantities(requireId(invoiceId, 'id facture'));
  });

  ipcMain.handle('documents:getAllPayments', async (_, params?: unknown) => {
    const p = (params ?? {}) as { limit?: unknown; offset?: unknown };
    const limit = Math.min(Math.max(Number(p.limit ?? 100) || 100, 1), 500);
    const offset = Math.max(Number(p.offset ?? 0) || 0, 0);
    return DocumentRepository.getAllPayments(limit, offset);
  });

  ipcMain.handle('documents:exportPdf', async (_, documentId: unknown) => {
    return run(async () => {
      const safeId = requireId(documentId, 'id document');
      const doc = DocumentService.getDocument(safeId);
      if (!doc) throw new Error('Document introuvable.');
      const filePath = await PDFService.generateDocument(doc);
      shell.openPath(filePath);
      return { success: true, filePath };
    });
  });

  ipcMain.handle('documents:printReceipt', async (_, documentId: unknown) => {
    return run(async () => {
      const safeId = requireId(documentId, 'id document');
      const doc = DocumentService.getDocument(safeId);
      if (!doc) throw new Error('Document introuvable.');
      const filePath = await PDFService.generateReceipt(doc);
      shell.openPath(filePath);
      return { success: true, filePath };
    });
  });

  ipcMain.handle('documents:delete', async (_, id: unknown) => {
    return run(() => {
      const safeId = requireId(id, 'id document');
      const doc = DocumentService.getDocument(safeId);
      if (!doc) throw new Error('Document introuvable.');
      DocumentRepository.deleteDocument(safeId);
      AuditService.log('DOCUMENT_DELETE', 'document', safeId, `${doc.type} ${doc.document_number} supprimé`);
      return { success: true };
    });
  });

  ipcMain.handle('documents:updateNotes', async (_, payload: unknown) => {
    return run(() => {
      const p = (payload ?? {}) as { id?: unknown; notes?: unknown };
      const safeId = requireId(p.id, 'id document');
      const notes = typeof p.notes === 'string' ? p.notes.trim().slice(0, 1000) : '';
      DocumentRepository.updateDocumentNotes(safeId, notes);
      AuditService.log('DOCUMENT_UPDATE', 'document', safeId, 'Notes du document modifiées');
      return { success: true };
    });
  });

  ipcMain.handle('documents:update', async (_, payload: unknown) => {
    return run(() => {
      const p = (payload ?? {}) as { id?: unknown; data?: unknown };
      const safeId = requireId(p.id, 'id document');
      const safe = nullToUndefined(safeParse(DocumentUpdateSchema, p.data, 'Modification document'));
      const doc = DocumentService.updateDocument(safeId, {
        entity_id: safe.entity_id,
        date: safe.date,
        due_date: safe.due_date ?? undefined,
        notes: safe.notes ?? undefined,
        items: safe.items.map(i => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          discount: i.discount ?? 0,
        })),
      });
      AuditService.log('DOCUMENT_UPDATE', 'document', safeId, `${doc.type} ${doc.document_number} modifié`);
      return { success: true, data: doc };
    });
  });

  // ─── §B4 — Vendeurs / commerciaux (FICHES, aucun compte utilisateur) ──────
  ipcMain.handle('sellers:getAll', async () => SellerService.getAllSellers());

  ipcMain.handle('sellers:getActive', async () => SellerService.getActiveSellers());

  ipcMain.handle('sellers:create', async (_, data: unknown) => {
    return run(() => {
      const safe = nullToUndefined(safeParse(SellerCreateSchema, data, 'Création vendeur'));
      const seller = SellerService.createSeller(safe);
      AuditService.log('SELLER_CREATE', 'seller', seller.id, `Vendeur ${seller.name}`);
      return { success: true, data: seller };
    });
  });

  ipcMain.handle('sellers:update', async (_, { id, data }: { id: unknown; data: unknown }) => {
    return run(() => {
      const safeId = requireId(id, 'id vendeur');
      const safe = nullToUndefined(safeParse(SellerUpdateSchema, data, 'Modification vendeur'));
      return { success: true, data: SellerService.updateSeller(safeId, safe) };
    });
  });

  ipcMain.handle('sellers:setActive', async (_, payload: unknown) => {
    return run(() => {
      const body = (payload ?? {}) as { id?: unknown; active?: unknown };
      const safeId = requireId(body.id, 'id vendeur');
      const safe = safeParse(SellerActiveSchema, { active: body.active }, 'Activation vendeur');
      SellerService.setSellerActive(safeId, safe.active);
      AuditService.log('SELLER_ACTIVE', 'seller', safeId, safe.active ? 'Vendeur activé' : 'Vendeur désactivé');
      return { success: true };
    });
  });

  ipcMain.handle('sellers:delete', async (_, id: unknown) => {
    return run(() => {
      const safeId = requireId(id, 'id vendeur');
      SellerService.deleteSeller(safeId);
      AuditService.log('SELLER_DELETE', 'seller', safeId, 'Vendeur supprimé');
      return { success: true };
    });
  });

  // §B4 — rapport ventes + commission (période : from+to → mois → année → mois courant).
  ipcMain.handle('sellers:getReport', async (_, payload: unknown) => {
    return run(() => {
      const safe = safeParse(SellerPeriodSchema, payload ?? {}, 'Période du rapport vendeurs');
      if (safe.from && safe.to) return { success: true, data: SellerService.getReportForRange(safe.from, safe.to) };
      if (safe.month) return { success: true, data: SellerService.getReportForMonth(safe.month) };
      if (typeof safe.year === 'number') return { success: true, data: SellerService.getReportForYear(safe.year) };
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      return { success: true, data: SellerService.getReportForMonth(month) };
    });
  });

  // ─── §B3 — Niveaux de prix (résolution + gestion) ─────────────────────────
  ipcMain.handle('pricing:listLevels', async () => PricingService.listLevels());

  ipcMain.handle('pricing:resolve', async (_, payload: unknown) => {
    return run(() => {
      const safe = safeParse(ResolvePriceSchema, payload, 'Résolution de prix');
      return {
        success: true,
        data: PricingService.resolveProductPrice({
          productId: safe.productId,
          customerId: safe.customerId ?? null,
          quantity: safe.quantity ?? 1,
        }),
      };
    });
  });

  ipcMain.handle('pricing:listProductLevels', async (_, productId: unknown) => {
    return PricingService.listProductLevels(requireId(productId, 'id produit'));
  });

  ipcMain.handle('pricing:setLevelPrice', async (_, payload: unknown) => {
    return run(() => {
      const safe = safeParse(ProductLevelPriceSchema, payload, 'Prix par niveau');
      PricingService.setLevelPrice(safe.productId, safe.level, safe.price);
      AuditService.log('PRICE_LEVEL_SET', 'product', safe.productId, `Prix niveau ${safe.level} : ${safe.price} MAD`);
      return { success: true };
    });
  });

  ipcMain.handle('pricing:deleteLevelPrice', async (_, payload: unknown) => {
    return run(() => {
      const safe = safeParse(LevelKeySchema, payload, 'Suppression prix de niveau');
      PricingService.deleteLevelPrice(safe.productId, safe.level);
      AuditService.log('PRICE_LEVEL_DELETE', 'product', safe.productId, `Prix niveau ${safe.level} supprimé`);
      return { success: true };
    });
  });

  ipcMain.handle('pricing:setCustomerPrice', async (_, payload: unknown) => {
    return run(() => {
      const safe = safeParse(CustomerPriceSchema, payload, 'Prix spécifique client');
      PricingService.setCustomerPrice(safe.customerId, safe.productId, safe.price);
      AuditService.log('CUSTOMER_PRICE_SET', 'customer', safe.customerId, `Prix spécifique produit ${safe.productId} : ${safe.price} MAD`);
      return { success: true };
    });
  });

  ipcMain.handle('pricing:deleteCustomerPrice', async (_, payload: unknown) => {
    return run(() => {
      const safe = safeParse(CustomerProductKeySchema, payload, 'Suppression prix client');
      PricingService.deleteCustomerPrice(safe.customerId, safe.productId);
      AuditService.log('CUSTOMER_PRICE_DELETE', 'customer', safe.customerId, `Prix spécifique produit ${safe.productId} supprimé`);
      return { success: true };
    });
  });

  ipcMain.handle('pricing:getCustomerLevel', async (_, customerId: unknown) => {
    return { success: true, level: PricingService.getCustomerLevel(requireId(customerId, 'id client')) };
  });

  ipcMain.handle('pricing:setCustomerLevel', async (_, payload: unknown) => {
    return run(() => {
      const body = (payload ?? {}) as { customerId?: unknown; level?: unknown };
      const safeId = requireId(body.customerId, 'id client');
      const level = PricingService.setCustomerLevel(safeId, body.level);
      AuditService.log('CUSTOMER_LEVEL_SET', 'customer', safeId, `Niveau de prix : ${level}`);
      return { success: true, level };
    });
  });
}
