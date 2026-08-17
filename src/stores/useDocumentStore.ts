import { create } from 'zustand';
import type { Document, DocumentType, PaymentMethod } from '../repositories/DocumentRepository';

interface DocumentState {
  documents: Document[];
  selectedDocument: Document | null;
  activeType: DocumentType;
  searchQuery: string;
  isLoading: boolean;
  error: string | null;

  setActiveType: (type: DocumentType) => void;
  setSearchQuery: (q: string) => void;
  loadDocuments: () => Promise<void>;
  selectDocument: (doc: Document) => Promise<void>;
  createDocument: (data: any) => Promise<Document>;
  addPayment: (documentId: string, amount: number, method: PaymentMethod, reference?: string) => Promise<void>;
  convertBL: (deliveryNoteId: string) => Promise<Document>;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  selectedDocument: null,
  activeType: 'INVOICE',
  searchQuery: '',
  isLoading: false,
  error: null,

  setActiveType: (type) => {
    set({ activeType: type, selectedDocument: null, searchQuery: '' });
    get().loadDocuments();
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q });
    get().loadDocuments();
  },

  loadDocuments: async () => {
    set({ isLoading: true, error: null });
    try {
      const { activeType, searchQuery } = get();
      const data = searchQuery.trim()
        ? await window.api.documents.search(activeType, searchQuery)
        : await window.api.documents.getAll(activeType);
      set({ documents: data, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  selectDocument: async (doc) => {
    set({ isLoading: true });
    try {
      const full = await window.api.documents.getById(doc.id);
      set({ selectedDocument: full, isLoading: false });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
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
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
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
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
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
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  }
}));
