import { contextBridge, ipcRenderer } from 'electron';

export const api = {
  // ─── Data Storage ──────────────────────────────────────────────────────────
  storage: {
    getConfig: () => ipcRenderer.invoke('storage:getConfig'),
    isFirstRun: () => ipcRenderer.invoke('storage:isFirstRun'),
    getRecommendedPath: () => ipcRenderer.invoke('storage:getRecommendedPath'),
    validatePath: (dataPath: string) => ipcRenderer.invoke('storage:validatePath', dataPath),
    setDataPath: (dataPath: string) => ipcRenderer.invoke('storage:setDataPath', dataPath),
    completeFirstRun: () => ipcRenderer.invoke('storage:completeFirstRun'),
    checkHealth: () => ipcRenderer.invoke('storage:checkHealth'),
    getDataPath: () => ipcRenderer.invoke('storage:getDataPath'),
    getBackupsPath: () => ipcRenderer.invoke('storage:getBackupsPath'),
    openFolder: (folderPath: string) => ipcRenderer.invoke('storage:openFolder', folderPath),
    pickFolder: () => ipcRenderer.invoke('storage:pickFolder'),
    migrateData: (fromPath: string, toPath: string) => ipcRenderer.invoke('storage:migrateData', { fromPath, toPath }),
  },

  // ─── Database Integrity ────────────────────────────────────────────────────
  db: {
    integrityCheck: () => ipcRenderer.invoke('db:integrityCheck'),
  },

  // ─── Produits ──────────────────────────────────────────────────────────────
  products: {
    search: (query: string) => ipcRenderer.invoke('products:search', query),
    // Phase 1 : recherche exacte par code-barres côté SQLite (1 produit, pas de scan de liste).
    getByBarcode: (barcode: string) => ipcRenderer.invoke('products:getByBarcode', barcode),
    getByReference: (reference: string) => ipcRenderer.invoke('products:getByReference', reference),
    getAll: () => ipcRenderer.invoke('products:getAll'),
    create: (data: any) => ipcRenderer.invoke('products:create', data),
    createWithStock: (productData: any, initialStock: number) => ipcRenderer.invoke('products:createWithStock', { productData, initialStock }),
    update: (id: string, data: any) => ipcRenderer.invoke('products:update', { id, data }),
    updateWithStock: (id: string, data: any, stockAdjustment: number) => ipcRenderer.invoke('products:updateWithStock', { id, data, stockAdjustment }),
    archive: (id: string) => ipcRenderer.invoke('products:archive', id),
    activate: (id: string) => ipcRenderer.invoke('products:activate', id),
    disable: (id: string) => ipcRenderer.invoke('products:disable', id),
    delete: (id: string) => ipcRenderer.invoke('products:delete', id),
    pickCsv: () => ipcRenderer.invoke('products:pickCsv'),
    importCsv: (filePath: string) => ipcRenderer.invoke('products:importCsv', filePath),
    previewImportCsv: (filePath: string) => ipcRenderer.invoke('products:previewImportCsv', filePath),
    confirmImport: (products: any[]) => ipcRenderer.invoke('products:confirmImport', products),
    printLabels: (productIds: string[]) => ipcRenderer.invoke('products:printLabels', productIds),
    pickImage: () => ipcRenderer.invoke('products:pickImage'),
    getImageBase64: (path: string) => ipcRenderer.invoke('products:getImageBase64', path),
  },

  // ─── Stock ─────────────────────────────────────────────────────────────────
  stock: {
    getHistory: (productId: string) => ipcRenderer.invoke('stock:getHistory', productId),
    // §2.6 : accepte { limit?, offset? } ou un simple nombre (rétro-compat).
    getAllHistory: (params?: number | { limit?: number; offset?: number }) =>
      ipcRenderer.invoke('stock:getAllHistory', typeof params === 'number' ? { limit: params } : params),
    getLevel: (productId: string) => ipcRenderer.invoke('stock:getLevel', productId),
    addEntry: (data: any) => ipcRenderer.invoke('stock:addEntry', data),
    addExit: (data: any) => ipcRenderer.invoke('stock:addExit', data),
    addInventory: (data: any, actualCount: number) => ipcRenderer.invoke('stock:addInventory', { data, actualCount }),
  },

  // ─── Catégories ────────────────────────────────────────────────────────────
  categories: {
    getAll: () => ipcRenderer.invoke('categories:getAll'),
    create: (data: any) => ipcRenderer.invoke('categories:create', data),
    update: (id: string, data: any) => ipcRenderer.invoke('categories:update', { id, data }),
    delete: (id: string) => ipcRenderer.invoke('categories:delete', id),
    addSub: (categoryId: string, data: any) => ipcRenderer.invoke('categories:addSub', { categoryId, data }),
    updateSub: (id: string, data: any) => ipcRenderer.invoke('categories:updateSub', { id, data }),
    deleteSub: (id: string) => ipcRenderer.invoke('categories:deleteSub', id),
  },

  // ─── Remises ───────────────────────────────────────────────────────────────
  discounts: {
    getAll: () => ipcRenderer.invoke('discounts:getAll'),
    create: (data: any) => ipcRenderer.invoke('discounts:create', data),
    update: (id: string, data: any) => ipcRenderer.invoke('discounts:update', { id, data }),
    delete: (id: string) => ipcRenderer.invoke('discounts:delete', id),
  },

  // ─── Entreprise ────────────────────────────────────────────────────────────
  company: {
    get: () => ipcRenderer.invoke('company:get'),
    save: (settings: any) => ipcRenderer.invoke('company:save', settings),
  },

  // ─── Audit ─────────────────────────────────────────────────────────────────
  audit: {
    getLogs: (limit?: number) => ipcRenderer.invoke('audit:getLogs', limit),
  },

  // ─── Rapports ──────────────────────────────────────────────────────────────
  reports: {
    generate: (month?: string) => ipcRenderer.invoke('reports:generate', month),
    exportCsv: (data: any) => ipcRenderer.invoke('reports:exportCsv', data),
  },

  // ─── Clients ───────────────────────────────────────────────────────────────
  clients: {
    search: (query: string) => ipcRenderer.invoke('clients:search', query),
    create: (data: any) => ipcRenderer.invoke('clients:create', data),
    update: (id: string, data: any) => ipcRenderer.invoke('clients:update', { id, data }),
    delete: (id: string) => ipcRenderer.invoke('clients:delete', id),
    getHistory: (customerId: string) => ipcRenderer.invoke('clients:getHistory', customerId),
    getDocuments: (customerId: string) => ipcRenderer.invoke('clients:getDocuments', customerId),
    addDebt: (customerId: string, amount: number, description: string) =>
      ipcRenderer.invoke('clients:addDebt', { customerId, amount, description }),
    addPayment: (customerId: string, amount: number, description: string) =>
      ipcRenderer.invoke('clients:addPayment', { customerId, amount, description }),
    exportStatement: (customerId: string) => ipcRenderer.invoke('clients:exportStatement', customerId),
  },

  // ─── Fournisseurs ──────────────────────────────────────────────────────────
  suppliers: {
    search: (query: string) => ipcRenderer.invoke('suppliers:search', query),
    create: (data: any) => ipcRenderer.invoke('suppliers:create', data),
    update: (id: string, data: any) => ipcRenderer.invoke('suppliers:update', { id, data }),
    delete: (id: string) => ipcRenderer.invoke('suppliers:delete', id),
    getHistory: (supplierId: string) => ipcRenderer.invoke('suppliers:getHistory', supplierId),
    addDebt: (supplierId: string, amount: number, description: string) =>
      ipcRenderer.invoke('suppliers:addDebt', { supplierId, amount, description }),
    addPayment: (supplierId: string, amount: number, description: string) =>
      ipcRenderer.invoke('suppliers:addPayment', { supplierId, amount, description }),
    exportStatement: (supplierId: string) => ipcRenderer.invoke('suppliers:exportStatement', supplierId),
  },

  // ─── Documents ─────────────────────────────────────────────────────────────
  documents: {
    getAll: (type: string) => ipcRenderer.invoke('documents:getAll', type),
    search: (type: string, query: string) => ipcRenderer.invoke('documents:search', { type, query }),
    getById: (id: string) => ipcRenderer.invoke('documents:getById', id),
    create: (data: any) => ipcRenderer.invoke('documents:create', data),
    addPayment: (data: any) => ipcRenderer.invoke('documents:addPayment', data),
    convertBL: (deliveryNoteId: string) => ipcRenderer.invoke('documents:convertBL', deliveryNoteId),
    createCreditNote: (invoiceId: string, returnItems?: Array<{ product_id: string; quantity: number }>, reason?: string) => ipcRenderer.invoke('documents:createCreditNote', { invoiceId, returnItems, reason }),
    getPayments: (documentId: string) => ipcRenderer.invoke('documents:getPayments', documentId),
    exportPdf: (documentId: string) => ipcRenderer.invoke('documents:exportPdf', documentId),
  },

  // ─── Dashboard ─────────────────────────────────────────────────────────────
  dashboard: {
    getStats: () => ipcRenderer.invoke('dashboard:getStats'),
    getTopProducts: () => ipcRenderer.invoke('dashboard:getTopProducts'),
    getTopClients: () => ipcRenderer.invoke('dashboard:getTopClients'),
    getLowStock: () => ipcRenderer.invoke('dashboard:getLowStock'),
    getUpcomingDues: (days: number) => ipcRenderer.invoke('dashboard:getUpcomingDues', days),
    getMonthlyRevenue: (months?: number) => ipcRenderer.invoke('dashboard:getMonthlyRevenue', months),
    getAlertSummary: () => ipcRenderer.invoke('dashboard:getAlertSummary'),
  },

  // ─── Backup ────────────────────────────────────────────────────────────────
  backup: {
    now: (destinationDir?: string) => ipcRenderer.invoke('backup:now', destinationDir),
    list: () => ipcRenderer.invoke('backup:list'),
    restore: (backupPath: string) => ipcRenderer.invoke('backup:restore', backupPath),
    delete: (backupPath: string) => ipcRenderer.invoke('backup:delete', backupPath),
    validate: (backupPath: string) => ipcRenderer.invoke('backup:validate', backupPath),
  },

  // ─── Unit Conversions ──────────────────────────────────────────────────────
  conversions: {
    getAll: () => ipcRenderer.invoke('conversions:getAll'),
    getByProduct: (productId: string) => ipcRenderer.invoke('conversions:getByProduct', productId),
    create: (data: any) => ipcRenderer.invoke('conversions:create', data),
    update: (id: string, data: any) => ipcRenderer.invoke('conversions:update', { id, data }),
    delete: (id: string) => ipcRenderer.invoke('conversions:delete', id),
    convert: (quantity: number, fromUnit: string, toUnit: string, productId?: string) =>
      ipcRenderer.invoke('conversions:convert', { quantity, fromUnit, toUnit, productId }),
  },

  // ─── Price History ─────────────────────────────────────────────────────────
  prices: {
    getHistory: (productId: string) => ipcRenderer.invoke('prices:getHistory', productId),
  },

  // ─── Purchase Orders ───────────────────────────────────────────────────────
  purchases: {
    getAll: () => ipcRenderer.invoke('purchases:getAll'),
    search: (query: string) => ipcRenderer.invoke('purchases:search', query),
    // Commandes d'achat d'un fournisseur précis — SQL ciblé (jamais tout chargé).
    getBySupplier: (supplierId: string) => ipcRenderer.invoke('purchases:getBySupplier', supplierId),
    getById: (id: string) => ipcRenderer.invoke('purchases:getById', id),
    create: (data: any) => ipcRenderer.invoke('purchases:create', data),
    confirm: (id: string) => ipcRenderer.invoke('purchases:confirm', id),
    receive: (id: string, receivedItems?: Array<{ item_id: string; received_qty: number }>) =>
      ipcRenderer.invoke('purchases:receive', { id, receivedItems }),
    cancel: (id: string) => ipcRenderer.invoke('purchases:cancel', id),
    delete: (id: string) => ipcRenderer.invoke('purchases:delete', id),
  },

  // ─── Inventory ─────────────────────────────────────────────────────────────
  inventory: {
    getAll: () => ipcRenderer.invoke('inventory:getAll'),
    getById: (id: string) => ipcRenderer.invoke('inventory:getById', id),
    create: (data: { name: string; notes?: string }) => ipcRenderer.invoke('inventory:create', data),
    startCounting: (id: string) => ipcRenderer.invoke('inventory:startCounting', id),
    countItem: (itemId: string, countedQty: number) => ipcRenderer.invoke('inventory:countItem', { itemId, countedQty }),
    calculateGaps: (id: string) => ipcRenderer.invoke('inventory:calculateGaps', id),
    validate: (id: string) => ipcRenderer.invoke('inventory:validate', id),
    delete: (id: string) => ipcRenderer.invoke('inventory:delete', id),
  },

  // ─── Export ────────────────────────────────────────────────────────────────
  export: {
    products: () => ipcRenderer.invoke('export:products'),
    clients: () => ipcRenderer.invoke('export:clients'),
    suppliers: () => ipcRenderer.invoke('export:suppliers'),
    stock: (productId?: string) => ipcRenderer.invoke('export:stock', productId),
    documents: (type?: string) => ipcRenderer.invoke('export:documents', type),
    dashboard: () => ipcRenderer.invoke('export:dashboard'),
  },

  // ─── Global Settings ───────────────────────────────────────────────────────
  globalSettings: {
    get: () => ipcRenderer.invoke('globalSettings:get'),
    save: (settings: any) => ipcRenderer.invoke('globalSettings:save', settings),
  },

  // ─── Migration (§35) ─────────────────────────────────────────────────────
  migration: {
    scanOldDatabases: () => ipcRenderer.invoke('migration:scanOldDatabases'),
    autoMigrate: () => ipcRenderer.invoke('migration:autoMigrate'),
    migrateFrom: (sourcePath: string) => ipcRenderer.invoke('migration:migrateFrom', sourcePath),
  },

  // ─── Mises à jour (§2.3) ─────────────────────────────────────────────────
  updates: {
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
    installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
    onUpdateAvailable: (callback: (info: { version: string }) => void) => {
      const listener = (_e: unknown, info: { version: string }) => callback(info);
      ipcRenderer.on('update:available', listener);
      return () => ipcRenderer.removeListener('update:available', listener);
    },
    onUpdateDownloaded: (callback: (info: { version: string }) => void) => {
      const listener = (_e: unknown, info: { version: string }) => callback(info);
      ipcRenderer.on('update:downloaded', listener);
      return () => ipcRenderer.removeListener('update:downloaded', listener);
    },
  },

  // ─── Journal d'erreurs (§2.5) ───────────────────────────────────────────
  logs: {
    exportErrorLog: () => ipcRenderer.invoke('logs:exportErrorLog'),
  },
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: typeof api;
  }
}
