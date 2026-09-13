import fs from 'fs';
import path from 'path';
import { DataStorageService } from './DataStorageService';

/**
 * Primitives d'écriture CSV partagées par les exports.
 *
 * Extraites de `ExportService` pour être réutilisées par l'export comptable
 * (`AccountingExportService`) sans dupliquer la logique de sécurité
 * (anti-injection de formule, BOM UTF-8, séparateur `;`).
 */

/**
 * Échappe une valeur pour un CSV destiné à Excel/LibreOffice.
 *
 * Anti-injection de formule (§1.4) : une valeur (nom client, fournisseur,
 * produit…) commençant par =, +, - ou @ est préfixée d'une apostrophe pour
 * empêcher le tableur de l'interpréter comme une formule.
 */
export function csvEscape(val: unknown): string {
  let s = String(val ?? '');
  if (/^[=+\-@]/.test(s)) {
    s = `'${s}`;
  }
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Assemble une ligne CSV à partir de ses colonnes. */
export function csvRow(cols: unknown[]): string {
  return cols.map(csvEscape).join(';');
}

/** Crée le fichier CSV (BOM UTF-8 + première ligne) et retourne son chemin. */
export function createCsvFile(filename: string, header: unknown[]): string {
  const exportsDir = DataStorageService.getExportsPath();
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
  const filePath = path.join(exportsDir, filename);
  fs.writeFileSync(filePath, '\uFEFF' + csvRow(header) + '\r\n', 'utf-8');
  return filePath;
}

/** Ajoute des lignes CSV à la fin du fichier (append). */
export function appendCsvLines(filePath: string, lines: string[]): void {
  if (lines.length === 0) return;
  fs.appendFileSync(filePath, lines.join('\r\n') + '\r\n', 'utf-8');
}

/**
 * Fragment SQL de filtre par période, appliqué sur une colonne de date.
 *
 * `date(col)` (et non `col`) est utilisé des DEUX côtés : un `datetime` stocké
 * « 2026-09-13 22:00:00 » doit être comparé à la date CALENDAIRE saisie par
 * l'utilisateur (safety date-only, cf. src/utils/date.ts), jamais à un instant
 * UTC. Les bornes sont inclusives.
 *
 * Retourne `{ clause, params }` : `clause` est vide quand aucune borne n'est
 * fournie (export sur tout l'historique).
 */
export function dateRangeClause(column: string, from?: string, to?: string): { clause: string; params: string[] } {
  const params: string[] = [];
  const parts: string[] = [];
  if (from) {
    parts.push(`date(${column}) >= date(?)`);
    params.push(from);
  }
  if (to) {
    parts.push(`date(${column}) <= date(?)`);
    params.push(to);
  }
  return { clause: parts.length > 0 ? ` AND ${parts.join(' AND ')}` : '', params };
}
