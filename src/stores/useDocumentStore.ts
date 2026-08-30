import { create } from 'zustand';
import type { Document, DocumentType, PaymentMethod } from '../repositories/DocumentRepository';

// Types d'entrée IPC (cohérents avec electron/preload.ts).
interface SaleItemInput { product_id: string; quantity: number; unit_price: number; discount?: number; }
interface SaleCreateInput { type: 'QUOTE' | 'DELIVERY_NOTE' | 'INVOICE' | 'CREDIT_NOTE'; entity_id: string; date: string; due_date?: string | null; notes?: string | null; items: SaleItemInput[]; }
interface DocumentUpdateInput { entity_id: string; date: string; due_date?: string | null; notes?: string | null; items: SaleItemInput[]; }

interface DocumentState {
  documents: Document[];
  selectedDocument: Document | null;
  activeType: DocumentType;
  searchQuery: string;
  statusFilter: string;
  isLoading: boolean;
  error: string | null;

  setActiveType: (type: DocumentType) => void;
  setSearchQuery: (q: string) => void;
  setStatusFilter: (status: string) => void;
  loadDocuments: () => Promise<void>;
  loadMoreDocuments: () => Promise<void>;
  selectDocument: (doc: Document) => Promise<void>;
  createDocument: (data: SaleCreateInput) => Promise<Document>;
  addPayment: (documentId: string, amount: number, method: PaymentMethod, reference?: string) => Promise<void>;
  convertBL: (deliveryNoteId: string) => Promise<Document>;
  deleteDocument: (id: string) => Promise<void>;
  updateNotes: (id: string, notes: string) => Promise<void>;
  updateDocument: (id: string, data: DocumentUpdateInput) => Promise<Document>;
  clearSelectedDocument: () => void;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  selectedDocument: null,
  activeType: 'INVOICE',
  searchQuery: '',
  statusFilter: '',
  isLoading: false,
  error: null,

  setActiveType: (type) => {
    set({ activeType: type, selectedDocument: null, searchQuery: '', statusFilter: '' });
    get().loadDocuments();
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q });
    get().loadDocuments();
  },

  setStatusFilter: (status) => {
    set({ statusFilter: status, selectedDocument: null });
    get().loadDocuments();
  },

  loadDocuments: async () => {
    set({ isLoading: true, error: null });
    try {
      const { activeType, searchQuery, statusFilter } = get();
      const status = statusFilter ? statusFilter : undefined;
      const data = searchQuery.trim()
        ? await window.api.documents.search(activeType, searchQuery, status)
        : await window.api.documents.getAll(activeType, { limit: 100, offset: 0, status });
      set({ documents: data, isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
    }
  },

  loadMoreDocuments: async () => {
    const { activeType, searchQuery, documents, isLoading, statusFilter } = get();
    if (isLoading || searchQuery.trim()) return;
    set({ isLoading: true });
    try {
      const status = statusFilter ? statusFilter : undefined;
      const next = await window.api.documents.getAll(activeType, { limit: 100, offset: documents.length, status });
      set({ documents: [...documents, ...next], isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
    }
  },

  selectDocument: async (doc) => {
    set({ isLoading: true });
    try {
      const full = await window.api.documents.getById(doc.id);
      set({ selectedDocument: full, isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
    }
  },

  createDocument: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.documents.create(data);
      if (!result.success) throw new Error(result.error);
      await get().loadDocuments();
      set({ isLoading: false });
      return result.data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  addPayment: async (documentId, amount, method, reference) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.documents.addPayment({ document_id: documentId, amount, payment_method: method, reference });
      if (!result.success) throw new Error(result.error);
      await get().loadDocuments();
      // Rafraîchir le document sélectionné
      if (get().selectedDocument?.id === documentId) {
        const full = await window.api.documents.getById(documentId);
        set({ selectedDocument: full });
      }
      set({ isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  convertBL: async (deliveryNoteId) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.documents.convertBL(deliveryNoteId);
      if (!result.success) throw new Error(result.error);
      set({ activeType: 'INVOICE' });
      await get().loadDocuments();
      set({ isLoading: false });
      return result.data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  deleteDocument: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.documents.delete(id);
      if (!result.success) throw new Error(result.error);
      if (get().selectedDocument?.id === id) set({ selectedDocument: null });
      await get().loadDocuments();
      set({ isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  updateNotes: async (id, notes) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.documents.updateNotes(id, notes);
      if (!result.success) throw new Error(result.error);
      if (get().selectedDocument?.id === id) {
        const full = await window.api.documents.getById(id);
        set({ selectedDocument: full });
      }
      await get().loadDocuments();
      set({ isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  updateDocument: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.documents.update(id, data);
      if (!result.success) throw new Error(result.error);
      if (get().selectedDocument?.id === id) {
        const full = await window.api.documents.getById(id);
        set({ selectedDocument: full });
      }
      await get().loadDocuments();
      set({ isLoading: false });
      return result.data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  clearSelectedDocument: () => set({ selectedDocument: null })
}));
