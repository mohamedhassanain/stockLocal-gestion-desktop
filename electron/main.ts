import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireId, validateFilePath, hasPathTraversal, toHumanError } from './ipcValidation';
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
import { DemoDataService } from '../src/services/DemoDataService';
import { DataStorageService } from '../src/services/DataStorageService';
import { checkIntegrity } from '../src/database/config/connection';
import { UnitConversionRepository } from '../src/repositories/UnitConversionRepository';
import { PriceHistoryRepository } from '../src/repositories/PriceHistoryRepository';
import { PurchaseOrderRepository } from '../src/repositories/PurchaseOrderRepository';
import { InventorySessionRepository } from '../src/repositories/InventorySessionRepository';
import { ExportService } from '../src/services/ExportService';
import { GlobalSettingsService } from '../src/services/GlobalSettingsService';
import {
  safeParse,
  ProductCreateSchema,
  ProductUpdateSchema,
  ClientCreateSchema,
  ClientUpdateSchema,
  SupplierCreateSchema,
  SupplierUpdateSchema,
  SaleSchema,
  PaymentSchema,
  StockEntrySchema,
  StockExitSchema,
} from '../src/validation/schemas';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, '..');
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST;

let win: BrowserWindow | null;

/**
 * Sécurité Chromium/Electron :
 *  - sandbox: true  → le renderer n'a AUCUN accès Node (même limité)
 *  - contextIsolation: true → l'API exposée via preload est isolée du contexte page
 *  - nodeIntegration: false → pas d'accès direct à Node depuis le DOM
 *  - webSecurity reste activé par défaut
 */
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(process.env.VITE_PUBLIC ?? '', 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Bloquer toute navigation hors de l'application (anti-hijack, anti-phishing)
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = VITE_DEV_SERVER_URL
      ? url.startsWith(VITE_DEV_SERVER_URL)
      : url.startsWith('file://');
    if (!allowed) {
      event.preventDefault();
      // Ouvrir les liens externes dans le navigateur système si c'est un http(s) sûr
      if (/^https?:\/\//.test(url)) {
        shell.openExternal(url).catch(() => {});
      }
    }
  });

  // window.open / popups → jamais de nouvelle fenêtre Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
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
  // ─── Data Storage / Onboarding ────────────────────────────────────────────
  ipcMain.handle('storage:getConfig', async () => {
    return DataStorageService.getConfig();
  });

  ipcMain.handle('storage:isFirstRun', async () => {
    return DataStorageService.isFirstRun();
  });

  ipcMain.handle('storage:getRecommendedPath', async () => {
    return DataStorageService.getRecommendedPath();
  });

  ipcMain.handle('storage:validatePath', async (_, dataPath: string) => {
    return DataStorageService.validatePath(dataPath);
  });

  ipcMain.handle('storage:setDataPath', async (_, dataPath: string) => {
    try {
      DataStorageService.setDataPath(dataPath);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('storage:completeFirstRun', async () => {
    DataStorageService.completeFirstRun();
    return { success: true };
  });

  ipcMain.handle('storage:checkHealth', async () => {
    return DataStorageService.checkDiskHealth();
  });

  ipcMain.handle('storage:getDataPath', async () => {
    return DataStorageService.getConfig().dataPath;
  });

  ipcMain.handle('storage:getBackupsPath', async () => {
    return DataStorageService.getBackupsPath();
  });

  ipcMain.handle('storage:openFolder', async (_, folderPath: string) => {
    try {
      validateFilePath(folderPath, 'chemin dossier');
      await shell.openPath(folderPath);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('storage:pickFolder', async () => {
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choisir l\'emplacement des données',
      buttonLabel: 'Utiliser ce dossier',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, path: result.filePaths[0] };
  });

  ipcMain.handle('storage:migrateData', async (_, { fromPath, toPath }: { fromPath: string; toPath: string }) => {
    return DataStorageService.migrateData(fromPath, toPath);
  });

  // ─── Database Integrity ───────────────────────────────────────────────────
  ipcMain.handle('db:integrityCheck', async () => {
    return checkIntegrity();
  });

  // ─── Produits ──────────────────────────────────────────────────────────────
  ipcMain.handle('products:search', async (_, query: string) => {
    return ProductService.searchProducts(query);
  });

  ipcMain.handle('products:create', async (_, productData: any) => {
    try {
      const data = safeParse(ProductCreateSchema, productData, 'Création produit');
      const product = ProductService.createProduct(data);
      AuditService.log('PRODUCT_CREATE', 'product', product.id, `Création produit ${product.reference}`);
      return { success: true, data: product };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('products:update', async (_, { id, data }: { id: string; data: any }) => {
    try {
      const oldProduct = ProductRepository.findById(id);
      const product = ProductService.updateProduct(id, data);
      AuditService.log(
        'PRODUCT_UPDATE',
        'product',
        id,
        `Modification produit ${product.reference}`,
        oldProduct
          ? { purchase_price: oldProduct.purchase_price, selling_price: oldProduct.selling_price, wholesale_price: oldProduct.wholesale_price }
          : undefined,
        { purchase_price: product.purchase_price, selling_price: product.selling_price, wholesale_price: product.wholesale_price }
      );
      return { success: true, data: product };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('products:updateWithStock', async (_, { id, data, stockAdjustment }: { id: string; data: any; stockAdjustment: number }) => {
    try {
      const product = ProductService.updateProduct(id, data);
      if (stockAdjustment !== 0) {
        const currentStock = StockMovementRepository.getStockLevel(id);
        const newStock = currentStock + stockAdjustment;
        if (newStock < 0) {
          return { success: false, error: `Stock insuffisant. Stock actuel : ${currentStock}, tentative de retirer ${Math.abs(stockAdjustment)}.` };
        }
        if (stockAdjustment > 0) {
          StockService.addStockEntry({
            product_id: id,
            quantity: stockAdjustment,
            unit_price: data.purchase_price || 0,
            reference_doc: null as any,
            supplier_id: null as any,
            notes: `Ajustement stock: ${currentStock} → ${newStock}`
          });
        } else {
          StockService.addStockExit({
            product_id: id,
            quantity: Math.abs(stockAdjustment),
            unit_price: data.purchase_price || 0,
            exitType: 'CASSE',
            notes: `Ajustement stock: ${currentStock} → ${newStock}`
          });
        }
      }
      AuditService.log('PRODUCT_UPDATE', 'product', id, `Modification produit ${product.reference}${stockAdjustment !== 0 ? ` (stock ajusté de ${stockAdjustment})` : ''}`);
      return { success: true, data: product };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('products:archive', async (_, id: string) => {
    try {
      const safeId = requireId(id, 'id produit');
      ProductService.archiveProduct(safeId);
      AuditService.log('PRODUCT_ARCHIVE', 'product', safeId, 'Produit archivé');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('products:activate', async (_, id: string) => {
    try {
      const safeId = requireId(id, 'id produit');
      ProductService.activateProduct(safeId);
      AuditService.log('PRODUCT_ACTIVATE', 'product', safeId, 'Produit réactivé');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('products:disable', async (_, id: string) => {
    try {
      const safeId = requireId(id, 'id produit');
      ProductRepository.disable(safeId);
      AuditService.log('PRODUCT_DISABLE', 'product', safeId, 'Produit désactivé (retiré de la vente)');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('products:createWithStock', async (_, { productData, initialStock }: { productData: any; initialStock: number }) => {
    try {
      const product = ProductService.createProduct(productData);
      if (initialStock > 0) {
        StockService.addStockEntry({
          product_id: product.id,
          quantity: initialStock,
          unit_price: productData.purchase_price || 0,
          reference_doc: null as any,
          supplier_id: null as any,
          notes: 'Stock initial à la création'
        });
      }
      AuditService.log('PRODUCT_CREATE', 'product', product.id, `Création produit ${product.reference}${initialStock > 0 ? ` (stock initial: ${initialStock})` : ''}`);
      return { success: true, data: product };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('products:delete', async (_, id: string) => {
    try {
      const safeId = requireId(id, 'id produit');
      const product = ProductRepository.findById(safeId);
      if (!product) throw new Error('Produit introuvable.');
      ProductService.deleteProduct(safeId);
      AuditService.log('PRODUCT_DELETE', 'product', safeId, `Suppression définitive produit ${product.reference}`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
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
      const safeId = requireId(id, 'id catégorie');
      CategoryRepository.remove(safeId);
      AuditService.log('CATEGORY_DELETE', 'category', safeId, 'Catégorie supprimée');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
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
  ipcMain.handle('products:pickCsv', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }]
      });
      if (result.canceled || result.filePaths.length === 0) return { canceled: true };
      return { canceled: false, path: result.filePaths[0] };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('products:importCsv', async (_, filePath: string) => {
    try {
      if (hasPathTraversal(filePath)) throw new Error('Chemin de fichier non autorisé.');
      const result = ImportService.importProductsFromCsv(filePath);
      AuditService.log('PRODUCT_IMPORT', 'product', 'bulk', `Import CSV : ${result.imported} produits, ${result.errors} erreurs`);
      return { success: true, ...result };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  // ─── Étiquettes / codes-barres ─────────────────────────────────────────────
  ipcMain.handle('products:pickImage', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg','jpeg','png','gif','webp','bmp'] }]
      });
      if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };
      const srcPath = result.filePaths[0];
      const ext = path.extname(srcPath);
      const destDir = DataStorageService.getAttachmentsPath();
      const fs = require('fs');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const filename = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
      const destPath = path.join(destDir, filename);
      fs.copyFileSync(srcPath, destPath);
      return { success: true, path: destPath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('products:getImageBase64', async (_, imagePath: string) => {
    try {
      const fs = require('fs');
      if (!imagePath || !fs.existsSync(imagePath)) return { success: false };
      const buffer = fs.readFileSync(imagePath);
      const ext = require('path').extname(imagePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.gif': 'image/gif',
        '.webp': 'image/webp', '.bmp': 'image/bmp',
      };
      const mime = mimeMap[ext] || 'image/png';
      const base64 = buffer.toString('base64');
      return { success: true, dataUrl: `data:${mime};base64,${base64}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

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

  ipcMain.handle('reports:exportCsv', async (_, data: any) => {
    try {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const csv = (row: any[]) => row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';');
      const lines: string[] = [];

      lines.push('\uFEFF');
      lines.push(csv(['Rapport de gestion', new Date().toISOString().split('T')[0]]));
      lines.push('');
      lines.push(csv(['CA Jour', 'CA Semaine', 'CA Mois', 'Marge Mois', 'Valeur Stock', 'Impayés']));
      lines.push(csv([data.stats?.revenue_today, data.stats?.revenue_week, data.stats?.revenue_month, data.stats?.gross_margin_month, data.stats?.total_stock_value, data.stats?.unpaid_total]));
      lines.push('');
      lines.push(csv(['TOP PRODUITS']));
      lines.push(csv(['Produit', 'Référence', 'Quantité', 'CA']));
      for (const p of data.topProducts ?? []) lines.push(csv([p.designation, p.reference, p.total_qty, p.total_revenue]));
      lines.push('');
      lines.push(csv(['TOP CLIENTS']));
      lines.push(csv(['Client', 'Factures', 'CA']));
      for (const c of data.topClients ?? []) lines.push(csv([c.name, c.invoice_count, c.total_revenue]));
      lines.push('');
      lines.push(csv(['ALERTES STOCK']));
      lines.push(csv(['Produit', 'Référence', 'Stock', 'Min']));
      for (const s of data.lowStock ?? []) lines.push(csv([s.designation, s.reference, s.current_stock, s.min_stock]));
      lines.push('');
      lines.push(csv(['ECHEANCES']));
      lines.push(csv(['Document', 'Client', 'Echéance', 'Reste', 'Jours']));
      for (const d of data.dues ?? []) lines.push(csv([d.document_number, d.customer_name, d.due_date, d.remaining, d.days_left]));

      const exportsDir = DataStorageService.getExportsPath();
      mkdirSync(exportsDir, { recursive: true });
      const filePath = join(exportsDir, `rapport_${new Date().toISOString().split('T')[0]}.csv`);
      writeFileSync(filePath, lines.join('\r\n'), 'utf-8');
      shell.openPath(filePath);
      return { success: true, filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Stock ─────────────────────────────────────────────────────────────────
  ipcMain.handle('stock:getHistory', async (_, productId: string) => {
    return StockMovementRepository.getHistoryWithUser(productId);
  });

  ipcMain.handle('stock:getAllHistory', async (_, limit?: number) => {
    return StockMovementRepository.getAllHistory(limit ?? 200, 0);
  });

  ipcMain.handle('stock:getLevel', async (_, productId: string) => {
    return StockMovementRepository.getStockLevel(productId);
  });

  ipcMain.handle('stock:addEntry', async (_, data: any) => {
    try {
      const safe = safeParse(StockEntrySchema, data, 'Entrée de stock');
      const mvt = StockService.addStockEntry(safe);
      AuditService.log('STOCK_IN', 'stock', safe.product_id, `Entrée de ${safe.quantity}`);
      return { success: true, data: mvt };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('stock:addExit', async (_, data: any) => {
    try {
      const safe = safeParse(StockExitSchema, data, 'Sortie de stock');
      const mvt = StockService.addStockExit({ ...safe, exitType: safe.exitType });
      AuditService.log('STOCK_OUT', 'stock', safe.product_id, `Sortie de ${safe.quantity} (${safe.exitType})`);
      return { success: true, data: mvt };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
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
      const safe = safeParse(ClientCreateSchema, data, 'Création client');
      const client = ClientService.createClient(safe);
      AuditService.log('CLIENT_CREATE', 'client', client.id, `Client ${client.name}`);
      return { success: true, data: client };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('clients:update', async (_, { id, data }: { id: string; data: any }) => {
    try {
      const safe = safeParse(ClientUpdateSchema, data, 'Modification client');
      return { success: true, data: ClientService.updateClient(id, safe) };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('clients:delete', async (_, id: string) => {
    try {
      const safeId = requireId(id, 'id client');
      ClientService.deleteClient(safeId);
      AuditService.log('CLIENT_DELETE', 'client', safeId, 'Client supprimé');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('clients:getHistory', async (_, customerId: string) => {
    return ClientService.getClientHistory(customerId);
  });

  ipcMain.handle('clients:getDocuments', async (_, customerId: string) => {
    return ClientRepository.getDocuments(customerId);
  });

  ipcMain.handle('clients:addDebt', async (_, { customerId, amount, description }: any) => {
    try {
      const credit = ClientService.addDebt(customerId, amount, description);
      AuditService.log('CLIENT_DEBT', 'client', customerId, `Dette ${amount} MAD`);
      return { success: true, data: credit };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clients:addPayment', async (_, { customerId, amount, description }: any) => {
    try {
      const payment = ClientService.recordPayment(customerId, amount, description);
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
      const safe = safeParse(SupplierCreateSchema, data, 'Création fournisseur');
      const supplier = SupplierService.createSupplier(safe);
      AuditService.log('SUPPLIER_CREATE', 'supplier', supplier.id, `Fournisseur ${supplier.name}`);
      return { success: true, data: supplier };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('suppliers:update', async (_, { id, data }: any) => {
    try {
      const safe = safeParse(SupplierUpdateSchema, data, 'Modification fournisseur');
      return { success: true, data: SupplierService.updateSupplier(id, safe) };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('suppliers:delete', async (_, id: string) => {
    try {
      const safeId = requireId(id, 'id fournisseur');
      SupplierService.deleteSupplier(safeId);
      AuditService.log('SUPPLIER_DELETE', 'supplier', safeId, 'Fournisseur supprimé');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('suppliers:getHistory', async (_, supplierId: string) => {
    try {
      return SupplierService.getSupplierHistory(supplierId);
    } catch (error: any) {
      throw new Error(error.message);
    }
  });

  ipcMain.handle('suppliers:addDebt', async (_, { supplierId, amount, description }: any) => {
    try {
      const credit = SupplierService.addDebt(supplierId, amount, description);
      AuditService.log('SUPPLIER_DEBT', 'supplier', supplierId, `Dette ${amount} MAD`);
      return { success: true, data: credit };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('suppliers:addPayment', async (_, { supplierId, amount, description }: any) => {
    try {
      const payment = SupplierService.recordPayment(supplierId, amount, description);
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
      const safe = safeParse(PaymentSchema, data, 'Paiement document');
      DocumentService.addPayment(safe);
      AuditService.log('DOCUMENT_PAYMENT', 'document', safe.document_id, `Paiement ${safe.amount} MAD`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
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

  ipcMain.handle('documents:createCreditNote', async (_, { invoiceId, returnItems, reason }: { invoiceId: string; returnItems?: Array<{ product_id: string; quantity: number }>; reason?: string }) => {
    try {
      const doc = DocumentService.createCreditNote(invoiceId, returnItems, reason);
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
      const safeId = requireId(documentId, 'id document');
      const doc = DocumentService.getDocument(safeId);
      if (!doc) throw new Error('Document introuvable.');
      const filePath = await PDFService.generateDocument(doc);
      shell.openPath(filePath);
      return { success: true, filePath };
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
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

  ipcMain.handle('dashboard:getMonthlyRevenue', async (_, months?: number) => {
    return DashboardRepository.getMonthlyRevenue(months ?? 6);
  });

  ipcMain.handle('dashboard:getAlertSummary', async () => {
    return DashboardRepository.getAlertSummary();
  });

  // ─── Unit Conversions ─────────────────────────────────────────────────────
  ipcMain.handle('conversions:getAll', async () => {
    return UnitConversionRepository.getAll();
  });

  ipcMain.handle('conversions:getByProduct', async (_, productId: string) => {
    return UnitConversionRepository.getByProduct(productId);
  });

  ipcMain.handle('conversions:create', async (_, data: any) => {
    try {
      const conv = UnitConversionRepository.create(data);
      AuditService.log('CONVERSION_CREATE', 'conversion', conv.id, `${conv.from_unit} → ${conv.to_unit} (×${conv.factor})`);
      return { success: true, data: conv };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('conversions:update', async (_, { id, data }: { id: string; data: any }) => {
    try {
      return { success: true, data: UnitConversionRepository.update(id, data) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('conversions:delete', async (_, id: string) => {
    UnitConversionRepository.remove(id);
    return { success: true };
  });

  ipcMain.handle('conversions:convert', async (_, { quantity, fromUnit, toUnit, productId }: { quantity: number; fromUnit: string; toUnit: string; productId?: string }) => {
    const result = UnitConversionRepository.convert(quantity, fromUnit, toUnit, productId);
    if (result === null) {
      throw new Error(`Aucune conversion trouvée de ${fromUnit} vers ${toUnit}`);
    }
    return result;
  });

  // ─── Price History ─────────────────────────────────────────────────────────
  ipcMain.handle('prices:getHistory', async (_, productId: string) => {
    return PriceHistoryRepository.getByProduct(productId);
  });

  // ─── Purchase Orders ───────────────────────────────────────────────────────
  ipcMain.handle('purchases:getAll', async () => {
    return PurchaseOrderRepository.getAll();
  });

  ipcMain.handle('purchases:search', async (_, query: string) => {
    return PurchaseOrderRepository.search(query);
  });

  ipcMain.handle('purchases:getById', async (_, id: string) => {
    return PurchaseOrderRepository.getById(id);
  });

  ipcMain.handle('purchases:create', async (_, data: any) => {
    try {
      const order = PurchaseOrderRepository.create(data);
      AuditService.log('PURCHASE_CREATE', 'purchase', order.id, `Commande ${order.order_number}`);
      return { success: true, data: order };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('purchases:confirm', async (_, id: string) => {
    try {
      const order = PurchaseOrderRepository.confirm(id);
      AuditService.log('PURCHASE_CONFIRM', 'purchase', order.id, `Confirmée ${order.order_number}`);
      return { success: true, data: order };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('purchases:receive', async (_, { id, receivedItems }: { id: string; receivedItems?: Array<{ item_id: string; received_qty: number }> }) => {
    try {
      const order = PurchaseOrderRepository.receive(id, receivedItems);
      AuditService.log('PURCHASE_RECEIVE', 'purchase', order.id, `Réceptionnée ${order.order_number}`);
      return { success: true, data: order };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('purchases:cancel', async (_, id: string) => {
    try {
      const order = PurchaseOrderRepository.cancel(id);
      AuditService.log('PURCHASE_CANCEL', 'purchase', order.id, `Annulée ${order.order_number}`);
      return { success: true, data: order };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('purchases:delete', async (_, id: string) => {
    try {
      PurchaseOrderRepository.remove(id);
      AuditService.log('PURCHASE_DELETE', 'purchase', id, 'Commande supprimée');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Inventory Sessions ────────────────────────────────────────────────────
  ipcMain.handle('inventory:getAll', async () => {
    return InventorySessionRepository.getAll();
  });

  ipcMain.handle('inventory:getById', async (_, id: string) => {
    return InventorySessionRepository.getById(id);
  });

  ipcMain.handle('inventory:create', async (_, data: { name: string; notes?: string }) => {
    try {
      const session = InventorySessionRepository.create(data);
      AuditService.log('INVENTORY_CREATE', 'inventory', session.id, `Session "${session.name}"`);
      return { success: true, data: session };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('inventory:startCounting', async (_, id: string) => {
    try {
      const session = InventorySessionRepository.startCounting(id);
      AuditService.log('INVENTORY_COUNT_START', 'inventory', session.id, `Comptage démarré "${session.name}"`);
      return { success: true, data: session };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('inventory:countItem', async (_, { itemId, countedQty }: { itemId: string; countedQty: number }) => {
    try {
      InventorySessionRepository.countItem(itemId, countedQty);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('inventory:calculateGaps', async (_, id: string) => {
    try {
      const session = InventorySessionRepository.calculateGaps(id);
      AuditService.log('INVENTORY_CALCUL', 'inventory', session.id, `Écarts calculés "${session.name}"`);
      return { success: true, data: session };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('inventory:validate', async (_, id: string) => {
    try {
      const session = InventorySessionRepository.validate(id);
      AuditService.log('INVENTORY_VALIDATE', 'inventory', session.id, `Inventaire validé "${session.name}"`);
      return { success: true, data: session };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('inventory:delete', async (_, id: string) => {
    try {
      InventorySessionRepository.remove(id);
      AuditService.log('INVENTORY_DELETE', 'inventory', id, 'Session supprimée');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Export Service ────────────────────────────────────────────────────────
  ipcMain.handle('export:products', async () => {
    try {
      const filePath = ExportService.exportProducts();
      shell.openPath(filePath);
      return { success: true, filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('export:clients', async () => {
    try {
      const filePath = ExportService.exportClients();
      shell.openPath(filePath);
      return { success: true, filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('export:suppliers', async () => {
    try {
      const filePath = ExportService.exportSuppliers();
      shell.openPath(filePath);
      return { success: true, filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('export:stock', async (_, productId?: string) => {
    try {
      const filePath = ExportService.exportStockMovements(productId);
      shell.openPath(filePath);
      return { success: true, filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('export:documents', async (_, type?: string) => {
    try {
      const filePath = ExportService.exportDocuments(type);
      shell.openPath(filePath);
      return { success: true, filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('export:dashboard', async () => {
    try {
      const filePath = ExportService.exportDashboard();
      shell.openPath(filePath);
      return { success: true, filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Global Settings ──────────────────────────────────────────────────────
  ipcMain.handle('globalSettings:get', async () => {
    return GlobalSettingsService.getAll();
  });

  ipcMain.handle('globalSettings:save', async (_, settings: any) => {
    try {
      const saved = GlobalSettingsService.save(settings);
      return { success: true, data: saved };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Supplier Statement PDF ────────────────────────────────────────────────
  ipcMain.handle('suppliers:exportStatement', async (_, supplierId: string) => {
    try {
      const { SupplierRepository } = await import('../src/repositories/SupplierRepository');
      const supplierData = SupplierRepository.getById(supplierId);
      if (!supplierData) throw new Error('Fournisseur introuvable');
      const history = SupplierRepository.getHistory(supplierId);
      const filePath = await PDFService.generateSupplierStatement(supplierData, history);
      shell.openPath(filePath);
      return { success: true, filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Import Preview ────────────────────────────────────────────────────────
  ipcMain.handle('products:previewImportCsv', async (_, filePath: string) => {
    try {
      const result = ImportService.previewProductsFromCsv(filePath);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('products:confirmImport', async (_, products: any[]) => {
    try {
      const result = ImportService.confirmImport(products);
      AuditService.log('PRODUCT_IMPORT', 'product', 'bulk', `Import confirmé : ${result.imported} produits, ${result.errors} erreurs`);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ─── Backup ───────────────────────────────────────────────────────────────
  ipcMain.handle('backup:now', async (_, destinationDir?: string) => {
    try {
      const filePath = await BackupService.backup(destinationDir);
      AuditService.log('BACKUP_CREATE', 'system', 'backup', `Backup créé : ${filePath}`);
      return { success: true, path: filePath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('backup:list', async () => {
    return BackupService.listBackups();
  });

  ipcMain.handle('backup:restore', async (_, backupPath: string) => {
    try {
      validateFilePath(backupPath, 'chemin backup');
      const result = await BackupService.restoreBackup(backupPath);
      if (result.success) {
        AuditService.log('BACKUP_RESTORE', 'system', 'backup', `Restauration depuis : ${backupPath}`);
      }
      return result;
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('backup:delete', async (_, backupPath: string) => {
    try {
      validateFilePath(backupPath, 'chemin backup');
      return BackupService.deleteBackup(backupPath);
    } catch (error: any) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('backup:validate', async (_, backupPath: string) => {
    return BackupService.validateBackup(backupPath);
  });

  // ─── Migration (§35) ──────────────────────────────────────────────────────
  ipcMain.handle('migration:scanOldDatabases', async () => {
    const { MigrationService } = await import('../src/services/MigrationService');
    return MigrationService.scanForOldDatabases();
  });

  ipcMain.handle('migration:autoMigrate', async () => {
    const { MigrationService } = await import('../src/services/MigrationService');
    return MigrationService.autoMigrate();
  });

  ipcMain.handle('migration:migrateFrom', async (_, sourcePath: string) => {
    validateFilePath(sourcePath, 'chemin source');
    const { MigrationService } = await import('../src/services/MigrationService');
    return MigrationService.migrateFromOldDatabase(sourcePath);
  });

  // ─── Démarrage ────────────────────────────────────────────────────────────
  try {
    DemoDataService.seedIfEmpty();
  } catch (error) {
    console.error('[Seed] Échec du jeu de données de démonstration :', error);
  }
  AuditService.log('APP_START', 'system', 'stocklocal', 'Application démarrée');
  BackupService.scheduleAutoBackup();
  createWindow();
});
