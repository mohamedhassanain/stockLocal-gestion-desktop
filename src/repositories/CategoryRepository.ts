import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

export interface Category {
  id: string;
  name: string;
  description?: string;
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
const stmtInsert = db.prepare('INSERT INTO categories (id, name, description) VALUES (?, ?, ?)');
const stmtUpdate = db.prepare('UPDATE categories SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
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

  create(data: { name: string; description?: string }): Category {
    const id = randomUUID();
    stmtInsert.run(id, data.name, data.description ?? null);
    return { id, name: data.name, description: data.description, subcategories: [] };
  },

  update(id: string, data: { name: string; description?: string }): Category {
    stmtUpdate.run(data.name, data.description ?? null, id);
    const cat = this.getAll().find(c => c.id === id);
    if (!cat) throw new Error('Catégorie introuvable.');
    return cat;
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
