import { ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { requireId, validatePathWithinDataDir, validateFilePath, FILE_LIMITS, assertFileSizeWithin, toHumanError } from '../ipcValidation';
import { ProductRepository, type Product, type ProductInput } from '../../src/repositories/ProductRepository';
import { ProductService } from '../../src/services/ProductService';
import { StockService } from '../../src/services/StockService';
import { StockMovementRepository } from '../../src/repositories/StockMovementRepository';
import { CategoryRepository } from '../../src/repositories/CategoryRepository';
import { VolumeDiscountRepository } from '../../src/repositories/VolumeDiscountRepository';
import { UnitConversionRepository } from '../../src/repositories/UnitConversionRepository';
import { ProductBatchRepository } from '../../src/repositories/ProductBatchRepository';
import { WarehouseRepository } from '../../src/repositories/WarehouseRepository';
import { StockLedgerService } from '../../src/services/StockLedgerService';
import { PriceHistoryRepository } from '../../src/repositories/PriceHistoryRepository';
import { CompanySettingsService } from '../../src/services/CompanySettingsService';
import { GlobalSettingsService } from '../../src/services/GlobalSettingsService';
import { ImportService, type ImportDuplicateStrategy } from '../../src/services/ImportService';
import { ExportService } from '../../src/services/ExportService';
import { AuditService } from '../../src/services/AuditService';
import { PDFService } from '../../src/services/PDFService';
import { BackupService } from '../../src/services/BackupService';
import { DataStorageService } from '../../src/services/DataStorageService';
import {
  safeParse,
  nullToUndefined,
  ProductCreateSchema,
  ProductUpdateSchema,
  CategorySchema,
  SubcategorySchema,
  VolumeDiscountSchema,
  UnitConversionSchema,
  ProductBatchCreateSchema,
  WarehouseSchema,
  TransferCreateSchema,
  CompanySettingsSchema,
  GlobalSettingsSchema,
} from '../../src/validation/schemas';
import { shell } from 'electron';

async function humanError(action: () => unknown): Promise<unknown> {
  try {
    return await action();
  } catch (error: unknown) {
    return { success: false, error: toHumanError(error) };
  }
}

/**
 * Construit un ProductInput complet à partir du produit existant et d'un patch
 * validé par Zod. `undefined` = champ non fourni (on garde la valeur courante),
 * `null` = champ explicitement effacé (code-barres, description…).
 *
 * Plus aucun cast : la frontière IPC est typée de bout en bout.
 */
function buildProductInput(
  current: Product,
  patch: z.infer<typeof ProductUpdateSchema>,
): ProductInput {
  const pick = <T>(patchValue: T | undefined, currentValue: T): T =>
    patchValue !== undefined ? patchValue : currentValue;

  return {
    reference: pick(patch.reference, current.reference),
    designation: pick(patch.designation, current.designation),
    description: pick(patch.description, current.description),
    category_id: pick(patch.category_id, current.category_id),
    subcategory_id: pick(patch.subcategory_id, current.subcategory_id),
    barcode: pick(patch.barcode, current.barcode),
    image_path: pick(patch.image_path, current.image_path),
    unit: pick(patch.unit, current.unit ?? 'PIÈCE'),
    purchase_price: pick(patch.purchase_price, current.purchase_price),
    selling_price: pick(patch.selling_price, current.selling_price),
    wholesale_price: pick(patch.wholesale_price, current.wholesale_price),
    min_stock: pick(patch.min_stock, current.min_stock),
    batch_managed: pick(patch.batch_managed, current.batch_managed ?? 0),
    status: pick(patch.status, current.status),
  };
}

export function registerReferenceDataHandlers(): void {
  // ─── Produits ──────────────────────────────────────────────────────────────
  ipcMain.handle('products:search', async (_, query: unknown) => {
    const safeQuery = typeof query === 'string' ? query.trim().slice(0, 200) : '';
    return ProductService.searchProducts(safeQuery);
  });

  ipcMain.handle('products:getByBarcode', async (_, barcode: unknown) => {
    if (!barcode || typeof barcode !== 'string') return null;
    return ProductRepository.findByBarcode(barcode.trim()) ?? null;
  });

  ipcMain.handle('products:getByReference', async (_, reference: unknown) => {
    const safeReference = typeof reference === 'string' ? reference.trim().slice(0, 200) : '';
    return ProductRepository.findByReference(safeReference) ?? null;
  });

  ipcMain.handle('products:create', async (_, productData: unknown) => {
    return humanError(() => {
      const data = nullToUndefined(safeParse(ProductCreateSchema, productData, 'Création produit'));
      const product = ProductService.createProduct(data);
      AuditService.log('PRODUCT_CREATE', 'product', product.id, `Création produit ${product.reference}`);
      return { success: true, data: product };
    });
  });

  ipcMain.handle('products:update', async (_, { id, data }: { id: unknown; data: unknown }) => {
    return humanError(() => {
      const safeId = requireId(id, 'id produit');
      const safeData = safeParse(ProductUpdateSchema, data, 'Modification produit');
      const oldProduct = ProductRepository.findById(safeId);
      if (!oldProduct) throw new Error('Produit introuvable.');
      const product = ProductService.updateProduct(safeId, buildProductInput(oldProduct, safeData));
      AuditService.log(
        'PRODUCT_UPDATE', 'product', safeId, `Modification produit ${product.reference}`,
        { purchase_price: oldProduct.purchase_price, selling_price: oldProduct.selling_price, wholesale_price: oldProduct.wholesale_price },
        { purchase_price: product.purchase_price, selling_price: product.selling_price, wholesale_price: product.wholesale_price }
      );
      return { success: true, data: product };
    });
  });

  ipcMain.handle('products:updateWithStock', async (_, { id, data, stockAdjustment }: { id: unknown; data: unknown; stockAdjustment: unknown }) => {
    return humanError(() => {
      const safeId = requireId(id, 'id produit');
      const adjustment = Number(stockAdjustment);
      const safeData = safeParse(ProductUpdateSchema, data, 'Modification produit');
      const current = ProductRepository.findById(safeId);
      if (!current) throw new Error('Produit introuvable.');
      // P0-3 : produit + ajustement de stock dans une seule transaction.
      const product = ProductService.updateProductWithStock(safeId, buildProductInput(current, safeData), adjustment);
      AuditService.log('PRODUCT_UPDATE', 'product', safeId, `Modification produit ${product.reference}${adjustment !== 0 ? ` (stock ajusté de ${adjustment})` : ''}`);
      return { success: true, data: product };
    });
  });

  ipcMain.handle('products:archive', async (_, id: unknown) => {
    return humanError(() => {
      const safeId = requireId(id, 'id produit');
      ProductService.archiveProduct(safeId);
      AuditService.log('PRODUCT_ARCHIVE', 'product', safeId, 'Produit archivé');
      return { success: true };
    });
  });

  ipcMain.handle('products:activate', async (_, id: unknown) => {
    return humanError(() => {
      const safeId = requireId(id, 'id produit');
      ProductService.activateProduct(safeId);
      AuditService.log('PRODUCT_ACTIVATE', 'product', safeId, 'Produit réactivé');
      return { success: true };
    });
  });

  ipcMain.handle('products:disable', async (_, id: unknown) => {
    return humanError(() => {
      const safeId = requireId(id, 'id produit');
      ProductRepository.disable(safeId);
      AuditService.log('PRODUCT_DISABLE', 'product', safeId, 'Produit désactivé (retiré de la vente)');
      return { success: true };
    });
  });

  ipcMain.handle('products:delete', async (_, id: unknown) => {
    return humanError(() => {
      const safeId = requireId(id, 'id produit');
      const product = ProductRepository.findById(safeId);
      if (!product) throw new Error('Produit introuvable.');
      ProductService.deleteProduct(safeId);
      AuditService.log('PRODUCT_DELETE', 'product', safeId, `Suppression définitive produit ${product.reference}`);
      return { success: true };
    });
  });

  ipcMain.handle('products:createWithStock', async (_, { productData, initialStock }: { productData: unknown; initialStock: unknown }) => {
    return humanError(() => {
      const safe = nullToUndefined(safeParse(ProductCreateSchema, productData, 'Création produit'));
      const initial = Number(initialStock);
      if (!Number.isFinite(initial) || initial < 0 || initial > 1_000_000) {
        throw new Error('Stock initial invalide (0 à 1 000 000).');
      }
      // P0-2 : produit + stock initial dans une seule transaction (jamais d'état partiel).
      const product = ProductService.createProductWithInitialStock(safe, initial);
      AuditService.log('PRODUCT_CREATE', 'product', product.id, `Création produit ${product.reference}${initial > 0 ? ` (stock initial: ${initial})` : ''}`);
      return { success: true, data: product };
    });
  });

  ipcMain.handle('products:getAll', async () => {
    return ProductRepository.search('', 50);
  });

  // ─── Catégories ────────────────────────────────────────────────────────────
  ipcMain.handle('categories:getAll', async () => {
    return CategoryRepository.getAll();
  });

  ipcMain.handle('categories:create', async (_, data: unknown) => {
    return humanError(() => {
      const safe = nullToUndefined(safeParse(CategorySchema, data, 'Création catégorie'));
      const cat = CategoryRepository.create(safe);
      AuditService.log('CATEGORY_CREATE', 'category', cat.id, `Catégorie ${cat.name}`);
      return { success: true, data: cat };
    });
  });

  ipcMain.handle('categories:update', async (_, { id, data }: { id: unknown; data: unknown }) => {
    return humanError(() => {
      const safeId = requireId(id, 'id catégorie');
      const safe = nullToUndefined(safeParse(CategorySchema, data, 'Modification catégorie'));
      return { success: true, data: CategoryRepository.update(safeId, safe) };
    });
  });

  ipcMain.handle('categories:delete', async (_, id: unknown) => {
    return humanError(() => {
      const safeId = requireId(id, 'id catégorie');
      CategoryRepository.remove(safeId);
      AuditService.log('CATEGORY_DELETE', 'category', safeId, 'Catégorie supprimée');
      return { success: true };
    });
  });

  ipcMain.handle('categories:addSub', async (_, { categoryId, data }: { categoryId: unknown; data: unknown }) => {
    return humanError(() => {
      const safeId = requireId(categoryId, 'id catégorie');
      const safe = nullToUndefined(safeParse(SubcategorySchema, data, 'Création sous-catégorie'));
      return { success: true, data: CategoryRepository.addSubcategory(safeId, safe) };
    });
  });

  ipcMain.handle('categories:updateSub', async (_, { id, data }: { id: unknown; data: unknown }) => {
    return humanError(() => {
      const safeId = requireId(id, 'id sous-catégorie');
      const safe = nullToUndefined(safeParse(SubcategorySchema, data, 'Modification sous-catégorie'));
      return { success: true, data: CategoryRepository.updateSubcategory(safeId, safe) };
    });
  });

  ipcMain.handle('categories:deleteSub', async (_, id: unknown) => {
    return humanError(() => {
      const safeId = requireId(id, 'id sous-catégorie');
      CategoryRepository.removeSubcategory(safeId);
      return { success: true };
    });
  });

  // ─── Remises par volume ────────────────────────────────────────────────────
  ipcMain.handle('discounts:getAll', async () => {
    return VolumeDiscountRepository.getAll();
  });

  ipcMain.handle('discounts:create', async (_, data: unknown) => {
    return humanError(() => {
      const safe = safeParse(VolumeDiscountSchema, data, 'Création règle de remise');
      const d = VolumeDiscountRepository.create(safe);
      AuditService.log('DISCOUNT_CREATE', 'discount', d.id, `${d.name} : ${d.discount_pct}%`);
      return { success: true, data: d };
    });
  });

  ipcMain.handle('discounts:update', async (_, { id, data }: { id: unknown; data: unknown }) => {
    return humanError(() => {
      const safeId = requireId(id, 'id règle de remise');
      const safe = safeParse(VolumeDiscountSchema, data, 'Modification règle de remise');
      return { success: true, data: VolumeDiscountRepository.update(safeId, safe) };
    });
  });

  ipcMain.handle('discounts:delete', async (_, id: unknown) => {
    return humanError(() => {
      const safeId = requireId(id, 'id règle de remise');
      VolumeDiscountRepository.remove(safeId);
      return { success: true };
    });
  });

  // ─── Unit Conversions ──────────────────────────────────────────────────────
  ipcMain.handle('conversions:getAll', async () => {
    return UnitConversionRepository.getAll();
  });

  ipcMain.handle('conversions:getByProduct', async (_, productId: unknown) => {
    return UnitConversionRepository.getByProduct(requireId(productId, 'id produit'));
  });

  ipcMain.handle('conversions:create', async (_, data: unknown) => {
    return humanError(() => {
      const safe = safeParse(UnitConversionSchema, data, 'Création conversion');
      const payload = { ...safe, product_id: safe.product_id ?? null };
      const conv = UnitConversionRepository.create(payload);
      AuditService.log('CONVERSION_CREATE', 'conversion', conv.id, `${conv.from_unit} → ${conv.to_unit} (×${conv.factor})`);
      return { success: true, data: conv };
    });
  });

  ipcMain.handle('conversions:update', async (_, { id, data }: { id: unknown; data: unknown }) => {
    return humanError(() => {
      const safeId = requireId(id, 'id conversion');
      const safe = safeParse(UnitConversionSchema, data, 'Modification conversion');
      const payload = { ...safe, product_id: safe.product_id ?? null };
      return { success: true, data: UnitConversionRepository.update(safeId, payload) };
    });
  });

  ipcMain.handle('conversions:delete', async (_, id: unknown) => {
    try {
      UnitConversionRepository.remove(requireId(id, 'id conversion'));
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('conversions:convert', async (_, { quantity, fromUnit, toUnit, productId }: { quantity: unknown; fromUnit: unknown; toUnit: unknown; productId?: unknown }) => {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 0) throw new Error('Quantité invalide.');
    const from = typeof fromUnit === 'string' ? fromUnit.trim().slice(0, 20) : '';
    const to = typeof toUnit === 'string' ? toUnit.trim().slice(0, 20) : '';
    const pid = typeof productId === 'string' && productId ? productId.slice(0, 64) : undefined;
    const result = UnitConversionRepository.convert(qty, from, to, pid);
    if (result === null) {
      throw new Error(`Aucune conversion trouvée de ${from} vers ${to}`);
    }
    return result;
  });

  // ─── Lots / dates d'expiration (Phase 3) ───────────────────────────────────
  ipcMain.handle('batches:listByProduct', async (_, productId: unknown) => {
    return ProductBatchRepository.listByProduct(requireId(productId, 'id produit'));
  });

  ipcMain.handle('batches:create', async (_, data: unknown) => {
    return humanError(() => {
      const safe = safeParse(ProductBatchCreateSchema, data, 'Création de lot');
      const batch = ProductBatchRepository.create({
        product_id: safe.product_id,
        lot_number: safe.lot_number,
        quantity: safe.quantity,
        expiry_date: safe.expiry_date ?? null,
      });
      AuditService.log('BATCH_CREATE', 'product', safe.product_id, `Lot ${batch.lot_number} (${batch.quantity})`);
      return { success: true, data: batch };
    });
  });

  ipcMain.handle('batches:delete', async (_, id: unknown) => {
    return humanError(() => {
      ProductBatchRepository.remove(requireId(id, 'id lot'));
      return { success: true };
    });
  });

  ipcMain.handle('batches:getExpiring', async (_, withinDays: unknown) => {
    const days = Number(withinDays);
    return ProductBatchRepository.getExpiringBatches(Number.isFinite(days) ? days : 30);
  });

  // §Phase 13 — FEFO : lots d'un produit dans l'ORDRE DE CONSOMMATION
  // (expiration croissante, lots sans date en dernier).
  ipcMain.handle('batches:listFefo', async (_, productId: unknown) => {
    return ProductBatchRepository.listFefo(requireId(productId, 'id produit'));
  });

  // §Phase 13 — PLAN FEFO (LECTURE SEULE) : quels lots SERAIENT prélevés pour
  // une quantité donnée. N'écrit jamais rien.
  ipcMain.handle('batches:getFefoPlan', async (_, { productId, quantity }: { productId: unknown; quantity: unknown }) => {
    return humanError(() => {
      const id = requireId(productId, 'id produit');
      const qty = Number(quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error('Quantité invalide : elle doit être supérieure à 0.');
      }
      return ProductBatchRepository.getFefoPlan(id, qty);
    });
  });

  // ─── Dépôts (Phase 5) ──────────────────────────────────────────────────────
  ipcMain.handle('warehouses:getAll', async () => {
    return WarehouseRepository.getAll();
  });

  ipcMain.handle('warehouses:create', async (_, data: unknown) => {
    return humanError(() => {
      const safe = safeParse(WarehouseSchema, data, 'Création dépôt');
      const warehouse = WarehouseRepository.create({ name: safe.name, address: safe.address ?? null, is_default: safe.is_default });
      AuditService.log('WAREHOUSE_CREATE', 'warehouse', warehouse.id, `Dépôt ${warehouse.name}`);
      return { success: true, data: warehouse };
    });
  });

  ipcMain.handle('warehouses:update', async (_, { id, data }: { id: unknown; data: unknown }) => {
    return humanError(() => {
      const safeId = requireId(id, 'id dépôt');
      const safe = safeParse(WarehouseSchema, data, 'Modification dépôt');
      const warehouse = WarehouseRepository.update(safeId, { name: safe.name, address: safe.address ?? null, is_default: safe.is_default });
      AuditService.log('WAREHOUSE_UPDATE', 'warehouse', safeId, `Dépôt ${warehouse.name} modifié`);
      return { success: true, data: warehouse };
    });
  });

  ipcMain.handle('warehouses:setDefault', async (_, id: unknown) => {
    return humanError(() => {
      const safeId = requireId(id, 'id dépôt');
      WarehouseRepository.setDefault(safeId);
      AuditService.log('WAREHOUSE_DEFAULT', 'warehouse', safeId, 'Dépôt par défaut modifié');
      return { success: true };
    });
  });

  ipcMain.handle('warehouses:delete', async (_, id: unknown) => {
    return humanError(() => {
      WarehouseRepository.remove(requireId(id, 'id dépôt'));
      return { success: true };
    });
  });

  // Dépôt ACTIF (multi-dépôts) : le rendu lit/écrit ce paramètre local. Les
  // écritures de stock sans dépôt explicite s'appliquent à ce dépôt.
  ipcMain.handle('warehouses:getActive', async () => {
    const id = StockLedgerService.getActiveWarehouseId();
    const warehouse = WarehouseRepository.getById(id);
    return { id, name: warehouse?.name ?? 'Dépôt principal' };
  });

  ipcMain.handle('warehouses:setActive', async (_, id: unknown) => {
    return humanError(() => {
      const safeId = requireId(id, 'id dépôt');
      const warehouse = WarehouseRepository.getById(safeId);
      if (!warehouse) throw new Error('Dépôt introuvable.');
      GlobalSettingsService.save({ active_warehouse_id: safeId });
      return { success: true, data: { id: safeId, name: warehouse.name } };
    });
  });

  // ─── Transferts entre dépôts (multi-dépôts) ────────────────────────────────
  ipcMain.handle('transfers:create', async (_, data: unknown) => {
    return humanError(() => {
      const safe = safeParse(TransferCreateSchema, data, 'Création transfert');
      const transfer = StockLedgerService.transferStock({
        product_id: safe.product_id,
        from_warehouse_id: safe.from_warehouse_id,
        to_warehouse_id: safe.to_warehouse_id,
        quantity: safe.quantity,
        notes: safe.notes ?? undefined,
      });
      AuditService.log('STOCK_TRANSFER', 'product', safe.product_id,
        `Transfert ${transfer.quantity} du dépôt ${transfer.from_warehouse_id} vers ${transfer.to_warehouse_id}`);
      return { success: true, data: transfer };
    });
  });

  ipcMain.handle('transfers:getHistory', async (_, limit: unknown) => {
    const safeLimit = Number.isFinite(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 1000) : 200;
    return StockLedgerService.getTransfers(safeLimit, 0);
  });

  // ─── Price History ─────────────────────────────────────────────────────────
  ipcMain.handle('prices:getHistory', async (_, productId: unknown) => {
    return PriceHistoryRepository.getByProduct(requireId(productId, 'id produit'));
  });

  // ─── Paramètres entreprise ─────────────────────────────────────────────────
  ipcMain.handle('company:get', async () => {
    return CompanySettingsService.getAll();
  });

  // Sélection d'un logo d'entreprise : boîte de dialogue native, puis copie
  // dans le dossier de données (comme les images produit) pour que la
  // validation `company:save` (confinée au dataDir) l'accepte.
  ipcMain.handle('company:pickLogo', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Choisir le logo de l\'entreprise',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (canceled || filePaths.length === 0) return { success: false, canceled: true };
    const src = filePaths[0];
    if (fs.statSync(src).size > FILE_LIMITS.IMAGE_MAX_BYTES) {
      return { success: false, error: 'Logo trop volumineux (max 5 Mo).' };
    }
    const ext = path.extname(src).toLowerCase();
    const dataPath = DataStorageService.getConfig().dataPath;
    const dest = path.join(dataPath, `logo_entreprise${ext}`);
    try {
      fs.copyFileSync(src, dest);
    } catch {
      return { success: false, error: 'Impossible de copier le logo.' };
    }
    return { success: true, path: dest };
  });

  ipcMain.handle('company:save', async (_, settings: unknown) => {
    return humanError(() => {
      const safe = safeParse(CompanySettingsSchema, settings, 'Paramètres entreprise');
      // §2.2 : le logo est un fichier utilisé ensuite par PDFService
      // (fs.readFileSync). Un chemin renderer arbitraire permettrait la lecture
      // de n'importe quel fichier → le logo est confiné au dossier de données.
      if (safe.logo_path) {
        const dataPath = DataStorageService.getConfig().dataPath;
        const safeLogo = validatePathWithinDataDir(safe.logo_path, dataPath, 'chemin logo');
        if (!fs.existsSync(safeLogo) || fs.statSync(safeLogo).size > FILE_LIMITS.IMAGE_MAX_BYTES) {
          throw new Error('Logo invalide : fichier introuvable ou supérieur à 5 Mo.');
        }
        safe.logo_path = safeLogo;
      }
      const saved = CompanySettingsService.save(safe);
      AuditService.log('COMPANY_UPDATE', 'company', 'settings', 'Paramètres entreprise modifiés');
      return { success: true, data: saved };
    });
  });

  // ─── Global Settings ───────────────────────────────────────────────────────
  ipcMain.handle('globalSettings:get', async () => {
    return GlobalSettingsService.getAll();
  });

  ipcMain.handle('globalSettings:save', async (_, settings: unknown) => {
    return humanError(() => {
      const safe = safeParse(GlobalSettingsSchema, settings, 'Paramètres globaux');
      const saved = GlobalSettingsService.save(safe);
      // Re-planifie la sauvegarde automatique selon les nouveaux réglages
      // (l'utilisateur vient peut-être d'activer/désactiver l'option).
      BackupService.scheduleAutoBackup();
      return { success: true, data: saved };
    });
  });

  // ─── Import produits (CSV) ─────────────────────────────────────────────────
  ipcMain.handle('products:importCsv', async (_, filePath: unknown) => {
    return humanError(() => {
      if (typeof filePath !== 'string') throw new Error('Chemin CSV invalide.');
      // P1-12 : rejet des traversals / chemins absolus arbitraires + limite de
      // taille (anti DoS mémoire). Le fichier vient normalement du dialogue
      // natif, mais on ne fait pas confiance au renderer.
      const safePath = validateFilePath(filePath, 'chemin CSV');
      assertFileSizeWithin(safePath, FILE_LIMITS.CSV_MAX_BYTES, 'chemin CSV');
      const result = ImportService.importProductsFromCsv(safePath);
      AuditService.log('PRODUCT_IMPORT', 'product', 'bulk', `Import CSV : ${result.imported} produits, ${result.errors} erreurs`);
      return { success: true, ...result };
    });
  });

  ipcMain.handle('products:previewImportCsv', async (_, filePath: unknown) => {
    return humanError(() => {
      if (typeof filePath !== 'string') throw new Error('Chemin CSV invalide.');
      // P1-12 : même validation que l'import (traversal + taille).
      const safePath = validateFilePath(filePath, 'chemin CSV');
      assertFileSizeWithin(safePath, FILE_LIMITS.CSV_MAX_BYTES, 'chemin CSV');
      const result = ImportService.previewProductsFromCsv(safePath);
      return { success: true, data: result };
    });
  });

  // §Phase 17 — Confirmation de l'import avec stratégie de doublons EXPLICITE.
  // Le statut « doublon » n'est JAMAIS repris du renderer : il est recalculé ici
  // depuis la base (SQLite = source de vérité), sinon un renderer compromis
  // pourrait forcer un écrasement en se déclarant « non doublon ».
  ipcMain.handle('products:confirmImport', async (_, payload: unknown) => {
    return humanError(() => {
      const body = (payload ?? {}) as { products?: unknown; strategy?: unknown };
      if (!Array.isArray(body.products)) throw new Error('Liste de produits invalide.');

      const strategy: ImportDuplicateStrategy =
        body.strategy === 'UPDATE' || body.strategy === 'SKIP' ? body.strategy : 'CREATE';

      const safe = body.products
        .slice(0, 50_000)
        .map(p => {
          try { return nullToUndefined(safeParse(ProductCreateSchema, p, 'Import produit')); }
          catch { return null; }
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);

      const rows = safe.map(product => ({
        product,
        isDuplicate: ProductRepository.findByReference(product.reference) !== undefined,
      }));

      const result = ImportService.confirmImport(rows, strategy);
      AuditService.log('PRODUCT_IMPORT', 'product', 'bulk',
        `Import confirmé (${strategy}) : ${result.created} créés, ${result.updated} mis à jour, ${result.skipped} ignorés, ${result.errors} erreurs`);
      return { success: true, data: result };
    });
  });

  // ─── Étiquettes / images ───────────────────────────────────────────────────
  ipcMain.handle('products:getImageBase64', async (_, imagePath: unknown) => {
    return humanError(() => {
      if (typeof imagePath !== 'string') throw new Error('Chemin image invalide.');
      // §2.2/§11 : lecture confinée au dossier de données + limite 5 Mo
      // (transfert base64 via IPC) — un chemin arbitraire est rejeté.
      const safePath = validatePathWithinDataDir(imagePath, DataStorageService.getConfig().dataPath, 'chemin image');
      assertFileSizeWithin(safePath, FILE_LIMITS.IMAGE_MAX_BYTES, 'chemin image');
      const buffer = fs.readFileSync(safePath);
      const ext = path.extname(safePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.gif': 'image/gif',
        '.webp': 'image/webp', '.bmp': 'image/bmp',
      };
      const mime = mimeMap[ext] || 'image/png';
      return { success: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
    });
  });

  ipcMain.handle('products:printLabels', async (_, productIds: unknown) => {
    return humanError(async () => {
      const ids = Array.isArray(productIds) ? productIds.slice(0, 500).filter((p): p is string => typeof p === 'string') : [];
      if (ids.length === 0) throw new Error('Aucun produit sélectionné.');
      const filePath = await PDFService.generateBarcodeLabels(ids);
      shell.openPath(filePath);
      return { success: true, filePath };
    });
  });

  // ─── Exports ───────────────────────────────────────────────────────────────
  ipcMain.handle('export:products', async () => {
    return humanError(() => {
      const filePath = ExportService.exportProducts();
      shell.openPath(filePath);
      return { success: true, filePath };
    });
  });

  ipcMain.handle('export:clients', async () => {
    return humanError(() => {
      const filePath = ExportService.exportClients();
      shell.openPath(filePath);
      return { success: true, filePath };
    });
  });

  ipcMain.handle('export:suppliers', async () => {
    return humanError(() => {
      const filePath = ExportService.exportSuppliers();
      shell.openPath(filePath);
      return { success: true, filePath };
    });
  });

  ipcMain.handle('export:stock', async (_, productId: unknown) => {
    return humanError(() => {
      const safeId = typeof productId === 'string' && productId ? requireId(productId, 'id produit') : undefined;
      const filePath = ExportService.exportStockMovements(safeId);
      shell.openPath(filePath);
      return { success: true, filePath };
    });
  });

  ipcMain.handle('export:documents', async (_, type: unknown) => {
    return humanError(() => {
      const safeType = typeof type === 'string' ? type.slice(0, 30) : undefined;
      const filePath = ExportService.exportDocuments(safeType);
      shell.openPath(filePath);
      return { success: true, filePath };
    });
  });

  ipcMain.handle('export:dashboard', async () => {
    return humanError(async () => {
      const filePath = await ExportService.exportDashboard();
      shell.openPath(filePath);
      return { success: true, filePath };
    });
  });
}
