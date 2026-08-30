import { ipcMain } from 'electron';
import { requireId, toHumanError } from '../ipcValidation';
import { StockService } from '../../src/services/StockService';
import { StockMovementRepository } from '../../src/repositories/StockMovementRepository';
import { ClientService } from '../../src/services/ClientService';
import { ClientRepository } from '../../src/repositories/ClientRepository';
import { SupplierService } from '../../src/services/SupplierService';
import { SupplierRepository } from '../../src/repositories/SupplierRepository';
import { DocumentService } from '../../src/services/DocumentService';
import { DocumentRepository, type DocumentType } from '../../src/repositories/DocumentRepository';
import { AuditService } from '../../src/services/AuditService';
import { PDFService } from '../../src/services/PDFService';
import {
  safeParse,
  nullToUndefined,
  StockEntrySchema,
  StockExitSchema,
  InventorySchema,
  SaleSchema,
  DocumentUpdateSchema,
  PaymentSchema,
  CreditNoteCreateSchema,
  ClientCreateSchema,
  ClientUpdateSchema,
  ClientDebtSchema,
  SupplierCreateSchema,
  SupplierUpdateSchema,
  SupplierDebtSchema,
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
        unit_price: safe.unit_price ?? 0,
        notes: safe.notes ?? undefined,
      }, count);
      AuditService.log('STOCK_INVENTORY', 'stock', safe.product_id, `Inventaire : compté ${count}`);
      return { success: true, data: mvt };
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
    const p = (params ?? {}) as { limit?: unknown; offset?: unknown };
    const limit = Math.min(Math.max(Number(p.limit ?? 100) || 100, 1), 500);
    const offset = Math.max(Number(p.offset ?? 0) || 0, 0);
    return DocumentService.getDocuments(safeType, '', limit, offset);
  });

  ipcMain.handle('documents:search', async (_, { type, query }: { type: unknown; query: unknown }) => {
    const safeType = safeDocumentType(type);
    return DocumentService.getDocuments(safeType, typeof query === 'string' ? query.trim().slice(0, 200) : '');
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

  ipcMain.handle('documents:convertBL', async (_, deliveryNoteId: unknown) => {
    return run(() => {
      const safeId = requireId(deliveryNoteId, 'id bon de livraison');
      const doc = DocumentService.convertBLToInvoice(safeId);
      AuditService.log('BL_TO_INVOICE', 'document', safeId, `BL converti en ${doc.document_number}`);
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
}
