import fs from 'fs';
import { ProductService } from './ProductService';
import { ProductRepository } from '../repositories/ProductRepository';
import type { ProductInput } from '../repositories/ProductRepository';

/**
 * Parse une ligne CSV en tenant compte des champs entre guillemets,
 * du séparateur détecté, et des guillemets échappés (doublés).
 * Gère aussi le BOM UTF-8 (\\uFEFF).
 */
function parseCsvLine(line: string, separator: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Guillemet doublé = guillemet échappé
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          // Fin du champ quoted
          inQuotes = false;
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === separator) {
        fields.push(current.trim());
        current = '';
        i++;
      } else {
        current += ch;
        i++;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse tout le fichier CSV avec détection automatique du séparateur,
 * gestion du BOM UTF-8, et champs quoted.
 */
function parseCsvContent(raw: string): { headers: string[]; rows: string[][]; separator: string } {
  // Supprimer le BOM UTF-8 si présent
  let content = raw;
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.substring(1);
  }

  const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) {
    throw new Error('Le fichier CSV doit contenir un en-tête et au moins une ligne de données.');
  }

  // Détection du séparateur : compter les occurrences dans la 1re ligne
  const candidates = [';', ',', '\t'];
  let bestSep = ',';
  let bestCount = 0;
  for (const sep of candidates) {
    const count = (lines[0].match(new RegExp(sep === '\t' ? '\t' : `[${sep}]`, 'g')) || []).length;
    if (count > bestCount) {
      bestCount = count;
      bestSep = sep;
    }
  }

  const headers = parseCsvLine(lines[0], bestSep)
    .map(h => h.replace(/[\uFEFF"]/g, '').trim().toLowerCase());

  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i], bestSep);
    if (fields.every(f => f === '')) continue;
    rows.push(fields);
  }

  return { headers, rows, separator: bestSep };
}

/**
 * Utilitaire interne : construit un ProductInput à partir d'une ligne CSV.
 */
function buildProductFromRow(
  cols: string[],
  idx: (name: string) => number,
  num: (v: string | undefined) => number,
): ProductInput {
  return {
    reference: cols[idx('reference')] ?? '',
    designation: cols[idx('designation')] ?? '',
    description: cols[idx('description')] || undefined,
    barcode: cols[idx('barcode')] || undefined,
    unit: (cols[idx('unit')] || 'PIÈCE').toUpperCase(),
    purchase_price: num(cols[idx('purchase_price')]),
    selling_price: num(cols[idx('selling_price')]),
    wholesale_price: num(cols[idx('wholesale_price')]),
    min_stock: Math.round(num(cols[idx('min_stock')])),
    status: 'ACTIVE',
  };
}

/**
 * §Phase 17 — Stratégie explicite face aux références déjà présentes en base.
 * Aucun produit n'est JAMAIS écrasé sans que l'utilisateur l'ait choisi.
 */
export type ImportDuplicateStrategy = 'CREATE' | 'UPDATE' | 'SKIP';

/** Une ligne CSV validée, accompagnée de son statut face à la base. */
export interface ImportPreviewRow {
  product: ProductInput;
  /** true si la référence existe déjà en base (doublon). */
  isDuplicate: boolean;
}

/** Compteurs affichés dans l'aperçu d'import. */
export interface ImportPreviewSummary {
  total: number;
  valid: number;
  duplicates: number;
  invalid: number;
}

/** Résultat de l'aperçu d'import CSV (validation SANS insertion). */
export interface PreviewResult {
  /** Lignes valides (nouvelles + doublons), prêtes à être confirmées. */
  rows: ImportPreviewRow[];
  /** Erreurs de validation par ligne */
  errors: { row: number; message: string }[];
  /** Noms des colonnes détectées dans le CSV */
  headers: string[];
  /** Synthèse chiffrée pour l'écran d'aperçu. */
  summary: ImportPreviewSummary;
}

/** Résultat d'un import confirmé. */
export interface ImportOutcome {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  messages: string[];
}

/**
 * Import de produits depuis un fichier CSV (cahier des charges §3).
 * Format attendu : reference;designation;purchase_price;selling_price;wholesale_price;min_stock;barcode;unit
 * Séparateur supporté : ; ou , ou tab — 1re ligne = en-tête.
 * Gère les champs entre guillemets, le BOM UTF-8, et les espaces parasites.
 *
 * API :
 *   - previewProductsFromCsv(filePath) → aperçu sans insertion
 *   - confirmImport(products)           → import d'un tableau validé
 *   - importProductsFromCsv(filePath)   → import direct (rétrocompatibilité)
 */
