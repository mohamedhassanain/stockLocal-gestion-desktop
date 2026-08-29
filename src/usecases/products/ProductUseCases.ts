/**
 * Use Cases — Produits
 *
 * Règle Clean Architecture : ces Use Cases encapsulent la logique applicative
 * liée aux produits (création, modification, archivage, suppression définitive).
 * Ils délèguent à ProductService et AuditService.
 *
 * Règle de suppression (§9 du prompt) :
 *   - Un produit avec historique (ventes, stock, inventaire) → ARCHIVE uniquement
 *   - Un produit sans aucune référence → suppression définitive autorisée
 *   - Toujours confirmer avec l'utilisateur avant DELETE permanent
 */

import { ProductService } from '../../services/ProductService';
import { AuditService } from '../../services/AuditService';
import { StockService } from '../../services/StockService';
import { EntityCannotBeDeletedError } from '../../domain/errors/EntityCannotBeDeletedError';
import type { Product, ProductInput } from '../../repositories/ProductRepository';

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface CreateProductInput extends ProductInput {
  initialStock?: number;
}

// ─── Use Cases ───────────────────────────────────────────────────────────────

/**
 * UC-P01 : Créer un produit (avec stock initial optionnel).
 * Si initialStock > 0, crée un mouvement OPENING_BALANCE dans le Stock Ledger.
 */
export function createProductUseCase(input: CreateProductInput): Product {
  const { initialStock, ...productData } = input;
  const product = ProductService.createProduct(productData);

  if (initialStock && initialStock > 0) {
    StockService.addStockEntry({
      product_id: product.id,
      quantity: initialStock,
      unit_price: product.purchase_price,
      movement_type: 'OPENING_BALANCE',
      notes: 'Stock initial',
      date: new Date().toISOString(),
    });
  }

  AuditService.log('PRODUCT_CREATE', 'product', product.id, `Produit créé : ${product.reference} — ${product.designation}`);
  return product;
}

/**
 * UC-P02 : Mettre à jour un produit.
 * Enregistre automatiquement l'historique des prix si les prix ont changé.
 */
export function updateProductUseCase(id: string, data: ProductInput): Product {
  const product = ProductService.updateProduct(id, data);
  AuditService.log('PRODUCT_UPDATE', 'product', id, `Produit modifié : ${product.reference}`);
  return product;
}

/**
 * UC-P03 : Archiver un produit.
 * Préféré à la suppression quand le produit a un historique.
 * Le produit reste consultable mais n'apparaît plus dans les listes actives.
 */
export function archiveProductUseCase(id: string): void {
  ProductService.archiveProduct(id);
  AuditService.log('PRODUCT_ARCHIVE', 'product', id, 'Produit archivé');
}

/**
 * UC-P04 : Réactiver un produit archivé.
 */
export function activateProductUseCase(id: string): void {
  ProductService.activateProduct(id);
  AuditService.log('PRODUCT_ACTIVATE', 'product', id, 'Produit réactivé');
}

/**
 * UC-P05 : Supprimer définitivement un produit.
 *
 * ⚠️ Lève EntityCannotBeDeletedError si le produit possède un historique.
 * Dans ce cas, utiliser archiveProductUseCase à la place.
 *
 * Cette fonction ne supprime jamais silencieusement — le caller doit
 * gérer l'erreur et proposer l'archivage à l'utilisateur.
 */
export function deleteProductUseCase(id: string): void {
  try {
    ProductService.deleteProduct(id);
    AuditService.log('PRODUCT_DELETE', 'product', id, 'Produit supprimé définitivement');
  } catch (err) {
    if (err instanceof EntityCannotBeDeletedError) {
      // Relancer proprement — le handler IPC / UI doit proposer l'archivage
      throw err;
    }
    throw err;
  }
}

/**
 * UC-P06 : Rechercher des produits.
 */
export function searchProductsUseCase(query: string, limit = 50): Product[] {
  return ProductService.searchProducts(query, limit);
}
