import { describe, it, expect } from 'vitest';
import {
  roundMoney,
  addMoney,
  sumMoney,
  subtractMoney,
  multiplyMoney,
  calculateDiscount,
  calculateTax,
  calculateTotal,
  calculateRemaining,
  calculateMargin,
  calculateMarginRate,
  calculateLineAmounts,
  moneyEquals,
  isZeroMoney,
  formatMoney,
  clampMoney,
} from '../src/utils/money';

/**
 * PHASE 1 — Moteur monétaire.
 * Vérifie l'absence de dérive flottante, les arrondis, remises, TVA, totaux,
 * restes dus et marges. Aucune base de données requise : arithmétique pure.
 */
describe('Moteur monétaire — money.ts', () => {
  describe('roundMoney / arithmétique flottante', () => {
    it('élimine la dérive 0.1 + 0.2', () => {
      expect(roundMoney(0.1 + 0.2)).toBe(0.3);
      expect(roundMoney(0.1 + 0.2)).not.toBe(0.30000000000000004);
    });

    it('arrondit au centime le plus proche', () => {
      expect(roundMoney(1.005)).toBe(1.01);
      expect(roundMoney(2.675)).toBe(2.68);
      expect(roundMoney(1.004)).toBe(1.0);
      expect(roundMoney(1.999)).toBe(2.0);
    });

    it('renvoie 0 pour NaN / Infinity / null / undefined', () => {
      expect(roundMoney(NaN)).toBe(0);
      expect(roundMoney(Infinity)).toBe(0);
      expect(roundMoney(null)).toBe(0);
      expect(roundMoney(undefined)).toBe(0);
    });
  });

  describe('addMoney / sumMoney / subtractMoney / multiplyMoney', () => {
    it('additionne sans dérive flottante', () => {
      expect(addMoney(0.1, 0.2)).toBe(0.3);
      expect(addMoney(10.1, 20.2, 30.3)).toBe(60.6);
      expect(addMoney(1.11, 2.22, 3.33)).toBe(6.66);
    });

    it('sumMoney agrège un tableau', () => {
      expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
      expect(sumMoney([])).toBe(0);
      expect(sumMoney([100, 200.555])).toBe(300.56);
    });

    it('subtractMoney / multiplyMoney arrondissent', () => {
      expect(subtractMoney(0.3, 0.1)).toBe(0.2);
      expect(multiplyMoney(19.99, 3)).toBe(59.97);
      expect(multiplyMoney(0.1, 3)).toBe(0.3);
    });
  });

  describe('remises et TVA', () => {
    it('calculateDiscount applique un pourcentage borné 0–100', () => {
      expect(calculateDiscount(100, 15)).toBe(15);
      expect(calculateDiscount(200, 12.5)).toBe(25);
      expect(calculateDiscount(100, 150)).toBe(100); // borné à 100 %
      expect(calculateDiscount(100, -5)).toBe(0);    // borné à 0 %
    });

    it('calculateTax calcule la TVA sur une base HT', () => {
      expect(calculateTax(100, 20)).toBe(20);
      expect(calculateTax(240, 20)).toBe(48);
      expect(calculateTax(99.99, 20)).toBe(20);
    });

    it('calculateTotal ajoute la TVA (montant ou taux)', () => {
      expect(calculateTotal(100, 20)).toBe(120);          // 20 = taux
      expect(calculateTotal(100, 20, true)).toBe(120);    // 20 = taux explicite
      expect(calculateTotal(100, 20, false)).toBe(120);   // 20 = montant → 120
      expect(calculateTotal(100, 15, false)).toBe(115);
    });

    it('calculateLineAmounts reproduit la facturation (HT, TVA, TTC, remise)', () => {
      const line = calculateLineAmounts({ quantity: 2, unitPrice: 100, discountPct: 0, vatRate: 20 });
      expect(line.exclTax).toBe(200);
      expect(line.tax).toBe(40);
      expect(line.inclTax).toBe(240);
      expect(line.discount).toBe(0);

      const discounted = calculateLineAmounts({ quantity: 10, unitPrice: 50, discountPct: 10, vatRate: 20 });
      // 10 × 50 = 500, remise 10 % → 450 HT, TVA 20 % → 90, TTC 540
      expect(discounted.exclTax).toBe(450);
      expect(discounted.tax).toBe(90);
      expect(discounted.inclTax).toBe(540);
      expect(discounted.discount).toBe(50);
    });
  });

  describe('reste dû', () => {
    it('ne produit JAMAIS de reste négatif', () => {
      expect(calculateRemaining(1200, 300)).toBe(900);
      expect(calculateRemaining(1200, 1200)).toBe(0);
      expect(calculateRemaining(1200, 1400)).toBe(0); // trop-perçu → pas de -200
    });
  });

  describe('marges', () => {
    it('calculateMargin (vente − achat) × quantité', () => {
      expect(calculateMargin(100, 60, 5)).toBe(200);
      expect(calculateMargin(50, 60, 2)).toBe(-20); // vente à perte conservée
    });

    it('calculateMarginRate en %', () => {
      expect(calculateMarginRate(100, 60)).toBe(40);
      expect(calculateMarginRate(0, 10)).toBe(0);
    });
  });

  describe('comparaisons et formatage', () => {
    it('moneyEquals / isZeroMoney tolèrent 1 centime', () => {
      expect(moneyEquals(10, 10.005)).toBe(true);
      expect(moneyEquals(10, 10.02)).toBe(false);
      expect(isZeroMoney(0.004)).toBe(true);
      expect(isZeroMoney(0.02)).toBe(false);
    });

    it('clampMoney borne une valeur', () => {
      expect(clampMoney(150, 0, 100)).toBe(100);
      expect(clampMoney(-5, 0, 100)).toBe(0);
      expect(clampMoney(42, 0, 100)).toBe(42);
    });

    it('formatMoney affiche 2 décimales', () => {
      expect(formatMoney(1234.5)).toBe('1234.50');
      expect(formatMoney(0)).toBe('0.00');
      expect(formatMoney(NaN)).toBe('0.00');
    });
  });
});
