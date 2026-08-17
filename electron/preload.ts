import { contextBridge, ipcRenderer } from 'electron';

// On expose une API ultra sécurisée, typée et ciblée
export const api = {
  products: {
    search: (query: string) => ipcRenderer.invoke('products:search', query),
    create: (data: any) => ipcRenderer.invoke('products:create', data),
  },
  stock: {
    getHistory: (productId: string) => ipcRenderer.invoke('stock:getHistory', productId),
    getLevel: (productId: string) => ipcRenderer.invoke('stock:getLevel', productId),
    addEntry: (data: any) => ipcRenderer.invoke('stock:addEntry', data),
    addExit: (data: any) => ipcRenderer.invoke('stock:addExit', data),
  },
  clients: {
    search: (query: string) => ipcRenderer.invoke('clients:search', query),
    create: (data: any) => ipcRenderer.invoke('clients:create', data),
    update: (id: string, data: any) => ipcRenderer.invoke('clients:update', { id, data }),
    getHistory: (customerId: string) => ipcRenderer.invoke('clients:getHistory', customerId),
    addDebt: (customerId: string, amount: number, description: string, userId: string) =>
      ipcRenderer.invoke('clients:addDebt', { customerId, amount, description, userId }),
    addPayment: (customerId: string, amount: number, description: string, userId: string) =>
      ipcRenderer.invoke('clients:addPayment', { customerId, amount, description, userId }),
  },
  documents: {
    getAll: (type: string) => ipcRenderer.invoke('documents:getAll', type),
    search: (type: string, query: string) => ipcRenderer.invoke('documents:search', { type, query }),
    getById: (id: string) => ipcRenderer.invoke('documents:getById', id),
    create: (data: any) => ipcRenderer.invoke('documents:create', data),
    addPayment: (data: any) => ipcRenderer.invoke('documents:addPayment', data),
    convertBL: (deliveryNoteId: string) => ipcRenderer.invoke('documents:convertBL', deliveryNoteId),
    getPayments: (documentId: string) => ipcRenderer.invoke('documents:getPayments', documentId),
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
