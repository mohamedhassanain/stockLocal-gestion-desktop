/**
 * Encodeur EAN-13 — PUR, sans dépendance externe.
 *
 * Un EAN-13 fait exactement 95 modules :
 *   garde 101 + 6 chiffres gauche (7 modules chacun) + garde 01010
 *   + 6 chiffres droite (7 modules chacun) + garde 101.
 *
 * Le PREMIER chiffre n'est pas dessiné : il est encodé par la PARITÉ
 * (L = impaire / G = paire) des six chiffres de gauche.
 */

/** Motifs gauches impairs (parité L), index = chiffre 0..9. */
const LEFT_ODD: readonly string[] = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];

/** Motifs gauches pairs (parité G), index = chiffre 0..9. */
const LEFT_EVEN: readonly string[] = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];

/** Motifs droits (parité R) = complément des motifs L. */
const RIGHT: readonly string[] = LEFT_ODD.map(bits =>
  [...bits].map(b => (b === '0' ? '1' : '0')).join(''),
);

/**
 * Parité des 6 chiffres de gauche selon le 1er chiffre (l'index du tableau est
 * le premier chiffre ; `true` = motif G, `false` = motif L).
 */
const PARITY: readonly boolean[][] = [
  [false, false, false, false, false, false], // 0 : LLLLLL
  [false, false, true, false, true, true],    // 1 : LLGLGG
  [false, false, true, true, false, true],    // 2 : LLGGLG
  [false, false, true, true, true, false],    // 3 : LLGGGL
  [false, true, false, false, true, true],    // 4 : LGLLGG
  [false, true, true, false, false, true],    // 5 : LGGLLG
  [false, true, true, true, false, false],    // 6 : LGGGLL
  [false, true, false, true, false, true],    // 7 : LGLGLG
  [false, true, false, true, true, false],    // 8 : LGLGGL
  [false, true, true, false, true, false],    // 9 : LGGLGL
];

/** Garde de début / fin (3 modules) et garde centrale (5 modules). */
const GUARD = '101';
const CENTER = '01010';

/**
 * Calcule la clé de contrôle EAN-13 à partir des 12 premiers chiffres.
 * Poids 1 et 3 alternés en partant de 1 sur le premier chiffre.
 */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let index = 0; index < 12; index++) {
    const digit = Number(first12[index]);
    sum += index % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** Vrai si la chaîne est un EAN-13 complet dont la clé de contrôle est valide. */
export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  return ean13CheckDigit(value.slice(0, 12)) === Number(value[12]);
}

/**
 * Encode un EAN-13 (13 chiffres, clé valide) en largeurs de modules.
 *
 * @throws si la valeur n'est pas un EAN-13 valide (jamais de code partiel).
 * @returns largeurs d'éléments (1 = barre ou espace d'un module), barre en tête.
 */
export function encodeEan13(value: string): number[] {
  if (!/^\d{13}$/.test(value)) {
    throw new Error('EAN-13 : la valeur doit contenir exactement 13 chiffres.');
  }
  const expected = ean13CheckDigit(value.slice(0, 12));
  if (Number(value[12]) !== expected) {
    throw new Error(
      `EAN-13 : clé de contrôle invalide (attendu ${expected}, reçu ${value[12]}).`,
    );
  }

  const first = Number(value[0]);
  const parity = PARITY[first];
  if (!parity) throw new Error('EAN-13 : premier chiffre invalide.');

  let bits = GUARD;
  for (let i = 0; i < 6; i++) {
    const digit = Number(value[i + 1]);
    const pattern = parity[i] ? LEFT_EVEN[digit] : LEFT_ODD[digit];
    if (!pattern) throw new Error('EAN-13 : chiffre invalide.');
    bits += pattern;
  }
  bits += CENTER;
  for (let i = 0; i < 6; i++) {
    const digit = Number(value[i + 7]);
    const pattern = RIGHT[digit];
    if (!pattern) throw new Error('EAN-13 : chiffre de droite invalide.');
    bits += pattern;
  }
  bits += GUARD;

  // Conversion bits → largeurs d'éléments (regroupe les bits identiques).
  const modules: number[] = [];
  let current = bits[0];
  let run = 0;
  for (const bit of bits) {
    if (bit === current) {
      run++;
    } else {
      modules.push(run);
      current = bit;
      run = 1;
    }
  }
  modules.push(run);
  return modules;
}
