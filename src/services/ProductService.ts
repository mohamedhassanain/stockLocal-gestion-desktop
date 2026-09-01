import { Product, ProductRepository, ProductInput } from '../repositories/ProductRepository';
import { PriceHistoryRepository } from '../repositories/PriceHistoryRepository';
import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';
import { EntityCannotBeDeletedError } from '../domain/errors/EntityCannotBeDeletedError';
import { StockLedgerService } from './StockLedgerService';
import { StockService } from './StockService';

/**
 * Bornes de sécurité pour le stock initial / ajustement lors de la création
 * ou modification d'un produit. Empêche un payload renderer de créer un
 * stock grotesque (anti-doS mémoire / cohérence de la balance).
 */
const MAX_INITIAL_STOCK = 1_000_000;

/**
 * Service métier Produits.
 *
 * Toutes les opérations multi-tables (produit + stock initial, produit +
 * historique de prix, produit + ajustement de stock) sont ATOMIQUES :
 *   BEGIN → écritures → COMMIT
 * Sur erreur → ROLLBACK complet (jamais d'état partiel).
 */
export class ProductService {
  /**
   * Crée un nouveau produit avec validation des règles métier.
   * L'entrée est validée AVANT toute écriture.
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
   * P0-2 — Crée un produit + son stock initial de façon ATOMIQUE.
   *
   * BEGIN
   *   createProduct
   *   recordMovement(OPENING_BALANCE)
   * COMMIT
   *
   * Si l'entrée de stock échoue (produit invalide, quantité non conformes,
   * erreur SQLite…), le produit n'est JAMAIS créé : tout est annulé.
   * Il est impossible d'obtenir un produit sans son stock initial, ou
   * l'inverse.
   */
  static createProductWithInitialStock(productData: ProductInput, initialStock: number): Product {
    const stock = Number(initialStock);
    if (!Number.isFinite(stock) || stock < 0 || stock > MAX_INITIAL_STOCK) {
      throw new Error(`Stock initial invalide (0 à ${MAX_INITIAL_STOCK}).`);
    }

    return db.transaction(() => {
      const product = ProductService.createProduct(productData);
      if (stock > 0) {
        StockLedgerService.recordMovement({
          product_id: product.id,
          movement_type: 'OPENING_BALANCE',
          quantity: stock,
          unit_price: productData.purchase_price || 0,
          notes: 'Stock initial à la création',
        });
      }
      return product;
    })();
  }

  /**
   * P0-3 — Met à jour un produit ET ajuste son stock de façon ATOMIQUE.
   *
   * BEGIN
   *   updateProduct (produit + historique de prix)
   *   recordMovement (entrée/sortie d'ajustement)
   * COMMIT
   *
   * Si l'ajustement échoue (stock insuffisant…), la mise à jour du produit
   * est annulée. Aucun état partiel (produit modifié mais stock incohérent).
   * Le produit + son historique de prix + son mouvement de stock sont
   * cohérents ou rien n'est écrit.
   */
  static updateProductWithStock(id: string, productData: ProductInput, stockAdjustment: number): Product {
    const adjustment = Number(stockAdjustment);
    if (!Number.isFinite(adjustment)) {
      throw new Error('Ajustement de stock invalide.');
    }
    if (Math.abs(adjustment) > MAX_INITIAL_STOCK) {
      throw new Error(`Ajustement de stock invalide (valeur absolue > ${MAX_INITIAL_STOCK}).`);
    }

    return db.transaction(() => {
      const product = ProductService.updateProduct(id, productData);

      if (adjustment !== 0) {
        const currentStock = StockLedgerService.getStockLevel(id);
        const newStock = currentStock + adjustment;
        if (newStock < 0) {
          throw new Error(
            `Stock insuffisant. Stock actuel : ${currentStock}, tentative de retirer ${Math.abs(adjustment)}.`
          );
        }
        if (adjustment > 0) {
          StockService.addStockEntry({
            product_id: id,
            quantity: adjustment,
            unit_price: productData.purchase_price ?? product.purchase_price,
            reference_doc: undefined,
            supplier_id: undefined,
            notes: `Ajustement stock: ${currentStock} → ${newStock}`,
          });
        } else {
          StockService.addStockExit({
            product_id: id,
            quantity: Math.abs(adjustment),
            unit_price: productData.purchase_price ?? product.purchase_price,
            exitType: 'CASSE',
            notes: `Ajustement stock: ${currentStock} → ${newStock}`,
          });
        }
      }

      return product;
    })();
  }

  /**
   * P0-3 — Met à jour un produit existant.
   *
   * La mise à jour du produit ET l'enregistrement de l'historique de prix
   * se font dans la MÊME transaction : si l'enregistrement échoue, le
   * produit n'est pas modifié (pas de dérive prix/historique).
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

    return db.transaction(() => {
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
    })();
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

    // Références « dures » (documents, inventaires, commandes, avoirs) :
    // on bloque la suppression — l'utilisateur doit utiliser « Archiver ».
    const hardRefs: { name: string; count: number }[] = [];

    const docCount = (db.prepare('SELECT COUNT(*) AS count FROM document_items WHERE product_id = ?').get(id) as { count: number }).count;
    if (docCount > 0) hardRefs.push({ name: 'lignes de factures/devis', count: docCount });

    const invCount = (db.prepare('SELECT COUNT(*) AS count FROM inventory_items WHERE product_id = ?').get(id) as { count: number }).count;
    if (invCount > 0) hardRefs.push({ name: "lignes d'inventaire", count: invCount });

    const poCount = (db.prepare('SELECT COUNT(*) AS count FROM purchase_order_items WHERE product_id = ?').get(id) as { count: number }).count;
    if (poCount > 0) hardRefs.push({ name: "lignes de commandes d'achat", count: poCount });

    const cnCount = (db.prepare('SELECT COUNT(*) AS count FROM credit_note_refs WHERE product_id = ?').get(id) as { count: number }).count;
    if (cnCount > 0) hardRefs.push({ name: 'retours / avoirs', count: cnCount });

    // P0 — Les mouvements de stock sont une référence HISTORIQUE : ils doivent
    // BLOQUER la suppression (jamais supprimés avec le produit).
    const moveCount = (db.prepare('SELECT COUNT(*) AS count FROM stock_movements WHERE product_id = ?').get(id) as { count: number }).count;
    if (moveCount > 0) hardRefs.push({ name: 'mouvement(s) de stock', count: moveCount });

    // Historique des prix : donnée historique, à protéger elle aussi.
    const priceHistoryCount = (db.prepare('SELECT COUNT(*) AS count FROM price_history WHERE product_id = ?').get(id) as { count: number }).count;
    if (priceHistoryCount > 0) hardRefs.push({ name: 'historique de prix', count: priceHistoryCount });

    if (hardRefs.length > 0) {
      throw new EntityCannotBeDeletedError('produit', hardRefs);
    }

    // Produit « propre » (aucune référence historique) : suppression directe.
    // La balance précalculée (inventory_balances) est une donnée DÉRIVÉE, pas de
    // l'historique — on la nettoie pour ne pas être bloqué par la FK RESTRICT.
    const deleteTx = db.transaction(() => {
      db.prepare('DELETE FROM inventory_balances WHERE product_id = ?').run(id);
      ProductRepository.remove(id);
    });
    deleteTx();
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
