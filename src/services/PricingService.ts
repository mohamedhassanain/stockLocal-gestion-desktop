import { PricingRepository, type ProductLevelPrice } from '../repositories/PricingRepository';
import { VolumeDiscountRepository } from '../repositories/VolumeDiscountRepository';
import {
  resolvePrice,
  normalizePriceLevel,
  describePriceLevel,
  PRICE_LEVELS,
  type PriceLevel,
  type PriceResolution,
} from '../domain/pricing/priceLevels';

/**
 * ─── §B3 — Service de tarification ──────────────────────────────────────────
 *
 *   PricingRepository (SQL) ──► PricingService (règles) ──► IPC ──► UI
 *
 * Il orchestre la RÉSOLUTION DE PRIX (règle pure dans
 * `domain/pricing/priceLevels.ts`) : il lit les prix possibles en base, puis
 * délègue la priorisation à `resolvePrice`. Aucune règle de priorité n'est
 * dupliquée ici — la source de vérité reste le module de domaine.
 */

export interface ResolvePriceArgs {
  productId: string;
  /** Client (vide → vente comptoir : ni prix client ni prix de niveau). */
  customerId?: string | null;
  /** Quantité de la ligne (pour l'éventuelle remise quantité). */
  quantity?: number;
}

export const PricingService = {
  /** Catalogue des niveaux de prix proposés (`RETAIL`, `WHOLESALE`, `VIP`). */
  listLevels(): PriceLevel[] {
    return [...PRICE_LEVELS];
  },

  /**
   * Résout le prix unitaire d'un produit pour un client et une quantité.
   *
   * Priorité : prix spécifique client > prix du niveau > remise quantité >
   * prix standard. Renvoie TOUJOURS le motif affichable de la décision.
   *
   * @throws Error si le produit n'existe pas (message humain).
   */
  resolveProductPrice(args: ResolvePriceArgs): PriceResolution {
    const standardPrice = PricingRepository.getStandardPrice(args.productId);
    if (standardPrice === null) {
      throw new Error('Produit introuvable.');
    }

    const customerId = typeof args.customerId === 'string' && args.customerId ? args.customerId : null;
    const quantity = Number.isFinite(args.quantity) ? Number(args.quantity) : 1;

    const customerPrice = customerId
      ? PricingRepository.getCustomerPrice(customerId, args.productId)
      : null;

    const level = customerId ? PricingRepository.getCustomerLevel(customerId) : null;

    // Le prix de niveau n'est lu que s'il peut réellement s'appliquer (aucun
    // prix spécifique client) : évite une lecture inutile et rend la priorité
    // explicite dans le code.
    let levelPrice: number | null = null;
    if (customerPrice === null && level) {
      levelPrice = PricingRepository.getLevelPrice(args.productId, normalizePriceLevel(level));
    }

    // La remise quantité ne s'applique QUE si aucun prix négocié (client ou
    // niveau) n'a été trouvé : elle porte sur le prix standard.
    let volumeDiscountPct = 0;
    if (customerPrice === null && levelPrice === null) {
      volumeDiscountPct = VolumeDiscountRepository.getDiscountForQuantity(quantity);
    }

    return resolvePrice({
      standardPrice,
      customerPrice,
      levelPrice,
      level,
      volumeDiscountPct,
    });
  },

  // ─── Gestion des prix par niveau (produit) ────────────────────────────────
  listProductLevels(productId: string): ProductLevelPrice[] {
    return PricingRepository.listProductLevels(productId);
  },

  setLevelPrice(productId: string, level: unknown, price: number): void {
    if (!Number.isFinite(price) || price < 0) {
      throw new Error('Le prix doit être un nombre positif.');
    }
    PricingRepository.setLevelPrice(productId, normalizePriceLevel(level), price);
  },

  deleteLevelPrice(productId: string, level: unknown): void {
    PricingRepository.deleteLevelPrice(productId, normalizePriceLevel(level));
  },

  // ─── Gestion du prix spécifique client ────────────────────────────────────
  setCustomerPrice(customerId: string, productId: string, price: number): void {
    if (!Number.isFinite(price) || price < 0) {
      throw new Error('Le prix doit être un nombre positif.');
    }
    PricingRepository.setCustomerPrice(customerId, productId, price);
  },

  deleteCustomerPrice(customerId: string, productId: string): void {
    PricingRepository.deleteCustomerPrice(customerId, productId);
  },

  // ─── Niveau de prix du client ─────────────────────────────────────────────
  getCustomerLevel(customerId: string): string {
    return normalizePriceLevel(PricingRepository.getCustomerLevel(customerId));
  },

  setCustomerLevel(customerId: string, level: unknown): string {
    const normalized = normalizePriceLevel(level);
    PricingRepository.setCustomerLevel(customerId, normalized);
    return normalized;
  },

  /** Libellé affichable d'un niveau (utilisé par l'UI / les exports). */
  describeLevel(level: unknown): string {
    return describePriceLevel(level);
  },
};
