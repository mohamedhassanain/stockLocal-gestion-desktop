import fs from 'fs';
import { ProductService } from './ProductService';
import type { ProductInput } from '../repositories/ProductRepository';

/**
 * Import de produits depuis un fichier CSV (cahier des charges §3).
 * Format attendu : reference;designation;purchase_price;selling_price;wholesale_price;min_stock;barcode;unit
 * Séparateur supporté : ; ou ,  — 1re ligne = en-tête.
 */
export const ImportService = {
  importProductsFromCsv(filePath: string): { imported: number; errors: number; messages: string[] } {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Fichier introuvable : ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');

    if (lines.length < 2) {
      throw new Error('Le fichier CSV doit contenir un en-tête et au moins une ligne de données.');
    }

    // Détection du séparateur
    const sep = lines[0].includes(';') ? ';' : ',';

    const header = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/[\uFEFF"]/g, ''));
    const required = ['reference', 'designation'];
    for (const r of required) {
      if (!header.includes(r)) {
        throw new Error(`Colonne requise absente : "${r}". Colonnes trouvées : ${header.join(', ')}`);
      }
    }

    const idx = (name: string): number => header.indexOf(name);
    const num = (v: string | undefined): number => {
      const n = parseFloat((v ?? '').replace(/"/g, ''));
      return isNaN(n) ? 0 : n;
    };

    const imported: ProductInput[] = [];
    const messages: string[] = [];
    let errors = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map(c => c.trim());
      if (cols.every(c => c === '')) continue;

      const reference = cols[idx('reference')] ?? '';
      const designation = cols[idx('designation')] ?? '';

      if (!reference || !designation) {
        errors++;
        messages.push(`Ligne ${i + 1} : référence ou désignation manquante.`);
        continue;
      }

      const product: ProductInput = {
        reference,
        designation,
        description: cols[idx('description')] || undefined,
        barcode: cols[idx('barcode')] || undefined,
        unit: (cols[idx('unit')] || 'PIÈCE').toUpperCase(),
        purchase_price: num(cols[idx('purchase_price')]),
        selling_price: num(cols[idx('selling_price')]),
        wholesale_price: num(cols[idx('wholesale_price')]),
        min_stock: Math.round(num(cols[idx('min_stock')])),
        status: 'ACTIVE',
      };

      try {
        ProductService.createProduct(product);
        imported.push(product);
      } catch (e: any) {
        errors++;
        messages.push(`Ligne ${i + 1} (${reference}) : ${e.message}`);
      }
    }

    return { imported: imported.length, errors, messages };
  }
};
