import { Product, ProductRepository, ProductInput } from '../repositories/ProductRepository';
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

    // 4. Génération de l'ID et insertion
    const newProduct = {
      ...productData,
      id: randomUUID(),
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

    ProductRepository.update({ ...productData, id });
    const updated = ProductRepository.findById(id);
    if (!updated) throw new Error('Erreur lors de la mise à jour du produit.');
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
   * Recherche instantanée de produits
   */
  static searchProducts(query: string, limit: number = 50): Product[] {
    if (!query || query.trim().length === 0) {
      return ProductRepository.search('', limit);
    }
    return ProductRepository.search(query, limit);
  }
}
