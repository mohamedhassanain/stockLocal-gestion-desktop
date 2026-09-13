/**
 * Choix de l'encodage et géométrie des barres pour une étiquette produit.
 *
 * Règle de sélection (déterministe, testée) :
 *   1. Un code-barres de 13 chiffres **dont la clé EAN-13 est valide** → EAN-13
 *      (c'est ce que lisent les scanneurs de commerce de détail).
 *   2. Sinon → CODE 128 jeu B (accepte tout l'ASCII imprimable).
 *
 * Aucun code partiel n'est jamais produit : si l'encodage est impossible, une
 * erreur explicite en français est levée (l'appelant affiche le message).
 */

import { encodeCode128B } from './code128';
import { encodeEan13, isValidEan13 } from './ean13';

/** Types d'encodage supportés pour les étiquettes. */
export type BarcodeType = 'EAN13' | 'CODE128';

/** Un code-barres encodé prêt à être dessiné. */
export interface EncodedBarcode {
  type: BarcodeType;
  /** Valeur lisible imprimée sous les barres. */
  text: string;
  /** Largeurs d'éléments (1 = un module), barre en premier. */
  modules: number[];
}

/** Une barre à dessiner : abscisse (modules) et largeur (modules). */
export interface BarcodeBar {
  x: number;
  width: number;
}

/** Nombre total de modules occupés par le symbole (sans zones de silence). */
export function moduleCount(modules: readonly number[]): number {
  return modules.reduce((sum, width) => sum + width, 0);
}

/**
 * Vrai si la valeur peut être encodée (utilisé par l'UI pour prévenir AVANT
 * l'impression, sans lever d'exception).
 */
export function canEncodeBarcode(value: string | null | undefined): boolean {
  if (!value || value.trim() === '') return false;
  const text = value.trim();
  try {
    if (isValidEan13(text)) return true;
    encodeCode128B(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Encode une valeur de code-barres.
 *
 * @throws Error (message français explicite) si la valeur est vide ou encodable
 *         par aucun des deux jeux.
 */
export function encodeBarcode(value: string | null | undefined): EncodedBarcode {
  if (!value || value.trim() === '') {
    throw new Error('Ce produit n\'a pas de code-barres. Renseignez-en un avant d\'imprimer son étiquette.');
  }
  const text = value.trim();

  if (isValidEan13(text)) {
    return { type: 'EAN13', text, modules: encodeEan13(text) };
  }
  // CODE 128 : lève un message clair si un caractère n'est pas encodable.
  return { type: 'CODE128', text, modules: encodeCode128B(text) };
}

/**
 * Convertit les largeurs d'éléments en barres dessinables (positions/tailles en
 * modules, sans zones de silence). Les éléments d'indice PAIR sont des barres
 * (l'encodage commence toujours par une barre).
 */
export function barsFromModules(modules: readonly number[]): BarcodeBar[] {
  const bars: BarcodeBar[] = [];
  let x = 0;
  modules.forEach((width, index) => {
    if (index % 2 === 0) bars.push({ x, width });
    x += width;
  });
  return bars;
}
