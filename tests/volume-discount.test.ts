import { describe, it, expect } from 'vitest';
import { findApplicableDiscount, resolveDiscount, describeVolumeDiscount, type VolumeDiscountRule } from '../src/utils/volumeDiscount';

/**
 * Phase 4 — Remises par quantité (règles de palier).
 * Vérifie l'application correcte selon les paliers, l'absence de remise hors
 * palier, et la règle de NON-CUMUL avec une remise manuelle.
 */

const RULES: VolumeDiscountRule[] = [
  { name: '10-49', min_qty: 10, max_qty: 49, discount_pct: 5 },
  { name: '50+', min_qty: 50, max_qty: null, discount_pct: 10 },
];

describe('Phase 4 — Remises par quantité', () => {
  it('n\'applique aucune remise hors palier', () => {
    expect(findApplicableDiscount(RULES, 1)).toBeNull();
    expect(findApplicableDiscount(RULES, 9)).toBeNull();
    const resolved = resolveDiscount(RULES, 9);
    expect(resolved.source).toBe('none');
    expect(resolved.pct).toBe(0);
  });

  it('applique le bon palier selon la quantité', () => {
    expect(findApplicableDiscount(RULES, 10)?.discount_pct).toBe(5);
    expect(findApplicableDiscount(RULES, 30)?.discount_pct).toBe(5);
    expect(findApplicableDiscount(RULES, 49)?.discount_pct).toBe(5);
    expect(findApplicableDiscount(RULES, 50)?.discount_pct).toBe(10);
    expect(findApplicableDiscount(RULES, 500)?.discount_pct).toBe(10);
  });

  it('choisit le pourcentage le plus élevé si plusieurs paliers matchent', () => {
    const overlapping: VolumeDiscountRule[] = [
      { name: 'A', min_qty: 5, max_qty: null, discount_pct: 3 },
      { name: 'B', min_qty: 10, max_qty: null, discount_pct: 8 },
    ];
    expect(findApplicableDiscount(overlapping, 12)?.discount_pct).toBe(8);
  });

  it('NON-CUMUL : une remise manuelle est prioritaire sur la remise quantité', () => {
    const volume = resolveDiscount(RULES, 30);
    expect(volume.source).toBe('volume');
    expect(volume.pct).toBe(5);

    const manual = resolveDiscount(RULES, 30, 12);
    expect(manual.source).toBe('manual');
    expect(manual.pct).toBe(12); // 12%, et NON 5 + 12 = 17%.
  });

  it('décrit le palier appliqué pour l\'afficher à l\'utilisateur', () => {
    const rule = findApplicableDiscount(RULES, 20)!;
    expect(describeVolumeDiscount(rule)).toBe('Remise quantité : -5% dès 10 unité(s)');
  });
});
