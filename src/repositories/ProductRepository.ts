import { db } from '../database/config/connection';

// Types minimaux pour la démonstration (doivent idéalement être dans src/types)
export interface Product {
  id: string;
  reference: string;
  designation: string;
  description?: string;
  category_id?: string;
  subcategory_id?: string;
  barcode?: string;
  image_path?: string;
  purchase_price: number;
  selling_price: number;
  wholesale_price: number;
  min_stock: number;
  status: 'ACTIVE' | 'ARCHIVED' | 'DISABLED';
}

export class ProductRepository {
  // Déclaration des requêtes préparées pour garantir une exécution < 100ms
  private static stmts = {
    findById: db.prepare('SELECT * FROM products WHERE id = ?'),
    findByBarcode: db.prepare('SELECT * FROM products WHERE barcode = ?'),
    search: db.prepare(`
      SELECT * FROM products 
      WHERE designation LIKE @query OR reference LIKE @query OR barcode LIKE @query
      LIMIT @limit OFFSET @offset
    `),
    insert: db.prepare(`
      INSERT INTO products (id, reference, designation, description, category_id, subcategory_id, barcode, image_path, purchase_price, selling_price, wholesale_price, min_stock, status)
      VALUES (@id, @reference, @designation, @description, @category_id, @subcategory_id, @barcode, @image_path, @purchase_price, @selling_price, @wholesale_price, @min_stock, @status)
    `),
    update: db.prepare(`
      UPDATE products 
      SET reference = @reference, designation = @designation, description = @description, category_id = @category_id, subcategory_id = @subcategory_id, barcode = @barcode, image_path = @image_path, purchase_price = @purchase_price, selling_price = @selling_price, wholesale_price = @wholesale_price, min_stock = @min_stock, status = @status, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `),
    archive: db.prepare('UPDATE products SET status = \'ARCHIVED\' WHERE id = ?')
  };

  static findById(id: string): Product | undefined {
    return this.stmts.findById.get(id) as Product | undefined;
  }

  static findByBarcode(barcode: string): Product | undefined {
    return this.stmts.findByBarcode.get(barcode) as Product | undefined;
  }

  static search(query: string, limit: number = 50, offset: number = 0): Product[] {
    return this.stmts.search.all({ query: `%${query}%`, limit, offset }) as Product[];
  }

  static create(product: Product): void {
    this.stmts.insert.run(product);
  }

  static update(product: Product): void {
    this.stmts.update.run(product);
  }

  static archive(id: string): void {
    this.stmts.archive.run(id);
  }
}
