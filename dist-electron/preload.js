"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const api = {
  products: {
    search: (query) => electron.ipcRenderer.invoke("products:search", query),
    create: (data) => electron.ipcRenderer.invoke("products:create", data)
  },
  stock: {
    getHistory: (productId) => electron.ipcRenderer.invoke("stock:getHistory", productId),
    getLevel: (productId) => electron.ipcRenderer.invoke("stock:getLevel", productId),
    addEntry: (data) => electron.ipcRenderer.invoke("stock:addEntry", data),
    addExit: (data) => electron.ipcRenderer.invoke("stock:addExit", data)
  },
  clients: {
    search: (query) => electron.ipcRenderer.invoke("clients:search", query),
    create: (data) => electron.ipcRenderer.invoke("clients:create", data),
    update: (id, data) => electron.ipcRenderer.invoke("clients:update", { id, data }),
    getHistory: (customerId) => electron.ipcRenderer.invoke("clients:getHistory", customerId),
    addDebt: (customerId, amount, description, userId) => electron.ipcRenderer.invoke("clients:addDebt", { customerId, amount, description, userId }),
    addPayment: (customerId, amount, description, userId) => electron.ipcRenderer.invoke("clients:addPayment", { customerId, amount, description, userId })
  },
  documents: {
    getAll: (type) => electron.ipcRenderer.invoke("documents:getAll", type),
    search: (type, query) => electron.ipcRenderer.invoke("documents:search", { type, query }),
    getById: (id) => electron.ipcRenderer.invoke("documents:getById", id),
    create: (data) => electron.ipcRenderer.invoke("documents:create", data),
    addPayment: (data) => electron.ipcRenderer.invoke("documents:addPayment", data),
    convertBL: (deliveryNoteId) => electron.ipcRenderer.invoke("documents:convertBL", deliveryNoteId),
    getPayments: (documentId) => electron.ipcRenderer.invoke("documents:getPayments", documentId)
  },
  dashboard: {
    getStats: () => electron.ipcRenderer.invoke("dashboard:getStats"),
    getTopProducts: () => electron.ipcRenderer.invoke("dashboard:getTopProducts"),
    getTopClients: () => electron.ipcRenderer.invoke("dashboard:getTopClients"),
    getLowStock: () => electron.ipcRenderer.invoke("dashboard:getLowStock"),
    getUpcomingDues: (days) => electron.ipcRenderer.invoke("dashboard:getUpcomingDues", days)
  },
  backup: {
    now: (destinationDir) => electron.ipcRenderer.invoke("backup:now", destinationDir),
    list: () => electron.ipcRenderer.invoke("backup:list")
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
exports.api = api;
