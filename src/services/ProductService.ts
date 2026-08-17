import { Product, ProductRepository } from '../repositories/ProductRepository';
import { randomUUID } from 'crypto';

export class ProductService {
  /**
   * Crée un nouveau produit avec validation des règles métier.
   */
  static createProduct(productData: Omit<Product, 'id'>): Product {
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

    // 3. Génération de l'ID et insertion
    const newProduct: Product = {
      ...productData,
      id: randomUUID(),
      status: productData.status || 'ACTIVE'
    };

    ProductRepository.create(newProduct);
    return newProduct;
  }

  /**
   * Recherche instantanée de produits
   */
  static searchProducts(query: string, limit: number = 50): Product[] {
    // La validation de la requête pourrait être faite ici avec Zod
    if (!query || query.trim().length === 0) {
      return []; // Retourner vide ou les 50 premiers produits par défaut
    }
    return ProductRepository.search(query, limit);
  }
}
