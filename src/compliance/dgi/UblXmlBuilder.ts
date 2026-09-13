/**
 * ─── Sérialisation XML bas niveau (UBL) ──────────────────────────────────────
 *
 * Petits utilitaires d'ÉCRITURE XML (indentation, éléments, attributs). Ce n'est
 * PAS un parseur : il produit une chaîne XML bien formée par construction (tout
 * texte/attribut passe par escapeXmlText).
 *
 * Ce fichier est PUR (aucune dépendance `db`/`electron`).
 */

import { escapeXmlText } from './xmlEscape';

/** Unité d'indentation (2 espaces, lisibilité du XML produit). */
const INDENT_UNIT = '  ';

/** Valeur d'attribut acceptée. */
export type XmlAttributeValue = string | number | null | undefined;

/** Indentation pour un niveau donné. */
export function indentXml(level: number): string {
  return INDENT_UNIT.repeat(Math.max(0, level));
}

/**
 * Sérialise un ensemble d'attributs : ` clé="valeur"`.
 * Les valeurs `null`/`undefined` sont ignorées (attribut omis).
 */
export function xmlAttributes(attributes?: Record<string, XmlAttributeValue>): string {
  if (!attributes) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue;
    parts.push(`${key}="${escapeXmlText(String(value))}"`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/** Élément feuille avec texte : `<préfixe:nom attr="…">texte</préfixe:nom>`. */
export function xmlLeaf(
  name: string,
  text: string | number,
  level: number,
  attributes?: Record<string, XmlAttributeValue>,
): string {
  return `${indentXml(level)}<${name}${xmlAttributes(attributes)}>${escapeXmlText(String(text))}</${name}>`;
}

/**
 * Élément feuille OPTIONNEL : renvoie une chaîne vide si la valeur est
 * `null`, `undefined` ou vide (l'élément n'est alors pas émis).
 */
export function xmlOptionalLeaf(
  name: string,
  text: string | number | null | undefined,
  level: number,
  attributes?: Record<string, XmlAttributeValue>,
): string {
  if (text === null || text === undefined || text === '') return '';
  return xmlLeaf(name, text, level, attributes);
}

/**
 * Élément conteneur avec enfants, un enfant par ligne indentée.
 * Si aucun enfant n'est fourni, l'élément est auto-fermé (`<nom/>`).
 */
export function xmlContainer(
  name: string,
  level: number,
  children: string[],
  attributes?: Record<string, XmlAttributeValue>,
): string {
  const body = children.filter((child) => child.length > 0).join('\n');
  const head = `${indentXml(level)}<${name}${xmlAttributes(attributes)}`;
  if (body.length === 0) return `${head}/>`;
  return `${head}>\n${body}\n${indentXml(level)}</${name}>`;
}

/** Déclaration XML standard (toujours en tête de document). */
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
