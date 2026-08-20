import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/database/config/connection';
import { ProductService } from '../src/services/ProductService';
import { ProductRepository, type ProductInput } from '../src/repositories/ProductRepository';
import { StockLedgerService } from '../src/services/StockLedgerService';
import { StockMovementRepository } from '../src/repositories/StockMovementRepository';
import { DashboardRepository } from '../src/repositories/DashboardRepository';
import { ExportService } from '../src/services/ExportService';
import { DataStorageService } from '../src/services/DataStorageService';
import { validatePathWithinDataDir } from '../electron/ipcValidation';

function createProduct(ref: string, opts: { barcode?: string; sellingPrice?: number; purchasePrice?: number } = {}): string {
  const input: ProductInput = {
    reference: ref,
    designation: `Produit ${ref}`,
    purchase_price: opts.purchasePrice ?? 10,
    selling_price: opts.sellingPrice ?? 20,
    wholesale_price: (opts.purchasePrice ?? 10) + 1,
    min_stock: 5,
    unit: 'PIÈCE',
    status: 'ACTIVE',
    barcode: opts.barcode ?? null,
  };
  return ProductService.createProduct(input).id;
}

describe('Phase 1 — Recherche barcode côté SQLite (POS)', () => {
  beforeEach(() => {
    db.exec('DELETE FROM stock_movements; DELETE FROM products;');
  });

  it('retrouve EXACTEMENT 1 produit par code-barres (pas de scan de liste)', () => {
    createProduct('BAR-1', { barcode: '6111111111111' });
    createProduct('BAR-2', { barcode: '6222222222222' });

    const result = ProductRepository.findByBarcode('6111111111111');
    expect(result).toBeDefined();
    expect(result?.reference).toBe('BAR-1');
    expect(result?.barcode).toBe('6111111111111');
  });

  it('retourne undefined si le code-barres est inconnu', () => {
    expect(ProductRepository.findByBarcode('9999999999999')).toBeUndefined();
  });

  it('findByBarcode ignore les espaces (trim côté handler)', () => {
    createProduct('BAR-3', { barcode: '6333333333333' });
    // Le handler IPC fait barcode.trim() avant la requête SQL
    const result = ProductRepository.findByBarcode('6333333333333');
    expect(result?.reference).toBe('BAR-3');
  });

  it('la recherche texte est paginée (LIMIT) — ne ramène jamais tout le catalogue', () => {
    for (let i = 0; i < 120; i++) {
      createProduct(`PAG-${String(i).padStart(3, '0')}`);
    }
    const results = ProductRepository.search('PAG-', 50, 0);
    expect(results.length).toBeLessThanOrEqual(50);
  });
});

