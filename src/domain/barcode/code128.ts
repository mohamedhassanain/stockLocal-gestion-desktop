/**
 * Encodeur CODE 128 (jeu B) — PUR, sans dépendance externe.
 *
 * Pourquoi pas de bibliothèque : l'application n'embarque aucune dépendance de
 * génération de codes-barres 1D (`qrcode-generator` ne produit que des QR).
 * Le CODE 128 est une spécification figée et courte ; l'implémenter ici évite
 * d'ajouter une dépendance (et son risque de rupture de build) pour une table
 * de 107 motifs. Le résultat est vérifié par tests (motifs + clé de contrôle).
 *
 * La table ci-dessous est la table officielle CODE 128 : chaque motif est la
 * suite des LARGEURS d'éléments alternés barre/espace (commence par une barre).
 */

/** Table officielle CODE 128 — valeurs 0..106, largeurs d'éléments. */
const PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213',
  '122312', '132212', '221213', '221312', '231212', '112232', '122132',
  '122231', '113222', '123122', '123221', '223211', '221132', '221231',
  '213212', '223112', '312131', '311222', '321122', '321221', '312212',
  '322112', '322211', '212123', '212321', '232121', '111323', '131123',
  '131321', '112313', '132113', '132311', '211313', '231113', '231311',
  '112133', '112331', '132131', '113123', '113321', '133121', '313121',
  '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111',
  '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114',
  '413111', '241112', '134111', '111242', '121142', '121241', '114212',
  '124112', '124211', '411212', '421112', '421211', '212141', '214121',
  '412121', '111143', '111341', '131141', '114113', '114311', '411113',
  '411311', '113141', '114131', '311141', '411131', '211412', '211214',
  '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

/** Un symbole CODE 128 : suite de largeurs d'éléments (barre en premier). */
function patternModules(value: number): number[] {
  const pattern = PATTERNS[value];
  if (!pattern) throw new Error(`CODE 128 : symbole invalide (${value}).`);
  return [...pattern].map(Number);
}

/**
 * Table de correspondance CODE 128 jeu B : caractères `code` 32..126 → 0..94.
 * En dehors de cette plage (accents, contrôle), le caractère n'est PAS
 * représentable en jeu B : on lève plutôt que de produire un code faux.
 */
function toCodeB(char: string): number {
  const code = char.charCodeAt(0);
  if (code < 32 || code > 126) {
    throw new Error(
      `CODE 128 (jeu B) : caractère non encodable « ${char} ». Utilisez des caractères ASCII imprimables (32-126).`,
    );
  }
  return code - 32;
}

/**
 * Encode une chaîne en CODE 128 jeu B.
 *
 * @returns la suite des largeurs de modules (1 = module étroit), barre en tête.
 *          La somme des largeurs est le nombre total de modules.
 */
export function encodeCode128B(value: string): number[] {
  if (value.length === 0) {
    throw new Error('CODE 128 : la valeur à encoder est vide.');
  }

  const dataValues = [...value].map(toCodeB);

  // Clé de contrôle : (start + Σ position × valeur) mod 103 (position 1-based).
  let checksum = START_B;
  dataValues.forEach((v, index) => {
    checksum += (index + 1) * v;
  });
  checksum %= 103;

  const modules: number[] = [];
  for (const symbol of [START_B, ...dataValues, checksum, STOP]) {
    modules.push(...patternModules(symbol));
  }
  return modules;
}
