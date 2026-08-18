import { contextBridge, ipcRenderer } from 'electron';

// On expose une API ultra sécurisée, typée et ciblée
export const api = {
  products: {
    search: (query: string) => ipcRenderer.invoke('products:search', query),
    getAll: () => ipcRenderer.invoke('products:getAll'),
    create: (data: any) => ipcRenderer.invoke('products:create', data),
    update: (id: string, data: any) => ipcRenderer.invoke('products:update', { id, data }),
    archive: (id: string) => ipcRenderer.invoke('products:archive', id),
    activate: (id: string) => ipcRenderer.invoke('products:activate', id),
    disable: (id: string) => ipcRenderer.invoke('products:disable', id),
    importCsv: (filePath: string) => ipcRenderer.invoke('products:importCsv', filePath),
    printLabels: (productIds: string[]) => ipcRenderer.invoke('products:printLabels', productIds),
  },
  stock: {
    getHistory: (productId: string) => ipcRenderer.invoke('stock:getHistory', productId),
    getLevel: (productId: string) => ipcRenderer.invoke('stock:getLevel', productId),
    addEntry: (data: any) => ipcRenderer.invoke('stock:addEntry', data),
    addExit: (data: any) => ipcRenderer.invoke('stock:addExit', data),
    addInventory: (data: any, actualCount: number) => ipcRenderer.invoke('stock:addInventory', { data, actualCount }),
  },
  categories: {
    getAll: () => ipcRenderer.invoke('categories:getAll'),
    create: (data: any) => ipcRenderer.invoke('categories:create', data),
    update: (id: string, data: any) => ipcRenderer.invoke('categories:update', { id, data }),
    delete: (id: string) => ipcRenderer.invoke('categories:delete', id),
    addSub: (categoryId: string, data: any) => ipcRenderer.invoke('categories:addSub', { categoryId, data }),
    updateSub: (id: string, data: any) => ipcRenderer.invoke('categories:updateSub', { id, data }),
    deleteSub: (id: string) => ipcRenderer.invoke('categories:deleteSub', id),
  },
  discounts: {
    getAll: () => ipcRenderer.invoke('discounts:getAll'),
    create: (data: any) => ipcRenderer.invoke('discounts:create', data),
    update: (id: string, data: any) => ipcRenderer.invoke('discounts:update', { id, data }),
    delete: (id: string) => ipcRenderer.invoke('discounts:delete', id),
  },
  company: {
    get: () => ipcRenderer.invoke('company:get'),
    save: (settings: any) => ipcRenderer.invoke('company:save', settings),
  },
  audit: {
    getLogs: (limit?: number) => ipcRenderer.invoke('audit:getLogs', limit),
  },
  reports: {
    generate: (month?: string) => ipcRenderer.invoke('reports:generate', month),
    exportCsv: (data: any) => ipcRenderer.invoke('reports:exportCsv', data),
  },
  clients: {
    search: (query: string) => ipcRenderer.invoke('clients:search', query),
    create: (data: any) => ipcRenderer.invoke('clients:create', data),
    update: (id: string, data: any) => ipcRenderer.invoke('clients:update', { id, data }),
    delete: (id: string) => ipcRenderer.invoke('clients:delete', id),
    getHistory: (customerId: string) => ipcRenderer.invoke('clients:getHistory', customerId),
    getDocuments: (customerId: string) => ipcRenderer.invoke('clients:getDocuments', customerId),
    addDebt: (customerId: string, amount: number, description: string, userId: string) =>
      ipcRenderer.invoke('clients:addDebt', { customerId, amount, description, userId }),
    addPayment: (customerId: string, amount: number, description: string, userId: string) =>
      ipcRenderer.invoke('clients:addPayment', { customerId, amount, description, userId }),
    exportStatement: (customerId: string) => ipcRenderer.invoke('clients:exportStatement', customerId),
  },
  suppliers: {
    search: (query: string) => ipcRenderer.invoke('suppliers:search', query),
    create: (data: any) => ipcRenderer.invoke('suppliers:create', data),
    update: (id: string, data: any) => ipcRenderer.invoke('suppliers:update', { id, data }),
    delete: (id: string) => ipcRenderer.invoke('suppliers:delete', id),
    getHistory: (supplierId: string) => ipcRenderer.invoke('suppliers:getHistory', supplierId),
    addDebt: (supplierId: string, amount: number, description: string, userId: string) =>
      ipcRenderer.invoke('suppliers:addDebt', { supplierId, amount, description, userId }),
    addPayment: (supplierId: string, amount: number, description: string, userId: string) =>
      ipcRenderer.invoke('suppliers:addPayment', { supplierId, amount, description, userId }),
  },
  documents: {
    getAll: (type: string) => ipcRenderer.invoke('documents:getAll', type),
    search: (type: string, query: string) => ipcRenderer.invoke('documents:search', { type, query }),
    getById: (id: string) => ipcRenderer.invoke('documents:getById', id),
    create: (data: any) => ipcRenderer.invoke('documents:create', data),
    addPayment: (data: any) => ipcRenderer.invoke('documents:addPayment', data),
    convertBL: (deliveryNoteId: string) => ipcRenderer.invoke('documents:convertBL', deliveryNoteId),
    createCreditNote: (invoiceId: string, reason?: string) => ipcRenderer.invoke('documents:createCreditNote', { invoiceId, reason }),
    getPayments: (documentId: string) => ipcRenderer.invoke('documents:getPayments', documentId),
    exportPdf: (documentId: string) => ipcRenderer.invoke('documents:exportPdf', documentId),
  },
  dashboard: {
    getStats: () => ipcRenderer.invoke('dashboard:getStats'),
    getTopProducts: () => ipcRenderer.invoke('dashboard:getTopProducts'),
    getTopClients: () => ipcRenderer.invoke('dashboard:getTopClients'),
    getLowStock: () => ipcRenderer.invoke('dashboard:getLowStock'),
    getUpcomingDues: (days: number) => ipcRenderer.invoke('dashboard:getUpcomingDues', days),
  },
  backup: {
    now: (destinationDir?: string) => ipcRenderer.invoke('backup:now', destinationDir),
    list: () => ipcRenderer.invoke('backup:list'),
  }
};

contextBridge.exposeInMainWorld('api', api);

// Déclaration pour TypeScript côté React
declare global {
  interface Window {
    api: typeof api;
  }
}
