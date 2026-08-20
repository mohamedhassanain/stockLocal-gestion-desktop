import { db } from '../database/config/connection';

// Types minimaux pour la démonstration (doivent idéalement être dans src/types)
export interface Product {
  id: string;
  reference: string;
  designation: string;
  description?: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
  barcode?: string | null;
  image_path?: string | null;
  unit?: string;
  purchase_price: number;
  selling_price: number;
  wholesale_price: number;
  min_stock: number;
  status: 'ACTIVE' | 'ARCHIVED' | 'DISABLED';
  // Calculé dynamiquement (niveau de stock actuel)
  current_stock?: number;
}

// Colonnes modifiables d'un produit (sans les champs calculés)
export type ProductInput = Omit<Product, 'id' | 'current_stock' | 'created_at' | 'updated_at'>;

// Produit prêt pour insertion/mise à jour (avec id)
export type ProductWithId = ProductInput & { id: string };

export class ProductRepository {
  // Déclaration des requêtes préparées pour garantir une exécution < 100ms
  private static stmts = {
    findById: db.prepare(`
      SELECT p.*,
        COALESCE((SELECT SUM(CASE WHEN sm.type IN ('IN','INVENTORY') THEN sm.quantity ELSE -sm.quantity END)
                  FROM stock_movements sm WHERE sm.product_id = p.id), 0) AS current_stock
      FROM products p WHERE p.id = ?
    `),
    findByBarcode: db.prepare(`
      SELECT p.*,
        COALESCE((SELECT SUM(CASE WHEN sm.type IN ('IN','INVENTORY') THEN sm.quantity ELSE -sm.quantity END)
                  FROM stock_movements sm WHERE sm.product_id = p.id), 0) AS current_stock
      FROM products p WHERE p.barcode = ?
    `),
    findByReference: db.prepare(`
      SELECT p.*,
        COALESCE((SELECT SUM(CASE WHEN sm.type IN ('IN','INVENTORY') THEN sm.quantity ELSE -sm.quantity END)
                  FROM stock_movements sm WHERE sm.product_id = p.id), 0) AS current_stock
      FROM products p
      WHERE p.reference = ? COLLATE NOCASE
    `),
    search: db.prepare(`
      SELECT p.*,
        COALESCE((SELECT SUM(CASE WHEN sm.type IN ('IN','INVENTORY') THEN sm.quantity ELSE -sm.quantity END)
                  FROM stock_movements sm WHERE sm.product_id = p.id), 0) AS current_stock
      FROM products p
      WHERE p.designation LIKE @query OR p.reference LIKE @query OR p.barcode LIKE @query
      ORDER BY p.designation ASC
      LIMIT @limit OFFSET @offset
    `),
    insert: db.prepare(`
      INSERT INTO products (id, reference, designation, description, category_id, subcategory_id, barcode, image_path, unit, purchase_price, selling_price, wholesale_price, min_stock, status)
      VALUES (@id, @reference, @designation, @description, @category_id, @subcategory_id, @barcode, @image_path, @unit, @purchase_price, @selling_price, @wholesale_price, @min_stock, @status)
    `),
    update: db.prepare(`
      UPDATE products 
      SET reference = @reference, designation = @designation, description = @description, category_id = @category_id, subcategory_id = @subcategory_id, barcode = @barcode, image_path = @image_path, unit = @unit, purchase_price = @purchase_price, selling_price = @selling_price, wholesale_price = @wholesale_price, min_stock = @min_stock, status = @status, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `),
    archive: db.prepare('UPDATE products SET status = \'ARCHIVED\', updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
    activate: db.prepare('UPDATE products SET status = \'ACTIVE\', updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
    disable: db.prepare('UPDATE products SET status = \'DISABLED\', updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
    delete: db.prepare('DELETE FROM products WHERE id = ?')
  };

  static findById(id: string): Product | undefined {
    return this.stmts.findById.get(id) as Product | undefined;
  }

  static findByBarcode(barcode: string): Product | undefined {
    return this.stmts.findByBarcode.get(barcode) as Product | undefined;
  }

  /** Recherche exacte SQL pour les références saisies/scannées au POS. */
  static findByReference(reference: string): Product | undefined {
    return this.stmts.findByReference.get(reference) as Product | undefined;
  }

  static search(query: string, limit: number = 50, offset: number = 0): Product[] {
    return this.stmts.search.all({ query: `%${query}%`, limit, offset }) as Product[];
  }

  static create(product: ProductWithId): void {
    this.stmts.insert.run(product);
  }

  static update(product: ProductWithId): void {
    this.stmts.update.run(product);
  }

  static archive(id: string): void {
    this.stmts.archive.run(id);
  }

  static activate(id: string): void {
    this.stmts.activate.run(id);
  }

  static disable(id: string): void {
    this.stmts.disable.run(id);
  }

  static remove(id: string): void {
    this.stmts.delete.run(id);
  }
}
