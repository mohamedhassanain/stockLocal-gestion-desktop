import { describe, it, expect } from 'vitest';
import { encodeCode128B } from '../src/domain/barcode/code128';
import {
  ean13CheckDigit,
  isValidEan13,
  encodeEan13,
} from '../src/domain/barcode/ean13';
import {
  encodeBarcode,
  canEncodeBarcode,
  barsFromModules,
  moduleCount,
} from '../src/domain/barcode/labelBarcode';

/**
 * §Étiquettes — encodeurs de codes-barres (purs, sans dépendance).
 *
 * Ces tests verrouillent les TABLES officielles : une erreur de transcription
 * dans un motif produirait des codes-barres illisibles par un scanneur, ce qui
 * ne se voit PAS à l'œil nu. On vérifie donc les valeurs de référence exactes.
 */

describe('EAN-13', () => {
  it('calcule la clé de contrôle (poids 1/3 alternés)', () => {
    // 5901234123457 est un EAN-13 de référence valide.
    expect(ean13CheckDigit('590123412345')).toBe(7);
  });

  it('valide un EAN-13 correct et rejette une clé fausse', () => {
    expect(isValidEan13('5901234123457')).toBe(true);
    expect(isValidEan13('5901234123458')).toBe(false);
    expect(isValidEan13('590123412345')).toBe(false); // 12 chiffres
    expect(isValidEan13('59012341234578')).toBe(false); // 14 chiffres
    expect(isValidEan13('59012341234A7')).toBe(false); // non numérique
  });

  it('encode 95 modules exactement, en commençant par une barre', () => {
    const modules = encodeEan13('5901234123457');
    expect(moduleCount(modules)).toBe(95);
    // Un symbole commence ET finit par une barre → nombre d'éléments IMPAIR.
    expect(modules.length % 2).toBe(1);
  });

  it('refuse une longueur ou une clé invalide', () => {
    expect(() => encodeEan13('12345')).toThrow(/13 chiffres/);
    expect(() => encodeEan13('5901234123458')).toThrow(/clé de contrôle/);
  });
});

describe('CODE 128 (jeu B)', () => {
  it('encode « A » avec la clé de contrôle attendue', () => {
    // start=104, 'A'=33, checksum=(104+1*33) mod 103=34, stop=106
    const modules = encodeCode128B('A');
    expect(modules).toEqual([
      2, 1, 1, 2, 1, 4, // start B (104)
      1, 1, 1, 3, 2, 3, // 'A' (33)
      1, 3, 1, 1, 2, 3, // checksum (34)
      2, 3, 3, 1, 1, 1, 2, // stop (106)
    ]);
    // start(11) + donnée(11) + clé(11) + stop(13) = 46 modules.
    expect(moduleCount(modules)).toBe(46);
  });

  it('calcule la clé de contrôle pondérée par la position', () => {
    // start=104, 'A'=33, 'B'=34 → checksum=(104 + 1*33 + 2*34) mod 103 = 102
    const modules = encodeCode128B('AB');
    // Les 6 modules du symbole 102 (« 411131 ») suivent le start + 2 données.
    expect(modules.slice(18, 24)).toEqual([4, 1, 1, 1, 3, 1]);
  });

  it('refuse une valeur vide ou non encodable en jeu B', () => {
    expect(() => encodeCode128B('')).toThrow(/vide/);
    expect(() => encodeCode128B('café')).toThrow(/non encodable/);
  });
});

describe('Sélection d\'encodage (encodeBarcode)', () => {
  it('choisit EAN-13 pour un code à clé valide', () => {
    const result = encodeBarcode('5901234123457');
    expect(result.type).toBe('EAN13');
    expect(result.text).toBe('5901234123457');
    expect(moduleCount(result.modules)).toBe(95);
  });

  it('retombe sur CODE 128 pour un code non-EAN-13', () => {
    expect(encodeBarcode('ABC-123').type).toBe('CODE128');
    // 13 chiffres mais clé fausse → CODE 128 (lisible plutôt que bloquant).
    expect(encodeBarcode('5901234123458').type).toBe('CODE128');
  });

  it('lève un message clair quand aucun code-barres n\'est renseigné', () => {
    expect(() => encodeBarcode('')).toThrow(/n'a pas de code-barres/);
    expect(() => encodeBarcode('   ')).toThrow(/n'a pas de code-barres/);
    expect(() => encodeBarcode(null)).toThrow(/n'a pas de code-barres/);
    expect(() => encodeBarcode(undefined)).toThrow(/n'a pas de code-barres/);
  });

  it('canEncodeBarcode ne lève jamais et renvoie un booléen', () => {
    expect(canEncodeBarcode('5901234123457')).toBe(true);
    expect(canEncodeBarcode('ABC-123')).toBe(true);
    expect(canEncodeBarcode('')).toBe(false);
    expect(canEncodeBarcode(null)).toBe(false);
    expect(canEncodeBarcode('café')).toBe(false);
  });
});

describe('Géométrie des barres', () => {
  it('ne retient que les éléments de largeur de BARRE (indices pairs)', () => {
    // [barre2, espace1, barre1, espace2] → 2 barres
    const bars = barsFromModules([2, 1, 1, 2]);
    expect(bars).toEqual([
      { x: 0, width: 2 },
      { x: 3, width: 1 },
    ]);
    expect(moduleCount([2, 1, 1, 2])).toBe(6);
  });

  it('un symbole complet alterne barre/espace et finit par une barre', () => {
    const { modules } = encodeBarcode('5901234123457');
    // Impair : le dernier élément est une barre (fin de garde EAN-13 « 101 »).
    expect(modules.length % 2).toBe(1);
    // La dernière barre est bien le dernier élément, pas un espace.
    const bars = barsFromModules(modules);
    const last = bars[bars.length - 1];
    expect(last.x + last.width).toBe(moduleCount(modules));
  });
});
