import { describe, it, expect } from 'vitest';
import { formatAxisValue } from '../src/utils/chartFormat';

const ySteps = [0, 0.25, 0.5, 0.75, 1];

describe('Dashboard chart — formatAxisValue (libellés d\'axe Y distincts)', () => {
  it('produit 5 libellés DISTINCTS quand scaleMax = 1 (cas « toutes valeurs à 0 »)', () => {
    const labels = ySteps.map((f) => formatAxisValue(f * 1, 1));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('produit des libellés distincts pour de petites échelles réelles (quelques MAD)', () => {
    for (const sm of [0.5, 2, 3, 5, 10]) {
      const labels = ySteps.map((f) => formatAxisValue(f * sm, sm));
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('garde le format « k » et des libellés distincts pour les grandes échelles', () => {
    const labels = ySteps.map((f) => formatAxisValue(f * 5000, 5000));
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.some((l) => l.endsWith('k'))).toBe(true);
  });
});
