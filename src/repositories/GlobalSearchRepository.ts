import { db } from '../database/config/connection';

/**
 * §Phase 5 — Recherche globale (Ctrl+K).
 *
 * Recherche transverse, PAGINÉE PAR GROUPE : chaque catégorie est limitée par
 * une requête SQL indexée (jamais de chargement complet de la base). Les
 * colonnes interrogées sont couvertes par les index existants :
 *   - products(reference), products(barcode), products(designation)
 *   - customers(name), customers(phone), suppliers(name)
 *   - documents(document_number), documents(type)
 *   - purchase_orders(order_number)
 */

export interface GlobalSearchProduct {
  id: string;
  reference: string;
  designation: string;
  barcode: string | null;
  selling_price: number;
}

export interface GlobalSearchParty {
  id: string;
  name: string;
  phone: string | null;
  documentCount: number;
}

export interface GlobalSearchDocument {
  id: string;
  document_number: string;
  type: string;
  party_name: string | null;
  total_incl_tax: number;
  date: string;
}

export interface GlobalSearchPurchase {
  id: string;
  order_number: string;
  supplier_name: string | null;
  total: number;
  date: string;
}

export interface GlobalSearchResult {
  query: string;
  products: GlobalSearchProduct[];
  customers: GlobalSearchParty[];
  suppliers: GlobalSearchParty[];
  documents: GlobalSearchDocument[];
  purchases: GlobalSearchPurchase[];
  total: number;
}

const MAX_PER_GROUP = 8;
const MAX_QUERY_LENGTH = 100;

export const GlobalSearchRepository = {
  /**
   * Recherche globale. Un terme vide ne renvoie rien (pas de scan complet).
   * @param rawQuery Terme saisi (nettoyé et borné ici).
   * @param perGroup Nombre max de résultats par groupe (1–25).
   */
  search(rawQuery: string, perGroup: number = MAX_PER_GROUP): GlobalSearchResult {
    const query = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, MAX_QUERY_LENGTH) : '';
    const limit = Math.min(Math.max(Number.isFinite(perGroup) ? Math.trunc(perGroup) : MAX_PER_GROUP, 1), 25);

    if (!query) {
      return { query: '', products: [], customers: [], suppliers: [], documents: [], purchases: [], total: 0 };
    }

    const like = `%${query}%`;
    const startsWith = `${query}%`;

    // Produits : référence, désignation, code-barres (tous indexés).
    const products = db.prepare(`
      SELECT id, reference, designation, barcode, selling_price
      FROM products
      WHERE reference LIKE ? OR designation LIKE ? OR barcode LIKE ?
      ORDER BY (reference LIKE ?) DESC, designation ASC
      LIMIT ?
    `).all(like, like, like, startsWith, limit) as GlobalSearchProduct[];

    // Clients : nom, téléphone, avec nombre de documents (sous-requête ciblée).
    const customers = db.prepare(`
      SELECT c.id, c.name, c.phone,
        (SELECT COUNT(*) FROM documents d WHERE d.entity_id = c.id) AS documentCount
      FROM customers c
      WHERE c.name LIKE ? OR c.phone LIKE ?
      ORDER BY (c.name LIKE ?) DESC, c.name ASC
      LIMIT ?
    `).all(like, like, startsWith, limit) as GlobalSearchParty[];

    // Fournisseurs : nom, téléphone.
    const suppliers = db.prepare(`
      SELECT s.id, s.name, s.phone,
        (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id) AS documentCount
      FROM suppliers s
      WHERE s.name LIKE ? OR s.phone LIKE ?
      ORDER BY (s.name LIKE ?) DESC, s.name ASC
      LIMIT ?
    `).all(like, like, startsWith, limit) as GlobalSearchParty[];

    // Documents (factures / BL / devis / avoirs) : numéro ou nom du client.
    const documents = db.prepare(`
      SELECT d.id, d.document_number, d.type, d.total_incl_tax, d.date,
             c.name AS party_name
      FROM documents d
      LEFT JOIN customers c ON c.id = d.entity_id
      WHERE d.document_number LIKE ? OR c.name LIKE ?
      ORDER BY (d.document_number LIKE ?) DESC, d.date DESC
      LIMIT ?
    `).all(like, like, startsWith, limit) as GlobalSearchDocument[];

    // Commandes d'achat : numéro ou nom du fournisseur.
    const purchases = db.prepare(`
      SELECT po.id, po.order_number, po.total, po.date, s.name AS supplier_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.order_number LIKE ? OR s.name LIKE ?
      ORDER BY (po.order_number LIKE ?) DESC, po.date DESC
      LIMIT ?
    `).all(like, like, startsWith, limit) as GlobalSearchPurchase[];

    const total = products.length + customers.length + suppliers.length + documents.length + purchases.length;

    return { query, products, customers, suppliers, documents, purchases, total };
  },
};
