import { db } from '../database/config/connection';
import { DEFAULT_VAT_RATE, roundVatRate } from '../domain/tax/vatRates';

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
  // §Phase 15 : seuil haut de réapprovisionnement (0 = non défini). Colonne
  // NOT NULL avec défaut 0 — jamais null, pour rester aligné sur le contrat IPC.
  max_stock?: number;
  status: 'ACTIVE' | 'ARCHIVED' | 'DISABLED';
  // Phase 3 : produit géré par lots + date d'expiration (0/1). Défaut 0.
  batch_managed?: number | null;
  // Calculé dynamiquement (niveau de stock actuel)
  current_stock?: number;
  // Taux TVA (lu sur la table products)
  vat_rate?: number;
  // §TVA — si 1, le produit hérite du taux de sa CATÉGORIE au lieu du sien.
  // Colonne NOT NULL défaut 0 : elle ne vaut JAMAIS null (d'où l'absence de
  // `| null`, qui rendrait le type incompatible avec le contrat IPC).
  vat_inherit_from_category?: number;
}

// Colonnes modifiables d'un produit (sans les champs calculés)
export type ProductInput = Omit<Product, 'id' | 'current_stock' | 'created_at' | 'updated_at'>;

// Produit prêt pour insertion/mise à jour (avec id)
export type ProductWithId = ProductInput & { id: string };

export class ProductRepository {
  // Déclaration des requêtes préparées pour garantir une exécution < 100ms.
  // §14 : le stock courant est lu sur la balance précalculée (inventory_balances)
  // via LEFT JOIN — plus aucune agrégation corrélée par ligne sur tout l'historique.
  private static stmts = {
    findById: db.prepare(`
      SELECT p.*, COALESCE(ib.quantity, 0) AS current_stock
      FROM products p
      LEFT JOIN inventory_balances ib ON ib.product_id = p.id
      WHERE p.id = ?
    `),
    findByBarcode: db.prepare(`
      SELECT p.*, COALESCE(ib.quantity, 0) AS current_stock
      FROM products p
      LEFT JOIN inventory_balances ib ON ib.product_id = p.id
      WHERE p.barcode = ?
    `),
    findByReference: db.prepare(`
      SELECT p.*, COALESCE(ib.quantity, 0) AS current_stock
      FROM products p
      LEFT JOIN inventory_balances ib ON ib.product_id = p.id
      WHERE p.reference = ? COLLATE NOCASE
    `),
    search: db.prepare(`
      SELECT p.*, COALESCE(ib.quantity, 0) AS current_stock
      FROM products p
      LEFT JOIN inventory_balances ib ON ib.product_id = p.id
      WHERE p.designation LIKE @query OR p.reference LIKE @query OR p.barcode LIKE @query
      ORDER BY p.designation ASC
      LIMIT @limit OFFSET @offset
    `),
    // §TVA — `vat_rate` et `vat_inherit_from_category` sont désormais PERSISTÉS.
    // Ils étaient auparavant absents de l'INSERT/UPDATE : la TVA saisie dans le
    // formulaire produit était validée puis silencieusement jetée, et tout
    // produit restait à 20 % (valeur par défaut de la colonne).
    insert: db.prepare(`
      INSERT INTO products (id, reference, designation, description, category_id, subcategory_id, barcode, image_path, unit, purchase_price, selling_price, wholesale_price, min_stock, max_stock, batch_managed, vat_rate, vat_inherit_from_category, status)
      VALUES (@id, @reference, @designation, @description, @category_id, @subcategory_id, @barcode, @image_path, @unit, @purchase_price, @selling_price, @wholesale_price, @min_stock, @max_stock, @batch_managed, @vat_rate, @vat_inherit_from_category, @status)
    `),
    update: db.prepare(`
      UPDATE products 
      SET reference = @reference, designation = @designation, description = @description, category_id = @category_id, subcategory_id = @subcategory_id, barcode = @barcode, image_path = @image_path, unit = @unit, purchase_price = @purchase_price, selling_price = @selling_price, wholesale_price = @wholesale_price, min_stock = @min_stock, max_stock = @max_stock, batch_managed = @batch_managed, vat_rate = @vat_rate, vat_inherit_from_category = @vat_inherit_from_category, status = @status, updated_at = CURRENT_TIMESTAMP
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
    // Défauts sûrs si l'appelant ne les fournit pas : les colonnes sont NOT NULL.
    const maxStock = Number(product.max_stock ?? 0);
    const vatRate = Number(product.vat_rate);
    this.stmts.insert.run({
      batch_managed: 0,
      ...product,
      max_stock: Number.isFinite(maxStock) ? maxStock : 0,
      // Un taux fourni est borné/normalisé ; sinon le taux normal marocain.
      vat_rate: Number.isFinite(vatRate) ? roundVatRate(vatRate) : DEFAULT_VAT_RATE,
      vat_inherit_from_category: Number(product.vat_inherit_from_category ?? 0) === 1 ? 1 : 0,
    });
  }

  static update(product: ProductWithId): void {
    const maxStock = Number(product.max_stock ?? 0);
    // §TVA — un appelant qui ne fournit PAS de taux (patch partiel) ne doit pas
    // écraser silencieusement la TVA existante par 20 % : on relit la valeur
    // courante et on la conserve. C'est le seul cas où une lecture précède
    // l'écriture ; l'accès se fait par clé primaire (coût négligeable).
    const existing = this.stmts.findById.get(product.id) as Product | undefined;
    const providedRate = Number(product.vat_rate);
    const vatRate = Number.isFinite(providedRate)
      ? roundVatRate(providedRate)
      : roundVatRate(existing?.vat_rate ?? DEFAULT_VAT_RATE);
    const providedInherit = product.vat_inherit_from_category;
    const inherit = providedInherit === undefined || providedInherit === null
      ? Number(existing?.vat_inherit_from_category ?? 0) === 1 ? 1 : 0
      : (Number(providedInherit) === 1 ? 1 : 0);

    this.stmts.update.run({
      batch_managed: 0,
      ...product,
      max_stock: Number.isFinite(maxStock) ? maxStock : 0,
      vat_rate: vatRate,
      vat_inherit_from_category: inherit,
    });
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
