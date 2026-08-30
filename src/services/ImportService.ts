import fs from 'fs';
import { ProductService } from './ProductService';
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
 * Résultat de l'aperçu d'import CSV (validation sans insertion).
 */
export interface PreviewResult {
  /** Produits validés prêts à être importés */
  products: ProductInput[];
  /** Erreurs de validation par ligne */
  errors: { row: number; message: string }[];
  /** Noms des colonnes détectées dans le CSV */
  headers: string[];
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

    const products: ProductInput[] = [];
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

      products.push(product);
    }

    return { products, errors, headers };
  },

  /**
   * Importe un tableau de produits validés en base via ProductService.createProduct.
   * Destiné à être appelé après previewProductsFromCsv pour confirmer l'import.
   */
  confirmImport(products: ProductInput[]): { imported: number; errors: number; messages: string[] } {
    const messages: string[] = [];
    let imported = 0;
    let errors = 0;

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      try {
        ProductService.createProduct(product);
        imported++;
      } catch (e: unknown) {
        errors++;
        messages.push(`Produit ${product.reference} (ligne ${i + 1}) : ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { imported, errors, messages };
  },

  /**
   * Import direct depuis un fichier CSV (ancienne API, conservée pour rétrocompatibilité).
   * Parse + valide + importe en une seule opération.
   */
  importProductsFromCsv(filePath: string): { imported: number; errors: number; messages: string[] } {
    const { products, errors: previewErrors } = this.previewProductsFromCsv(filePath);

    // Ajouter les erreurs de parsing/validateur au résultat
    const messages: string[] = previewErrors.map(e => `Ligne ${e.row} : ${e.message}`);

    // Importer les produits validés
    const result = this.confirmImport(products);

    return {
      imported: result.imported,
      errors: result.errors + previewErrors.length,
      messages: [...messages, ...result.messages],
    };
  },
};
