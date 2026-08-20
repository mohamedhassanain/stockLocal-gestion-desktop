import { Product, ProductRepository, ProductInput } from '../repositories/ProductRepository';
import { PriceHistoryRepository } from '../repositories/PriceHistoryRepository';
import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

export class ProductService {
  /**
   * Crée un nouveau produit avec validation des règles métier.
   */
  static createProduct(productData: ProductInput): Product {
    // 1. Validation métier (ex: prix de vente >= prix d'achat)
    if (productData.selling_price < productData.purchase_price) {
      throw new Error('Le prix de vente ne peut pas être inférieur au prix d\'achat.');
    }

    // 2. Vérification d'unicité (code-barres)
    if (productData.barcode) {
      const existing = ProductRepository.findByBarcode(productData.barcode);
      if (existing) {
        throw new Error(`Le code-barres ${productData.barcode} est déjà utilisé.`);
      }
    }

    // 3. Vérification d'unicité (référence)
    const byRef = ProductRepository.search(productData.reference, 1);
    if (byRef.some(p => p.reference === productData.reference)) {
      throw new Error(`La référence ${productData.reference} est déjà utilisée.`);
    }

    // 4. Normalisation des champs optionnels (better-sqlite3 exige la clé,
    //    même nulle) + génération de l'ID
    const newProduct = {
      ...productData,
      id: randomUUID(),
      description: productData.description ?? null,
      category_id: productData.category_id ?? null,
      subcategory_id: productData.subcategory_id ?? null,
      barcode: productData.barcode ?? null,
      image_path: productData.image_path ?? null,
      unit: productData.unit || 'PIÈCE',
      status: productData.status || 'ACTIVE'
    };

    ProductRepository.create(newProduct);
    return ProductRepository.findById(newProduct.id)!;
  }

  /**
   * Met à jour un produit existant.
   */
  static updateProduct(id: string, productData: ProductInput): Product {
    const existing = ProductRepository.findById(id);
    if (!existing) throw new Error('Produit introuvable.');

    if (productData.selling_price < productData.purchase_price) {
      throw new Error('Le prix de vente ne peut pas être inférieur au prix d\'achat.');
    }

    // Capturer les anciens prix AVANT la mise à jour
    const oldPrices = {
      purchase_price: existing.purchase_price,
      selling_price: existing.selling_price,
      wholesale_price: existing.wholesale_price
    };

    ProductRepository.update({
      ...productData,
      id,
      description: productData.description ?? null,
      category_id: productData.category_id ?? null,
      subcategory_id: productData.subcategory_id ?? null,
      barcode: productData.barcode ?? null,
      image_path: productData.image_path ?? null,
      unit: productData.unit || 'PIÈCE',
      status: productData.status || 'ACTIVE',
    });
    const updated = ProductRepository.findById(id);
    if (!updated) throw new Error('Erreur lors de la mise à jour du produit.');

    // Enregistrer l'historique des prix si les prix ont changé
    PriceHistoryRepository.recordChange(
      id,
      oldPrices,
      {
        purchase_price: updated.purchase_price,
        selling_price: updated.selling_price,
        wholesale_price: updated.wholesale_price
      }
    );

    return updated;
  }

  /**
   * Archive un produit (masqué de la vente mais conservé en historique).
   */
  static archiveProduct(id: string): void {
    const existing = ProductRepository.findById(id);
    if (!existing) throw new Error('Produit introuvable.');
    if (existing.status === 'ARCHIVED') return;
    ProductRepository.archive(id);
  }

  /**
   * Réactive un produit archivé.
   */
  static activateProduct(id: string): void {
    const existing = ProductRepository.findById(id);
    if (!existing) throw new Error('Produit introuvable.');
    if (existing.status === 'ACTIVE') return;
    ProductRepository.activate(id);
  }

  /**
   * Supprime définitivement un produit.
   *
   * Protection des données historiques (§9) :
   *  - si le produit a le moindre mouvement de stock ou une ligne dans un document
   *    (facture, devis, BL, achat, avoir…), la suppression est REFUSÉE :
   *    l'utilisateur doit utiliser "Archiver" à la place.
   *  - seul un produit sans historique (créé par erreur, jamais utilisé)
   *    peut être supprimé physiquement.
   */
  static deleteProduct(id: string): void {
    const existing = ProductRepository.findById(id);
    if (!existing) throw new Error('Produit introuvable.');

    const movementCount = (db.prepare(
      'SELECT COUNT(*) AS count FROM stock_movements WHERE product_id = ?'
    ).get(id) as { count: number }).count;
    if (movementCount > 0) {
      throw new Error(
        'Suppression refusée : ce produit possède un historique de stock. ' +
        'Utilisez "Archiver" pour le masquer tout en conservant son historique.'
      );
    }

    const docCount = (db.prepare(
      'SELECT COUNT(*) AS count FROM document_items WHERE product_id = ?'
    ).get(id) as { count: number }).count;
    if (docCount > 0) {
      throw new Error(
        'Suppression refusée : ce produit figure sur des documents (factures, devis, BL…). ' +
        'Utilisez "Archiver" pour le masquer tout en conservant son historique.'
      );
    }

    ProductRepository.remove(id);
  }

  /**
   * Recherche instantanée de produits
   */
  static searchProducts(query: string, limit: number = 50): Product[] {
    if (!query || query.trim().length === 0) {
      return ProductRepository.search('', limit);
    }
    return ProductRepository.search(query, limit);
  }
}
