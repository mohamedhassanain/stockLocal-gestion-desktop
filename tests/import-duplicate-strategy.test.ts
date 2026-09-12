import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from '../src/database/config/connection';
import { ProductService } from '../src/services/ProductService';
import { ProductRepository, type ProductInput } from '../src/repositories/ProductRepository';
import { ImportService } from '../src/services/ImportService';

/**
 * §Phase 17 — Import CSV : aperçu obligatoire + stratégie de doublons explicite.
 *
 * Règles vérifiées :
 *   - l'aperçu est en LECTURE SEULE (aucune insertion) ;
 *   - une référence déjà en base est signalée comme DOUBLON ;
 *   - « Créer » signale les doublons en erreur (jamais d'écrasement) ;
 *   - « Mettre à jour » modifie le produit existant (même référence) ;
 *   - « Ignorer » laisse le produit existant intact ;
 *   - une ligne invalide (vente < achat) est comptée comme invalide, jamais importée ;
 *   - total = valides + doublons + invalides.
 */

const HEADER = 'reference;designation;purchase_price;selling_price;wholesale_price;min_stock;barcode;unit';
const tempFiles: string[] = [];

function writeCsv(lines: string[]): string {
  const file = path.join(os.tmpdir(), `sl-import-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  fs.writeFileSync(file, [HEADER, ...lines].join('\n'), 'utf-8');
  tempFiles.push(file);
  return file;
}

function baseInput(reference: string, designation: string, selling = 30): ProductInput {
  return {
    reference,
    designation,
    purchase_price: 10,
    selling_price: selling,
    wholesale_price: 25,
    min_stock: 5,
    unit: 'PIÈCE',
    status: 'ACTIVE',
  };
}

describe('§Phase 17 — Import CSV : aperçu + stratégie de doublons', () => {
  beforeEach(() => {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
      DELETE FROM stock_movements;
      DELETE FROM inventory_balances;
      DELETE FROM products;
      DELETE FROM audit_logs;
    `);
    db.exec('PRAGMA foreign_keys = ON;');
  });

  afterEach(() => {
    for (const f of tempFiles.splice(0)) {
      try { fs.unlinkSync(f); } catch { /* déjà supprimé */ }
    }
  });

  it('un fichier entièrement nouveau → tout est « valide », aucun doublon', () => {
    const file = writeCsv(['NEW-1;Produit neuf;10;30;25;5;;PIÈCE', 'NEW-2;Autre neuf;12;40;30;3;;PIÈCE']);
    const preview = ImportService.previewProductsFromCsv(file);

    expect(preview.summary.total).toBe(2);
    expect(preview.summary.valid).toBe(2);
    expect(preview.summary.duplicates).toBe(0);
    expect(preview.summary.invalid).toBe(0);
    expect(preview.rows.every(r => !r.isDuplicate)).toBe(true);
  });

  it('l’aperçu NE modifie JAMAIS la base (lecture seule)', () => {
    const existing = ProductService.createProduct(baseInput('EXIST-1', 'Produit existant', 30));
    const file = writeCsv(['EXIST-1;Nom depuis le CSV;10;99;25;5;;PIÈCE']);

    const preview = ImportService.previewProductsFromCsv(file);

    expect(preview.summary.duplicates).toBe(1);
    expect(preview.rows[0].isDuplicate).toBe(true);
    // Rien n'a été écrit : désignation ET prix sont intacts.
    const stillThere = ProductRepository.findById(existing.id);
    expect(stillThere?.designation).toBe('Produit existant');
    expect(stillThere?.selling_price).toBe(30);
  });

  it('« Créer » signale les doublons en erreur et n’écrase rien', () => {
    const existing = ProductService.createProduct(baseInput('DUP-CREATE', 'Produit existant', 30));
    const file = writeCsv(['DUP-CREATE;Nom depuis le CSV;10;99;25;5;;PIÈCE']);
    const preview = ImportService.previewProductsFromCsv(file);

    const outcome = ImportService.confirmImport(preview.rows, 'CREATE');

    expect(outcome.created).toBe(0);
    expect(outcome.updated).toBe(0);
    expect(outcome.skipped).toBe(0);
    expect(outcome.errors).toBe(1);
    expect(outcome.messages[0]).toMatch(/existe déjà/i);

    const untouched = ProductRepository.findById(existing.id);
    expect(untouched?.designation).toBe('Produit existant');
    expect(untouched?.selling_price).toBe(30);
  });

  it('« Mettre à jour » modifie le produit existant sans créer de doublon', () => {
    const existing = ProductService.createProduct(baseInput('DUP-UPDATE', 'Ancien nom', 30));
    const before = ProductRepository.search('', 50_000).length;

    const file = writeCsv(['DUP-UPDATE;Nouveau nom;10;99;25;5;;PIÈCE']);
    const preview = ImportService.previewProductsFromCsv(file);
    const outcome = ImportService.confirmImport(preview.rows, 'UPDATE');

    expect(outcome.created).toBe(0);
    expect(outcome.updated).toBe(1);
    expect(outcome.errors).toBe(0);

    const updated = ProductRepository.findById(existing.id);
    expect(updated?.designation).toBe('Nouveau nom');
    expect(updated?.selling_price).toBe(99);
    // Toujours une SEULE ligne en base : aucun doublon créé.
    expect(ProductRepository.search('', 50_000).length).toBe(before);
  });

  it('« Ignorer » laisse le produit existant intact', () => {
    const existing = ProductService.createProduct(baseInput('DUP-SKIP', 'Produit existant', 30));
    const file = writeCsv(['DUP-SKIP;Nom depuis le CSV;10;99;25;5;;PIÈCE']);
    const preview = ImportService.previewProductsFromCsv(file);

    const outcome = ImportService.confirmImport(preview.rows, 'SKIP');

    expect(outcome.skipped).toBe(1);
    expect(outcome.created).toBe(0);
    expect(outcome.updated).toBe(0);
    expect(outcome.errors).toBe(0);

    const untouched = ProductRepository.findById(existing.id);
    expect(untouched?.designation).toBe('Produit existant');
    expect(untouched?.selling_price).toBe(30);
  });

  it('mélange : nouvelles lignes créées + doublons mis à jour', () => {
    ProductService.createProduct(baseInput('MIX-OLD', 'Ancien', 30));
    const file = writeCsv([
      'MIX-OLD;Mis à jour;10;50;25;5;;PIÈCE',
      'MIX-NEW;Vraiment neuf;10;60;25;5;;PIÈCE',
    ]);
    const preview = ImportService.previewProductsFromCsv(file);

    expect(preview.summary.valid).toBe(1);
    expect(preview.summary.duplicates).toBe(1);

    const outcome = ImportService.confirmImport(preview.rows, 'UPDATE');
    expect(outcome.created).toBe(1);
    expect(outcome.updated).toBe(1);
    expect(ProductRepository.findByReference('MIX-OLD')?.designation).toBe('Mis à jour');
    expect(ProductRepository.findByReference('MIX-NEW')?.designation).toBe('Vraiment neuf');
  });

  it('une ligne invalide (vente < achat) est comptée invalide et JAMAIS importée', () => {
    const file = writeCsv([
      'OK-1;Bon produit;10;30;25;5;;PIÈCE',
      'BAD-1;Produit incohérent;100;5;25;5;;PIÈCE',
    ]);
    const preview = ImportService.previewProductsFromCsv(file);

    expect(preview.summary.invalid).toBe(1);
    expect(preview.summary.valid).toBe(1);
    expect(preview.errors[0].message).toMatch(/prix de vente/i);

    const outcome = ImportService.confirmImport(preview.rows, 'CREATE');
    expect(outcome.created).toBe(1);
    expect(ProductRepository.findByReference('BAD-1')).toBeUndefined();
  });

  it('total = valides + doublons + invalides', () => {
    ProductService.createProduct(baseInput('SUM-DUP', 'Existant', 30));
    const file = writeCsv([
      'SUM-NEW;Nouveau;10;30;25;5;;PIÈCE',
      'SUM-DUP;Doublon;10;30;25;5;;PIÈCE',
      'SUM-BAD;Invalide;100;5;25;5;;PIÈCE',
    ]);

    const { summary } = ImportService.previewProductsFromCsv(file);
    expect(summary.total).toBe(3);
    expect(summary.valid + summary.duplicates + summary.invalid).toBe(summary.total);
    expect(summary.valid).toBe(1);
    expect(summary.duplicates).toBe(1);
    expect(summary.invalid).toBe(1);
  });
});
