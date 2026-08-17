import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProductService } from '../src/services/ProductService';
import { StockService } from '../src/services/StockService';
import { StockMovementRepository } from '../src/repositories/StockMovementRepository';
import { ClientService } from '../src/services/ClientService';
import { DocumentService } from '../src/services/DocumentService';
import { DashboardRepository } from '../src/repositories/DashboardRepository';
import { BackupService } from '../src/services/BackupService';
import { PDFService } from '../src/services/PDFService';
import { AuditService } from '../src/services/AuditService';
import { CompanySettingsService } from '../src/services/CompanySettingsService';
import { CategoryRepository } from '../src/repositories/CategoryRepository';
import { VolumeDiscountRepository } from '../src/repositories/VolumeDiscountRepository';
import { ImportService } from '../src/services/ImportService';
import { ClientRepository } from '../src/repositories/ClientRepository';
import { SupplierService } from '../src/services/SupplierService';
import { ProductRepository } from '../src/repositories/ProductRepository';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, '..');
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST;

let win: BrowserWindow | null;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  createWindow();
  BackupService.scheduleAutoBackup();
  AuditService.log('APP_START', 'system', 'stocklocal', 'Application démarrée');

  // ─── Produits ──────────────────────────────────────────────────────────────
  ipcMain.handle('products:search', async (_, query: string) => {
    return ProductService.searchProducts(query);
  });

  ipcMain.handle('products:create', async (_, productData: any) => {
    try {
      const product = ProductService.createProduct(productData);
      AuditService.log('PRODUCT_CREATE', 'product', product.id, `Création produit ${product.reference}`);
      return { success: true, data: product };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('products:update', async (_, { id, data }: { id: string; data: any }) => {
    try {
      const product = ProductService.updateProduct(id, data);
      AuditService.log('PRODUCT_UPDATE', 'product', id, `Modification produit ${product.reference}`);
      return { success: true, data: product };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('products:archive', async (_, id: string) => {
    try {
      ProductService.archiveProduct(id);
      AuditService.log('PRODUCT_ARCHIVE', 'product', id, 'Produit archivé');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('products:activate', async (_, id: string) => {
    try {
      ProductService.activateProduct(id);
      AuditService.log('PRODUCT_ACTIVATE', 'product', id, 'Produit réactivé');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('products:getAll', async () => {
    return ProductRepository.search('', 10000);
  });

  // ─── Catégories ────────────────────────────────────────────────────────────
  ipcMain.handle('categories:getAll', async () => {
    return CategoryRepository.getAll();
  });

  ipcMain.handle('categories:create', async (_, data: any) => {
    try {
      const cat = CategoryRepository.create(data);
      AuditService.log('CATEGORY_CREATE', 'category', cat.id, `Catégorie ${cat.name}`);
      return { success: true, data: cat };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('categories:update', async (_, { id, data }: any) => {
    try {
      return { success: true, data: CategoryRepository.update(id, data) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('categories:delete', async (_, id: string) => {
    try {
      CategoryRepository.remove(id);
      AuditService.log('CATEGORY_DELETE', 'category', id, 'Catégorie supprimée');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('categories:addSub', async (_, { categoryId, data }: any) => {
    try {
      return { success: true, data: CategoryRepository.addSubcategory(categoryId, data) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('categories:updateSub', async (_, { id, data }: any) => {
    try {
      return { success: true, data: CategoryRepository.updateSubcategory(id, data) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('categories:deleteSub', async (_, id: string) => {
    try {
      CategoryRepository.removeSubcategory(id);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Remises par volume ────────────────────────────────────────────────────
  ipcMain.handle('discounts:getAll', async () => {
    return VolumeDiscountRepository.getAll();
  });

  ipcMain.handle('discounts:create', async (_, data: any) => {
    try {
      const d = VolumeDiscountRepository.create(data);
      AuditService.log('DISCOUNT_CREATE', 'discount', d.id, `${d.name} : ${d.discount_pct}%`);
      return { success: true, data: d };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('discounts:update', async (_, { id, data }: any) => {
    try {
      return { success: true, data: VolumeDiscountRepository.update(id, data) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('discounts:delete', async (_, id: string) => {
    try {
      VolumeDiscountRepository.remove(id);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Paramètres entreprise ─────────────────────────────────────────────────
  ipcMain.handle('company:get', async () => {
    return CompanySettingsService.getAll();
  });

  ipcMain.handle('company:save', async (_, settings: any) => {
    try {
      const saved = CompanySettingsService.save(settings);
      AuditService.log('COMPANY_UPDATE', 'company', 'settings', 'Paramètres entreprise modifiés');
      return { success: true, data: saved };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Journal d'audit ───────────────────────────────────────────────────────
  ipcMain.handle('audit:getLogs', async (_, limit?: number) => {
    return AuditService.getLogs(limit);
  });

  // ─── Import produits (CSV) ─────────────────────────────────────────────────
  ipcMain.handle('products:importCsv', async (_, filePath: string) => {
    try {
      const result = ImportService.importProductsFromCsv(filePath);
      AuditService.log('PRODUCT_IMPORT', 'product', 'bulk', `Import CSV : ${result.imported} produits, ${result.errors} erreurs`);
      return { success: true, ...result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Étiquettes / codes-barres ─────────────────────────────────────────────
  ipcMain.handle('products:printLabels', async (_, productIds: string[]) => {
    try {
      const filePath = await PDFService.generateBarcodeLabels(productIds);
      shell.openPath(filePath);
      return { success: true, filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Rapports dashboard ────────────────────────────────────────────────────
  ipcMain.handle('reports:generate', async (_, month?: string) => {
    try {
      const filePath = await PDFService.generateMonthlyReport(month);
      shell.openPath(filePath);
      return { success: true, filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Stock ─────────────────────────────────────────────────────────────────
  ipcMain.handle('stock:getHistory', async (_, productId: string) => {
    return StockMovementRepository.getHistory(productId);
  });

  ipcMain.handle('stock:getLevel', async (_, productId: string) => {
    return StockMovementRepository.getStockLevel(productId);
  });

  ipcMain.handle('stock:addEntry', async (_, data: any) => {
    try {
      const mvt = StockService.addStockEntry(data);
      AuditService.log('STOCK_IN', 'stock', data.product_id, `Entrée de ${data.quantity}`);
      return { success: true, data: mvt };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('stock:addExit', async (_, data: any) => {
    try {
      const mvt = StockService.addStockExit(data);
      AuditService.log('STOCK_OUT', 'stock', data.product_id, `Sortie de ${data.quantity} (${data.notes ?? 'vente/casse'})`);
      return { success: true, data: mvt };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('stock:addInventory', async (_, { data, actualCount }: { data: any; actualCount: number }) => {
    try {
      const mvt = StockService.addInventory(data, actualCount);
      AuditService.log('STOCK_INVENTORY', 'stock', data.product_id, `Inventaire : compté ${actualCount}`);
      return { success: true, data: mvt };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Clients ───────────────────────────────────────────────────────────────
  ipcMain.handle('clients:search', async (_, query: string) => {
    return ClientService.searchClients(query);
  });

  ipcMain.handle('clients:create', async (_, data: any) => {
    try {
      const client = ClientService.createClient(data);
      AuditService.log('CLIENT_CREATE', 'client', client.id, `Client ${client.name}`);
      return { success: true, data: client };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clients:update', async (_, { id, data }: { id: string; data: any }) => {
    try {
      return { success: true, data: ClientService.updateClient(id, data) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clients:getHistory', async (_, customerId: string) => {
    return ClientService.getClientHistory(customerId);
  });

  ipcMain.handle('clients:addDebt', async (_, { customerId, amount, description, userId }: any) => {
    try {
      const credit = ClientService.addDebt(customerId, amount, description, userId);
      AuditService.log('CLIENT_DEBT', 'client', customerId, `Dette ${amount} MAD`);
      return { success: true, data: credit };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clients:addPayment', async (_, { customerId, amount, description, userId }: any) => {
    try {
      const payment = ClientService.recordPayment(customerId, amount, description, userId);
      AuditService.log('CLIENT_PAYMENT', 'client', customerId, `Paiement ${amount} MAD`);
      return { success: true, data: payment };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clients:exportStatement', async (_, customerId: string) => {
    try {
      const client = ClientRepository.getById(customerId);
      if (!client) throw new Error('Client introuvable');
      const history = ClientRepository.getHistory(customerId);
      const filePath = await PDFService.generateClientStatement(client, history);
      shell.openPath(filePath);
      return { success: true, filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Fournisseurs ────────────────────────────────────────────────────────
  ipcMain.handle('suppliers:search', async (_, query: string) => {
    try {
      return SupplierService.searchSuppliers(query);
    } catch (error: any) {
      throw new Error(error.message);
    }
  });

  ipcMain.handle('suppliers:create', async (_, data: any) => {
    try {
      const supplier = SupplierService.createSupplier(data);
      AuditService.log('SUPPLIER_CREATE', 'supplier', supplier.id, `Fournisseur ${supplier.name}`);
      return { success: true, data: supplier };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('suppliers:update', async (_, { id, data }: any) => {
    try {
      return { success: true, data: SupplierService.updateSupplier(id, data) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('suppliers:getHistory', async (_, supplierId: string) => {
    try {
      return SupplierService.getSupplierHistory(supplierId);
    } catch (error: any) {
      throw new Error(error.message);
    }
  });

  ipcMain.handle('suppliers:addDebt', async (_, { supplierId, amount, description, userId }: any) => {
    try {
      const credit = SupplierService.addDebt(supplierId, amount, description, userId);
      AuditService.log('SUPPLIER_DEBT', 'supplier', supplierId, `Dette ${amount} MAD`);
      return { success: true, data: credit };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('suppliers:addPayment', async (_, { supplierId, amount, description, userId }: any) => {
    try {
      const payment = SupplierService.recordPayment(supplierId, amount, description, userId);
      AuditService.log('SUPPLIER_PAYMENT', 'supplier', supplierId, `Paiement ${amount} MAD`);
      return { success: true, data: payment };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Documents / Facturation ───────────────────────────────────────────────
  ipcMain.handle('documents:getAll', async (_, type: string) => {
    return DocumentService.getDocuments(type as any);
  });

  ipcMain.handle('documents:search', async (_, { type, query }: { type: string; query: string }) => {
    return DocumentService.getDocuments(type as any, query);
  });

  ipcMain.handle('documents:getById', async (_, id: string) => {
    return DocumentService.getDocument(id);
  });

  ipcMain.handle('documents:create', async (_, data: any) => {
    try {
      const doc = DocumentService.createDocument(data);
      AuditService.log('DOCUMENT_CREATE', 'document', doc.id, `${doc.type} ${doc.document_number}`);
      return { success: true, data: doc };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('documents:addPayment', async (_, data: any) => {
    try {
      DocumentService.addPayment(data);
      AuditService.log('DOCUMENT_PAYMENT', 'document', data.document_id, `Paiement ${data.amount} MAD`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('documents:convertBL', async (_, deliveryNoteId: string) => {
    try {
      const doc = DocumentService.convertBLToInvoice(deliveryNoteId);
      AuditService.log('BL_TO_INVOICE', 'document', deliveryNoteId, `BL converti en ${doc.document_number}`);
      return { success: true, data: doc };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('documents:createCreditNote', async (_, { invoiceId, reason }: { invoiceId: string; reason?: string }) => {
    try {
      const doc = DocumentService.createCreditNote(invoiceId, reason);
      AuditService.log('CREDIT_NOTE', 'document', doc.id, `Avoir ${doc.document_number} pour ${reason ?? 'retour'}`);
      return { success: true, data: doc };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('documents:getPayments', async (_, documentId: string) => {
    return DocumentService.getPayments(documentId);
  });

  ipcMain.handle('documents:exportPdf', async (_, documentId: string) => {
    try {
      const doc = DocumentService.getDocument(documentId);
      if (!doc) throw new Error('Document introuvable.');
      const filePath = await PDFService.generateDocument(doc);
      shell.openPath(filePath);
      return { success: true, filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Dashboard ────────────────────────────────────────────────────────────
  ipcMain.handle('dashboard:getStats', async () => {
    return DashboardRepository.getStats();
  });

  ipcMain.handle('dashboard:getTopProducts', async () => {
    return DashboardRepository.getTopProducts();
  });

  ipcMain.handle('dashboard:getTopClients', async () => {
    return DashboardRepository.getTopClients();
  });

  ipcMain.handle('dashboard:getLowStock', async () => {
    return DashboardRepository.getLowStockAlerts();
  });

  ipcMain.handle('dashboard:getUpcomingDues', async (_, days: number) => {
    return DashboardRepository.getUpcomingDues(days);
  });

  // ─── Backup ───────────────────────────────────────────────────────────────
  ipcMain.handle('backup:now', async (_, destinationDir?: string) => {
    try {
      const filePath = await BackupService.backup(destinationDir);
      return { success: true, path: filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('backup:list', async () => {
    return BackupService.listBackups();
  });
});
