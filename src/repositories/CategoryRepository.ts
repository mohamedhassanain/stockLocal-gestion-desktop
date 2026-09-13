import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

export interface Category {
  id: string;
  name: string;
  description?: string;
  // §TVA — taux applicable à la catégorie. `null` = « utiliser le taux par
  // défaut de l'entreprise ». Un produit peut toujours le surcharger :
  // résolution produit → catégorie → défaut société (TaxService).
  vat_rate?: number | null;
  subcategories?: Subcategory[];
}

export interface Subcategory {
  id: string;
  category_id: string;
  name: string;
  description?: string;
}

const stmtAll = db.prepare('SELECT * FROM categories ORDER BY name ASC');

// §16 : toutes les sous-catégories chargées en UNE requête puis groupées en
// mémoire — suppression du N+1 (1 requête par catégorie).
const stmtAllSubs = db.prepare('SELECT * FROM subcategories ORDER BY name ASC');
const stmtInsert = db.prepare('INSERT INTO categories (id, name, description, vat_rate) VALUES (?, ?, ?, ?)');
const stmtUpdate = db.prepare('UPDATE categories SET name = ?, description = ?, vat_rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
const stmtSetVatRate = db.prepare('UPDATE categories SET vat_rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
const stmtGetVatRate = db.prepare('SELECT vat_rate FROM categories WHERE id = ?');
const stmtDelete = db.prepare('DELETE FROM categories WHERE id = ?');
const stmtInsertSub = db.prepare('INSERT INTO subcategories (id, category_id, name, description) VALUES (?, ?, ?, ?)');
const stmtUpdateSub = db.prepare('UPDATE subcategories SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
const stmtDeleteSub = db.prepare('DELETE FROM subcategories WHERE id = ?');

export const CategoryRepository = {
  getAll(): Category[] {
    const categories = stmtAll.all() as Category[];
    const allSubs = stmtAllSubs.all() as Subcategory[];
    const subsByCategory = new Map<string, Subcategory[]>();
    for (const sub of allSubs) {
      const list = subsByCategory.get(sub.category_id);
      if (list) list.push(sub);
      else subsByCategory.set(sub.category_id, [sub]);
    }
    for (const cat of categories) {
      cat.subcategories = subsByCategory.get(cat.id) ?? [];
    }
    return categories;
  },

  create(data: { name: string; description?: string; vat_rate?: number | null }): Category {
    const id = randomUUID();
    const vatRate = typeof data.vat_rate === 'number' ? data.vat_rate : null;
    stmtInsert.run(id, data.name, data.description ?? null, vatRate);
    return { id, name: data.name, description: data.description, vat_rate: vatRate, subcategories: [] };
  },

  update(id: string, data: { name: string; description?: string; vat_rate?: number | null }): Category {
    const existing = stmtGetVatRate.get(id) as { vat_rate: number | null } | undefined;
    if (existing === undefined) throw new Error('Catégorie introuvable.');
    // `undefined` = « ne pas changer le taux » ; `null` = « revenir au défaut ».
    const vatRate = data.vat_rate === undefined ? (existing.vat_rate ?? null) : data.vat_rate;
    stmtUpdate.run(data.name, data.description ?? null, vatRate, id);
    const cat = this.getAll().find(c => c.id === id);
    if (!cat) throw new Error('Catégorie introuvable.');
    return cat;
  },

  /** §TVA — taux de la catégorie (`null` si non défini → hériter du défaut). */
  getVatRate(categoryId: string): number | null {
    const row = stmtGetVatRate.get(categoryId) as { vat_rate: number | null } | undefined;
    if (!row) return null;
    return typeof row.vat_rate === 'number' ? row.vat_rate : null;
  },

  /** §TVA — définit (ou efface avec `null`) le taux de TVA d'une catégorie. */
  setVatRate(categoryId: string, vatRate: number | null): number | null {
    const row = stmtGetVatRate.get(categoryId) as { vat_rate: number | null } | undefined;
    if (row === undefined) throw new Error('Catégorie introuvable.');
    stmtSetVatRate.run(vatRate, categoryId);
    return vatRate;
  },

  remove(id: string): void {
    stmtDelete.run(id);
  },

  addSubcategory(categoryId: string, data: { name: string; description?: string }): Subcategory {
    const id = randomUUID();
    stmtInsertSub.run(id, categoryId, data.name, data.description ?? null);
    return { id, category_id: categoryId, name: data.name, description: data.description };
  },

  updateSubcategory(id: string, data: { name: string; description?: string }): Subcategory {
    stmtUpdateSub.run(data.name, data.description ?? null, id);
    const row = db.prepare('SELECT * FROM subcategories WHERE id = ?').get(id) as Subcategory;
    if (!row) throw new Error('Sous-catégorie introuvable.');
    return row;
  },

  removeSubcategory(id: string): void {
    stmtDeleteSub.run(id);
  }
};
