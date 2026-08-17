import { app, BrowserWindow, ipcMain } from 'electron';
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
import { ClientRepository } from '../src/repositories/ClientRepository';
import { SupplierService } from '../src/services/SupplierService';

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
      preload: path.join(__dirname, 'preload.mjs'), // Vite compile preload.ts en preload.mjs
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

// --- Enregistrement des Handlers IPC pour SQLite ---
app.whenReady().then(() => {
  createWindow();

  // Démarrer la sauvegarde automatique quotidienne
  BackupService.scheduleAutoBackup();

  // Produits
  ipcMain.handle('products:search', async (_, query: string) => {
    return ProductService.searchProducts(query);
  });

  ipcMain.handle('products:create', async (_, productData: any) => {
    try {
      return { success: true, data: ProductService.createProduct(productData) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Stock
  ipcMain.handle('stock:getHistory', async (_, productId: string) => {
    return StockMovementRepository.getHistory(productId);
  });

  ipcMain.handle('stock:getLevel', async (_, productId: string) => {
    return StockMovementRepository.getStockLevel(productId);
  });

  ipcMain.handle('stock:addEntry', async (_, data: any) => {
    try {
      return { success: true, data: StockService.addStockEntry(data) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('stock:addExit', async (_, data: any) => {
    try {
      return { success: true, data: StockService.addStockExit(data) };
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
      return { success: true, data: ClientService.createClient(data) };
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
      return { success: true, data: ClientService.addDebt(customerId, amount, description, userId) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clients:addPayment', async (_, { customerId, amount, description, userId }: any) => {
    try {
      return { success: true, data: ClientService.recordPayment(customerId, amount, description, userId) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('clients:exportStatement', async (_, customerId: string) => {
    try {
      const client = ClientRepository.getById(customerId);
      if (!client) throw new Error("Client introuvable");
      const history = ClientRepository.getHistory(customerId);
      const filePath = await PDFService.generateClientStatement(client, history);
      
      // Ouvrir le fichier automatiquement
      const { shell } = require('electron');
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
      return { success: true, data: SupplierService.createSupplier(data) };
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
      return { success: true, data: SupplierService.addDebt(supplierId, amount, description, userId) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('suppliers:addPayment', async (_, { supplierId, amount, description, userId }: any) => {
    try {
      return { success: true, data: SupplierService.recordPayment(supplierId, amount, description, userId) };
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
      return { success: true, data: DocumentService.createDocument(data) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('documents:addPayment', async (_, data: any) => {
    try {
      DocumentService.addPayment(data);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('documents:convertBL', async (_, deliveryNoteId: string) => {
    try {
      return { success: true, data: DocumentService.convertBLToInvoice(deliveryNoteId) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('documents:getPayments', async (_, documentId: string) => {
    return DocumentService.getPayments(documentId);
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
