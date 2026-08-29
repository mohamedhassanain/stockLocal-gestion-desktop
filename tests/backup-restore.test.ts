import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { db, checkIntegrity } from '../src/database/config/connection';
import { StockLedgerService } from '../src/services/StockLedgerService';
import { ProductService } from '../src/services/ProductService';
import type { ProductInput } from '../src/repositories/ProductRepository';
import { DataStorageService } from '../src/services/DataStorageService';

function createProduct(ref: string): string {
  const input: ProductInput = {
    reference: ref,
    designation: `Produit ${ref}`,
    purchase_price: 10,
    selling_price: 20,
    wholesale_price: 15,
    min_stock: 5,
    unit: 'PIÈCE',
    status: 'ACTIVE',
  };
  return ProductService.createProduct(input).id;
}

describe('Backup / Restore (§15)', () => {
  it('produit un backup valide (VACUUM INTO) pour une base saine', async () => {
    const dataPath = DataStorageService.getConfig().dataPath;
    const backupDir = path.join(dataPath, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const productId = createProduct('BACKUP-VALID');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 10 });

    const { BackupService } = await import('../src/services/BackupService');
    const backupPath = await BackupService.backup(backupDir);
    expect(fs.existsSync(backupPath)).toBe(true);

    const validation = await BackupService.validateBackup(backupPath);
    expect(validation.valid).toBe(true);
    expect(checkIntegrity().valid).toBe(true);
  });

  it('refuse de restaurer un fichier inexistant', async () => {
    const { BackupService } = await import('../src/services/BackupService');
    const result = await BackupService.restoreBackup(path.join(process.cwd(), 'does-not-exist.db'));
    expect(result.success).toBe(false);
  });

  it('restore planifie la restauration (marqueur .restore_pending.db) puis la base restaurée est intacte', async () => {
    const dataPath = DataStorageService.getConfig().dataPath;
    const backupDir = path.join(dataPath, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    // 1. Base source : un produit + un mouvement
    const productId = createProduct('BACKUP-RESTORE');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 42 });

    const { BackupService } = await import('../src/services/BackupService');
    const backupPath = await BackupService.backup(backupDir);

    // 2. Restaurer : doit déposer le marqueur (pas de remplacement à chaud sur Windows)
    const restoreResult = await BackupService.restoreBackup(backupPath);
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.needsRestart).toBe(true);

    const markerPath = path.join(dataPath, '.restore_pending.db');
    expect(fs.existsSync(markerPath)).toBe(true);

    // 3. Simuler le redémarrage : le marqueur est un backup SQLite valide,
    //    il sera appliqué par connection.ts au prochain boot.
    const Database = (await import('better-sqlite3')).default;
    const testDb = new Database(markerPath, { readonly: true });
    const integrity = testDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    testDb.close();
    expect(integrity[0]?.integrity_check).toBe('ok');

    // Nettoyage pour ne pas interférer avec les autres tests
    fs.unlinkSync(markerPath);
    db.exec('DELETE FROM inventory_balances; DELETE FROM stock_movements; DELETE FROM products;');
  });

  it('crée un backup de sécurité automatique sans corrompre la base courante', async () => {
    const dataPath = DataStorageService.getConfig().dataPath;
    const backupDir = path.join(dataPath, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const productId = createProduct('BACKUP-AUTO');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 7 });

    const { BackupService } = await import('../src/services/BackupService');
    const backupPath = await BackupService.backup(backupDir);

    // La base courante reste intacte après le backup
    expect(checkIntegrity().valid).toBe(true);
    expect(StockLedgerService.getStockLevel(productId)).toBe(7);

    // Le backup contient bien le produit
    const Database = (await import('better-sqlite3')).default;
    const testDb = new Database(backupPath, { readonly: true });
    const row = testDb.prepare('SELECT COUNT(*) AS count FROM products WHERE reference = ?').get('BACKUP-AUTO') as { count: number };
    testDb.close();
    expect(row.count).toBe(1);

    db.exec('DELETE FROM inventory_balances; DELETE FROM stock_movements; DELETE FROM products;');
  });
});
