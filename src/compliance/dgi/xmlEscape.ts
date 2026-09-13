/**
 * ─── Échappement XML 1.0 ─────────────────────────────────────────────────────
 *
 * ⚠️  Ce n'est PAS un utilitaire d'échappement HTML. Il échappe EXACTEMENT les
 * cinq entités prédéfinies par la spécification XML 1.0, à savoir les caractères
 * esperluette, chevron ouvrant, chevron fermant, guillemet double et apostrophe.
 *
 * Pourquoi c'est nécessaire et pourquoi ce n'est pas la même chose qu'un
 * échappeur HTML :
 *   - Le générateur UBL produit une CHAÎNE XML transmise à la DGI (ou écrite
 *     dans un fichier). Aucun moteur HTML ne la « re-décode » : sans
 *     échappement, une raison sociale contenant une esperluette (ex.
 *     « Dupont & Fils ») produirait un XML NON bien formé, rejeté par tout
 *     parseur.
 *   - Un échappeur HTML produit des entités différentes et bien plus
 *     nombreuses (entités numériques pour les accents, espaces insécables…)
 *     qui rendraient le XML INVALIDE en XML 1.0. On n'en utilise donc aucun.
 *
 * NOTE D'IMPLÉMENTATION : les chaînes d'entité sont construites par
 * CONCATÉNATION volontaire. Le sérialiseur qui écrit ce fichier traite les
 * séquences d'entités littérales : écrire directement la séquence complète
 * corromprait le code source. On assemble donc l'esperluette seule (qui n'est
 * PAS une entité, car non suivie d'un nom et d'un point-virgule valides) avec
 * le nom de l'entité.
 *
 * L'ordre des remplacements est important : on échappe l'esperluette EN
 * PREMIER, sinon on ré-échapperait l'esperluette des entités déjà produites.
 */

/** Caractère esperluette (écrit seul : non décodé par le sérialiseur). */
const AMPERSAND = '&';

/** Entité nommée `amp` (esperluette) → `&` + `amp;`. */
const ENTITY_AMP = `${AMPERSAND}amp;`;
/** Entité nommée `lt` (chevron ouvrant). */
const ENTITY_LT = `${AMPERSAND}lt;`;
/** Entité nommée `gt` (chevron fermant). */
const ENTITY_GT = `${AMPERSAND}gt;`;
/** Entité nommée `quot` (guillemet double). */
const ENTITY_QUOT = `${AMPERSAND}quot;`;
/** Entité nommée `apos` (apostrophe). */
const ENTITY_APOS = `${AMPERSAND}apos;`;

/** Table des remplacements XML 1.0 (esperluette d'abord). */
const XML_ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&/g, ENTITY_AMP],
  [/</g, ENTITY_LT],
  [/>/g, ENTITY_GT],
  [/"/g, ENTITY_QUOT],
  [/'/g, ENTITY_APOS],
];

/** Échappe le texte destiné à un contenu ou un attribut XML. */
export function escapeXmlText(value: string): string {
  let result = value;
  for (const [pattern, replacement] of XML_ENTITIES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Échappe une valeur optionnelle : `null`/`undefined` → chaîne vide. */
export function escapeXmlTextOrEmpty(value: string | null | undefined): string {
  return escapeXmlText(value ?? '');
}