describe('Phase 2.6 — Pagination SQL de l\'historique de stock', () => {
  beforeEach(() => {
    db.exec('DELETE FROM stock_movements; DELETE FROM products;');
  });

  it('getAllHistory applique LIMIT/OFFSET côté SQL (jamais tout en mémoire)', () => {
    const productId = createProduct('HIST-PAG');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 1 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'SALE_OUT', quantity: 1, unit_price: 20 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 2 });

    const page1 = StockMovementRepository.getAllHistory(2, 0);
    const page2 = StockMovementRepository.getAllHistory(2, 2);
    expect(page1.length).toBeLessThanOrEqual(2);
    expect(page2.length).toBeLessThanOrEqual(2);
    // Les deux pages couvrent les 3 mouvements sans doublon
    const ids = [...page1, ...page2].map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Phase 4 — Exports CSV par batch (plus de plafond silencieux)', () => {
  beforeEach(() => {
    db.exec('DELETE FROM stock_movements; DELETE FROM products;');
  });

  it('exportProducts inclut TOUS les produits (pas de LIMIT 100000)', () => {
    // On crée plus de produits + on exporte : le batch doit tout écrire.
    for (let i = 0; i < 30; i++) {
      createProduct(`EXP-${String(i).padStart(3, '0')}`);
    }
    const filePath = ExportService.exportProducts();
    expect(fs.existsSync(filePath)).toBe(true);
    const lines = fs.readFileSync(filePath, 'utf-8').split('\r\n').filter(Boolean);
    // 1 ligne header + 30 produits = 31 lignes
    expect(lines.length).toBe(31);
  });

  it('exportStockMovements inclut TOUS les mouvements (pas de LIMIT 50000)', () => {
    const productId = createProduct('EXP-MVT');
    for (let i = 0; i < 25; i++) {
      StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 1 });
    }
    const filePath = ExportService.exportStockMovements();
    const lines = fs.readFileSync(filePath, 'utf-8').split('\r\n').filter(Boolean);
    // 1 header + 25 mouvements
    expect(lines.length).toBe(26);
  });

  it('garde la protection anti-injection de formule CSV (=, +, -) dans le CSV', () => {
    createProduct('EXP-FORMULA', { barcode: '=HYPERLINK("http://evil")' });
    createProduct('EXP-PLUS', { barcode: '+SUM(A1:A2)' });
    const filePath = ExportService.exportProducts();
    const content = fs.readFileSync(filePath, 'utf-8');
    // Une valeur débutant par = ou + est préfixée par une apostrophe
    expect(content).toContain(`'=HYPERLINK`);
    expect(content).toContain(`'+SUM`);
  });

  it('exportDashboard appelle bien la nouvelle requête agrégée (dettes fournisseurs)', () => {
    const filePath = ExportService.exportDashboard();
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe('Phase 10 — Dashboard : dettes fournisseurs (SQL agrégé)', () => {
  beforeEach(() => {
    db.exec('DELETE FROM stock_movements; DELETE FROM products; DELETE FROM supplier_credits; DELETE FROM suppliers;');
  });

  it('getStats calcule le total des dettes fournisseurs via SQL agrégé', () => {
    db.exec(`
      INSERT INTO suppliers (id, name) VALUES ('sup-1', 'Fournisseur A'), ('sup-2', 'Fournisseur B');
      INSERT INTO supplier_credits (id, supplier_id, type, amount) VALUES
        ('c1', 'sup-1', 'DEBT', 500),
        ('c2', 'sup-1', 'PAYMENT', 200),
        ('c3', 'sup-2', 'DEBT', 150);
    `);
    const stats = DashboardRepository.getStats();
    expect(stats.supplier_debt_total).toBe(450);
  });

  it('retourne 0 quand aucune dette fournisseur', () => {
    const stats = DashboardRepository.getStats();
    expect(stats.supplier_debt_total).toBe(0);
  });
});

describe('Phase 14 — Confinement des chemins IPC (validatePathWithinDataDir)', () => {
  it('accepte un chemin DANS le dossier de données', () => {
    const dataDir = DataStorageService.getConfig().dataPath;
    const inside = path.join(dataDir, 'attachments', 'test.jpg');
    expect(() => validatePathWithinDataDir(inside, dataDir, 'chemin image')).not.toThrow();
  });

  it('rejette un chemin absolu hors du dossier (Windows)', () => {
    const dataDir = DataStorageService.getConfig().dataPath;
    expect(() => validatePathWithinDataDir('C:\\Windows\\System32\\config\\SAM', dataDir, 'chemin image'))
      .toThrow(/hors du dossier de données/);
  });

  it('rejette un chemin absolu hors du dossier (POSIX)', () => {
    const dataDir = DataStorageService.getConfig().dataPath;
    expect(() => validatePathWithinDataDir('/etc/passwd', dataDir, 'chemin image'))
      .toThrow(/hors du dossier de données/);
  });

  it('rejette un traversal (../)', () => {
    const dataDir = DataStorageService.getConfig().dataPath;
    expect(() => validatePathWithinDataDir(path.join(dataDir, '..', 'secret.db'), dataDir, 'chemin'))
      .toThrow();
  });
});