export const ImportService = {
  /**
   * Parse un fichier CSV et valide chaque ligne sans insérer en base.
   * Utile pour afficher un aperçu avant confirmation de l'import.
   */
  previewProductsFromCsv(filePath: string): PreviewResult {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Fichier introuvable : ${filePath}`);
    }

    const buffer = fs.readFileSync(filePath);
    let raw = buffer.toString('utf-8');

    if (raw.charCodeAt(0) === 0xFEFF) {
      raw = raw.substring(1);
    }

    const { headers, rows } = parseCsvContent(raw);

    // Vérifier les colonnes requises
    const required = ['reference', 'designation'];
    for (const r of required) {
      if (!headers.includes(r)) {
        throw new Error(`Colonne requise absente : "${r}". Colonnes trouvées : ${headers.join(', ')}`);
      }
    }

    const idx = (name: string): number => headers.indexOf(name);
    const num = (v: string | undefined): number => {
      const n = parseFloat((v ?? '').replace(/["\s]/g, ''));
      return isNaN(n) ? 0 : n;
    };

    const previewRows: ImportPreviewRow[] = [];
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const cols = rows[i];
      const reference = cols[idx('reference')] ?? '';
      const designation = cols[idx('designation')] ?? '';

      if (!reference || !designation) {
        errors.push({
          row: i + 2,
          message: 'Référence ou désignation manquante.',
        });
        continue;
      }

      const product = buildProductFromRow(cols, idx, num);

      // Validation des règles métier (hors insertion)
      if (product.selling_price < product.purchase_price) {
        errors.push({
          row: i + 2,
          message: `(${reference}) Le prix de vente ne peut pas être inférieur au prix d'achat.`,
        });
        continue;
      }

      // §Phase 17 — détection des doublons : la référence existe-t-elle déjà ?
      // LECTURE SEULE : l'aperçu n'écrit ni ne modifie jamais la base.
      const isDuplicate = ProductRepository.findByReference(product.reference) !== undefined;
      previewRows.push({ product, isDuplicate });
    }

    const duplicates = previewRows.filter(r => r.isDuplicate).length;
    const summary: ImportPreviewSummary = {
      total: rows.length,
      valid: previewRows.length - duplicates,
      duplicates,
      invalid: errors.length,
    };

    return { rows: previewRows, errors, headers, summary };
  },

  /**
   * §Phase 17 — Importe les lignes de l'aperçu en appliquant une stratégie
   * EXPLICITE pour les doublons. Rien n'est jamais écrasé sans choix explicite.
   *
   *   CREATE → les doublons sont signalés en erreur (jamais écrasés)
   *   UPDATE → le produit existant (même référence) est mis à jour
   *   SKIP   → les doublons sont ignorés
   */
  confirmImport(rows: ImportPreviewRow[], strategy: ImportDuplicateStrategy): ImportOutcome {
    const messages: string[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of rows) {
      const { product, isDuplicate } = row;
      try {
        if (isDuplicate) {
          if (strategy === 'SKIP') {
            skipped++;
            continue;
          }
          if (strategy === 'UPDATE') {
            const existing = ProductRepository.findByReference(product.reference);
            if (!existing) {
              // La référence a disparu entre l'aperçu et la confirmation : on crée.
              ProductService.createProduct(product);
              created++;
              continue;
            }
            ProductService.updateProduct(existing.id, product);
            updated++;
            continue;
          }
          // CREATE : une référence existante ne peut pas être créée en double.
          errors++;
          messages.push(`« ${product.reference} » existe déjà — choisissez « Mettre à jour » ou « Ignorer ».`);
          continue;
        }
        ProductService.createProduct(product);
        created++;
      } catch (e: unknown) {
        errors++;
        messages.push(`Produit ${product.reference} : ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { created, updated, skipped, errors, messages };
  },

  /**
   * Import direct depuis un fichier CSV (ancienne API, conservée pour rétrocompatibilité).
   * Les doublons ne sont JAMAIS écrasés : la stratégie CREATE les signale en erreur.
   */
  importProductsFromCsv(filePath: string): { imported: number; errors: number; messages: string[] } {
    const preview = this.previewProductsFromCsv(filePath);
    const messages: string[] = preview.errors.map(e => `Ligne ${e.row} : ${e.message}`);
    const outcome = this.confirmImport(preview.rows, 'CREATE');

    return {
      imported: outcome.created,
      errors: outcome.errors + preview.errors.length,
      messages: [...messages, ...outcome.messages],
    };
  },
};
