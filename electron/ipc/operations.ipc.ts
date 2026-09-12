import { ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { requireId, toHumanError } from '../ipcValidation';
import { DashboardRepository } from '../../src/repositories/DashboardRepository';
import { PurchaseOrderRepository } from '../../src/repositories/PurchaseOrderRepository';
import { InventorySessionRepository } from '../../src/repositories/InventorySessionRepository';
import { GlobalSearchRepository } from '../../src/repositories/GlobalSearchRepository';
import { CashSessionRepository, type CashMovementType, type CashDirection, type CashMethod } from '../../src/repositories/CashSessionRepository';
import { ExpenseRepository } from '../../src/repositories/ExpenseRepository';
import { ProfitService } from '../../src/services/ProfitService';
import { StockAlertService } from '../../src/services/StockAlertService';
import { AuditService } from '../../src/services/AuditService';
import { PDFService } from '../../src/services/PDFService';
import { DataStorageService } from '../../src/services/DataStorageService';
import { safeParse, PurchaseSchema, PurchaseReceiveSchema, InventoryCreateVersionSchema, InventoryGetVersionsSchema, InventoryRestoreVersionSchema, InventoryCorrectionSchema } from '../../src/validation/schemas';

async function run(action: () => unknown): Promise<unknown> {
  try {
    return await action();
  } catch (error: unknown) {
    return { success: false, error: toHumanError(error) };
  }
}

export function registerOperationsHandlers(): void {
  // ─── Dashboard ─────────────────────────────────────────────────────────────
  // Multi-dépôts : un filtre optionnel `warehouseId` restreint les KPI de STOCK
  // à un dépôt ; sans filtre → vue CONSOLIDÉE (tous dépôts), comme avant.
  const safeWarehouseFilter = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, 64) : undefined;

  ipcMain.handle('dashboard:getStats', async (_, warehouseId: unknown) =>
    DashboardRepository.getStats(safeWarehouseFilter(warehouseId)));
  ipcMain.handle('dashboard:getTopProducts', async () => DashboardRepository.getTopProducts());
  ipcMain.handle('dashboard:getTopClients', async () => DashboardRepository.getTopClients());
  ipcMain.handle('dashboard:getPaymentsByMethod', async () => DashboardRepository.getPaymentsByMethod());
  ipcMain.handle('dashboard:getLowStock', async (_, warehouseId: unknown) =>
    DashboardRepository.getLowStockAlerts(safeWarehouseFilter(warehouseId)));
  ipcMain.handle('dashboard:getUpcomingDues', async (_, days: unknown) => {
    const d = Math.min(Math.max(Number(days) || 30, 1), 365);
    return DashboardRepository.getUpcomingDues(d);
  });
  ipcMain.handle('dashboard:getRevenue', async (_, period: unknown) => {
    const p = typeof period === 'string' ? period : '';
    return DashboardRepository.getRevenue(p);
  });
  ipcMain.handle('dashboard:getAlertSummary', async (_, warehouseId: unknown) =>
    DashboardRepository.getAlertSummary(safeWarehouseFilter(warehouseId)));

  // §Phase 15 — Rupture / critique / normal / surstock + suggestion de commande.
  ipcMain.handle('stock:getStatus', async (_, warehouseId: unknown) =>
    StockAlertService.getStatus(safeWarehouseFilter(warehouseId)));

  // §Phase 18 — Produits actifs sans aucune vente sur la période analysée.
  ipcMain.handle('dashboard:getDeadProducts', async (_, days: unknown) => {
    const d = Math.min(Math.max(Number(days) || 90, 1), 3650);
    return DashboardRepository.getProductsWithoutSales(d, 15);
  });

  // ─── Purchase Orders ───────────────────────────────────────────────────────
  ipcMain.handle('purchases:getAll', async () => PurchaseOrderRepository.getAll());
  ipcMain.handle('purchases:search', async (_, query: unknown) => {
    return PurchaseOrderRepository.search(typeof query === 'string' ? query.trim().slice(0, 200) : '');
  });
  ipcMain.handle('purchases:getBySupplier', async (_, supplierId: unknown) => {
    return PurchaseOrderRepository.getBySupplier(requireId(supplierId, 'id fournisseur'));
  });
  ipcMain.handle('purchases:getById', async (_, id: unknown) => {
    return PurchaseOrderRepository.getById(requireId(id, 'id commande'));
  });
  ipcMain.handle('purchases:getReceivings', async () => PurchaseOrderRepository.getReceivings());

  ipcMain.handle('purchases:create', async (_, data: unknown) => {
    return run(() => {
      const safe = safeParse(PurchaseSchema, data, 'Création commande');
      const order = PurchaseOrderRepository.create({
        supplier_id: safe.supplier_id,
        expected_date: safe.expected_date ?? undefined,
        notes: safe.notes ?? undefined,
        items: safe.items.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price })),
      });
      AuditService.log('PURCHASE_CREATE', 'purchase', order.id, `Commande ${order.order_number}`);
      return { success: true, data: order };
    });
  });

  ipcMain.handle('purchases:update', async (_, payload: unknown) => {
    return run(() => {
      const p = (payload ?? {}) as { id?: unknown; data?: unknown };
      const safeId = requireId(p.id, 'id commande');
      const safe = safeParse(PurchaseSchema, p.data, 'Modification commande');
      const order = PurchaseOrderRepository.update(safeId, {
        supplier_id: safe.supplier_id,
        expected_date: safe.expected_date ?? undefined,
        notes: safe.notes ?? undefined,
        items: safe.items.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price })),
      });
      AuditService.log('PURCHASE_UPDATE', 'purchase', order.id, `Commande modifiée ${order.order_number}`);
      return { success: true, data: order };
    });
  });

  ipcMain.handle('purchases:confirm', async (_, id: unknown) => {
    return run(() => {
      const safeId = requireId(id, 'id commande');
      const order = PurchaseOrderRepository.confirm(safeId);
      AuditService.log('PURCHASE_CONFIRM', 'purchase', order.id, `Confirmée ${order.order_number}`);
      return { success: true, data: order };
    });
  });

  ipcMain.handle('purchases:receive', async (_, payload: unknown) => {
    return run(() => {
      const safe = safeParse(PurchaseReceiveSchema, payload, 'Réception commande');
      const order = PurchaseOrderRepository.receive(safe.id, safe.receivedItems);
      AuditService.log('PURCHASE_RECEIVE', 'purchase', order.id, `Réceptionnée ${order.order_number}`);
      return { success: true, data: order };
    });
  });

  ipcMain.handle('purchases:cancel', async (_, id: unknown) => {
    return run(() => {
      const safeId = requireId(id, 'id commande');
      const order = PurchaseOrderRepository.cancel(safeId);
      AuditService.log('PURCHASE_CANCEL', 'purchase', order.id, `Annulée ${order.order_number}`);
      return { success: true, data: order };
    });
  });

  ipcMain.handle('purchases:delete', async (_, id: unknown) => {
    return run(() => {
      const safeId = requireId(id, 'id commande');
      PurchaseOrderRepository.remove(safeId);
      AuditService.log('PURCHASE_DELETE', 'purchase', safeId, 'Commande supprimée');
      return { success: true };
    });
  });

  // ─── Inventory Sessions ────────────────────────────────────────────────────
  ipcMain.handle('inventory:getAll', async () => InventorySessionRepository.getAll());
  ipcMain.handle('inventory:getById', async (_, id: unknown) => {
    return InventorySessionRepository.getById(requireId(id, 'id session'));
  });

  ipcMain.handle('inventory:create', async (_, data: unknown) => {
    return run(() => {
      const payload = (data ?? {}) as { name?: unknown; notes?: unknown; warehouse_id?: unknown };
      const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 200) : '';
      if (!name) throw new Error('Le nom de la session est obligatoire.');
      const notes = typeof payload.notes === 'string' ? payload.notes.trim().slice(0, 1000) : undefined;
      // Multi-dépôts : dépôt ciblé par l'inventaire (sinon dépôt actif/par défaut).
      const warehouse_id = typeof payload.warehouse_id === 'string' && payload.warehouse_id.trim()
        ? payload.warehouse_id.trim().slice(0, 64)
        : undefined;
      const session = InventorySessionRepository.create({ name, notes, warehouse_id });
      AuditService.log('INVENTORY_CREATE', 'inventory', session.id, `Session "${session.name}"`);
      return { success: true, data: session };
    });
  });

  ipcMain.handle('inventory:update', async (_, payload: unknown) => {
    return run(() => {
      const p = (payload ?? {}) as { id?: unknown; name?: unknown; notes?: unknown; status?: unknown };
      const safeId = requireId(p.id, 'id session');
      const name = typeof p.name === 'string' ? p.name.trim().slice(0, 200) : '';
      if (!name) throw new Error('Le nom de la session est obligatoire.');
      const notes = typeof p.notes === 'string' ? p.notes.trim().slice(0, 1000) : null;
      // Statut optionnel, restreint à la whitelist du workflow.
      const validStatuses = ['DRAFT', 'COMPTAGE', 'CALCUL', 'VALIDATION'];
      const status = typeof p.status === 'string' && validStatuses.includes(p.status)
        ? (p.status as 'DRAFT' | 'COMPTAGE' | 'CALCUL' | 'VALIDATION')
        : undefined;
      const session = InventorySessionRepository.update(safeId, { name, notes, status });
      AuditService.log('INVENTORY_UPDATE', 'inventory', session.id, `Session modifiée "${session.name}"${status ? ` (statut: ${status})` : ''}`);
      return { success: true, data: session };
    });
  });

  ipcMain.handle('inventory:startCounting', async (_, id: unknown) => {
    return run(() => {
      const session = InventorySessionRepository.startCounting(requireId(id, 'id session'));
      AuditService.log('INVENTORY_COUNT_START', 'inventory', session.id, `Comptage démarré "${session.name}"`);
      return { success: true, data: session };
    });
  });

  ipcMain.handle('inventory:countItem', async (_, { itemId, countedQty }: { itemId: unknown; countedQty: unknown }) => {
    return run(() => {
      const safeId = requireId(itemId, 'id article');
      const qty = Number(countedQty);
      if (!Number.isFinite(qty)) throw new Error('Quantité comptée invalide.');
      InventorySessionRepository.countItem(safeId, qty);
      return { success: true };
    });
  });

  ipcMain.handle('inventory:calculateGaps', async (_, id: unknown) => {
    return run(() => {
      const session = InventorySessionRepository.calculateGaps(requireId(id, 'id session'));
      AuditService.log('INVENTORY_CALCUL', 'inventory', session.id, `Écarts calculés "${session.name}"`);
      return { success: true, data: session };
    });
  });

  ipcMain.handle('inventory:validate', async (_, id: unknown) => {
    return run(() => {
      const session = InventorySessionRepository.validate(requireId(id, 'id session'));
      AuditService.log('INVENTORY_VALIDATE', 'inventory', session.id, `Inventaire validé "${session.name}"`);
      return { success: true, data: session };
    });
  });

  ipcMain.handle('inventory:delete', async (_, id: unknown) => {
    return run(() => {
      const safeId = requireId(id, 'id session');
      InventorySessionRepository.remove(safeId);
      AuditService.log('INVENTORY_DELETE', 'inventory', safeId, 'Session supprimée');
      return { success: true };
    });
  });

  // ─── Inventaire : Versioning (Zod §12) ─────────────────────────────────────
  ipcMain.handle('inventory:createVersion', async (_, data: unknown) => {
    return run(() => {
      const safe = safeParse(InventoryCreateVersionSchema, data, 'Création de version');
      InventorySessionRepository.createVersion(safe.sessionId, safe.note ?? undefined);
      AuditService.log('INVENTORY_VERSION', 'inventory', safe.sessionId, `Version sauvegardée${safe.note ? ` — ${safe.note}` : ''}`);
      return { success: true };
    });
  });

  ipcMain.handle('inventory:getVersions', async (_, data: unknown) => {
    const safe = safeParse(InventoryGetVersionsSchema, data, 'Liste des versions');
    return InventorySessionRepository.getVersions(safe.sessionId);
  });

  ipcMain.handle('inventory:restoreVersion', async (_, data: unknown) => {
    return run(() => {
      const safe = safeParse(InventoryRestoreVersionSchema, data, 'Restauration de version');
      // P0-5 : le repo vérifie que version.session_id === safe.sessionId.
      InventorySessionRepository.restoreVersion(safe.sessionId, safe.versionId, safe.note ?? undefined);
      AuditService.log('INVENTORY_RESTORE', 'inventory', safe.sessionId, `Version ${safe.versionId} restaurée`);
      return { success: true };
    });
  });

  ipcMain.handle('inventory:correctValidatedInventory', async (_, data: unknown) => {
    return run(() => {
      const safe = safeParse(InventoryCorrectionSchema, data, 'Correction inventaire');
      // P0-4 : correction en lot ATOMIQUE (une seule transaction).
      InventorySessionRepository.correctValidatedInventoryBatch(safe.sessionId, safe.corrections);
      AuditService.log('INVENTORY_CORRECT', 'inventory', safe.sessionId, `Correction post-validation : ${Object.keys(safe.corrections).length} article(s)`);
      return { success: true };
    });
  });

  // ─── Recherche globale (§Phase 5, Ctrl+K) ──────────────────────────────────
  // Lecture seule, paginée par groupe : la requête est nettoyée et bornée ici.
  ipcMain.handle('search:global', async (_, query: unknown, perGroup?: unknown) => {
    const q = typeof query === 'string' ? query.slice(0, 100) : '';
    const limit = Math.min(Math.max(Number(perGroup) || 8, 1), 25);
    return GlobalSearchRepository.search(q, limit);
  });

  // ─── Caisse : sessions (§Phase 10) ─────────────────────────────────────────
  const CASH_MOVEMENT_TYPES: readonly CashMovementType[] = [
    'SALE_CASH', 'PAYMENT_IN', 'EXPENSE', 'WITHDRAWAL', 'MANUAL_IN', 'MANUAL_OUT',
  ];
  const CASH_METHODS: readonly CashMethod[] = ['CASH', 'CHECK', 'TRANSFER'];

  const safeMovementType = (value: unknown): CashMovementType =>
    typeof value === 'string' && (CASH_MOVEMENT_TYPES as readonly string[]).includes(value)
      ? (value as CashMovementType)
      : 'MANUAL_IN';

  const safeDirection = (value: unknown): CashDirection => (value === 'OUT' ? 'OUT' : 'IN');

  const safeMethod = (value: unknown): CashMethod =>
    typeof value === 'string' && (CASH_METHODS as readonly string[]).includes(value)
      ? (value as CashMethod)
      : 'CASH';

  const safeAmount = (value: unknown, label: string): number => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} invalide.`);
    return amount;
  };

  ipcMain.handle('cash:getOpenSession', async () => CashSessionRepository.getOpenSession() ?? null);

  ipcMain.handle('cash:open', async (_, payload: unknown) => {
    return run(() => {
      const p = (payload ?? {}) as { openingFloat?: unknown; notes?: unknown; warehouseId?: unknown };
      const notes = typeof p.notes === 'string' ? p.notes.trim().slice(0, 500) : undefined;
      const warehouseId = typeof p.warehouseId === 'string' && p.warehouseId.trim() ? p.warehouseId.trim() : undefined;
      const session = CashSessionRepository.openSession(safeAmount(p.openingFloat ?? 0, 'Fond de caisse'), notes, warehouseId);
      AuditService.log('CASH_OPEN', 'cash_session', session.id, `Caisse ouverte — fond ${session.opening_float} MAD`);
      return { success: true, data: session };
    });
  });

  ipcMain.handle('cash:addMovement', async (_, payload: unknown) => {
    return run(() => {
      const p = (payload ?? {}) as {
        sessionId?: unknown; movementType?: unknown; direction?: unknown;
        amount?: unknown; paymentMethod?: unknown; description?: unknown; referenceId?: unknown;
      };
      const amount = Number(p.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Le montant doit être supérieur à 0.');
      const movement = CashSessionRepository.addMovement({
        sessionId: typeof p.sessionId === 'string' && p.sessionId.trim() ? p.sessionId.trim() : undefined,
        movementType: safeMovementType(p.movementType),
        direction: safeDirection(p.direction),
        amount,
        paymentMethod: safeMethod(p.paymentMethod),
        description: typeof p.description === 'string' ? p.description.trim().slice(0, 500) : undefined,
        referenceId: typeof p.referenceId === 'string' && p.referenceId.trim() ? p.referenceId.trim() : undefined,
      });
      return { success: true, data: movement };
    });
  });

  ipcMain.handle('cash:getSessionDetail', async (_, sessionId: unknown) => {
    return run(() => CashSessionRepository.getSessionDetail(requireId(sessionId, 'id session de caisse')));
  });

  ipcMain.handle('cash:close', async (_, payload: unknown) => {
    return run(() => {
      const p = (payload ?? {}) as { sessionId?: unknown; countedAmount?: unknown; closedBy?: unknown };
      const sessionId = requireId(p.sessionId, 'id session de caisse');
      const counted = Number(p.countedAmount);
      if (!Number.isFinite(counted) || counted < 0) throw new Error('Le solde compté est invalide.');
      const closedBy = typeof p.closedBy === 'string' ? p.closedBy.trim().slice(0, 120) : undefined;
      const session = CashSessionRepository.closeSession(sessionId, counted, closedBy);
      AuditService.log(
        'CASH_CLOSE', 'cash_session', session.id,
        `Caisse fermée — théorique ${session.theoretical_amount} MAD, compté ${session.counted_amount} MAD, écart ${session.difference} MAD`,
      );
      return { success: true, data: session };
    });
  });

  ipcMain.handle('cash:getAll', async (_, limit?: unknown) => {
    const l = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return CashSessionRepository.getAll(l);
  });

  // ─── Dépenses (§Phase 11) ──────────────────────────────────────────────────
  ipcMain.handle('expenses:categories', async () => ExpenseRepository.categories());

  ipcMain.handle('expenses:create', async (_, payload: unknown) => {
    return run(() => {
      const p = (payload ?? {}) as {
        category?: unknown; amount?: unknown; description?: unknown;
        paymentMethod?: unknown; date?: unknown; warehouseId?: unknown;
      };
      const category = typeof p.category === 'string' ? p.category.trim().slice(0, 80) : '';
      const amount = Number(p.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Le montant de la dépense doit être supérieur à 0.');
      const expense = ExpenseRepository.create({
        category,
        amount,
        description: typeof p.description === 'string' ? p.description.trim().slice(0, 500) : undefined,
        paymentMethod: safeMethod(p.paymentMethod),
        date: typeof p.date === 'string' && p.date.trim() ? p.date.trim().slice(0, 20) : undefined,
        warehouseId: typeof p.warehouseId === 'string' && p.warehouseId.trim() ? p.warehouseId.trim() : undefined,
      });
      AuditService.log('EXPENSE_CREATE', 'expense', expense.id, `Dépense ${category} — ${expense.amount} MAD (${expense.payment_method})`);
      return { success: true, data: expense };
    });
  });

  ipcMain.handle('expenses:getAll', async (_, params?: unknown) => {
    const p = (params ?? {}) as { limit?: unknown; offset?: unknown };
    const limit = Math.min(Math.max(Number(p.limit ?? 100) || 100, 1), 500);
    const offset = Math.max(Number(p.offset ?? 0) || 0, 0);
    return ExpenseRepository.getAll(limit, offset);
  });

  ipcMain.handle('expenses:getInRange', async (_, payload: unknown) => {
    return run(() => {
      const p = (payload ?? {}) as { from?: unknown; to?: unknown };
      const from = typeof p.from === 'string' ? p.from.trim().slice(0, 20) : '';
      const to = typeof p.to === 'string' ? p.to.trim().slice(0, 20) : '';
      if (!from || !to) throw new Error('Intervalle de dates incomplet.');
      return ExpenseRepository.getInRange(from, to);
    });
  });

  ipcMain.handle('expenses:getTotals', async (_, payload: unknown) => {
    return run(() => {
      const p = (payload ?? {}) as { from?: unknown; to?: unknown };
      const from = typeof p.from === 'string' ? p.from.trim().slice(0, 20) : '';
      const to = typeof p.to === 'string' ? p.to.trim().slice(0, 20) : '';
      if (!from || !to) throw new Error('Intervalle de dates incomplet.');
      return {
        total: ExpenseRepository.getTotalInRange(from, to),
        byCategory: ExpenseRepository.getTotalsByCategory(from, to),
      };
    });
  });

  ipcMain.handle('expenses:delete', async (_, id: unknown) => {
    return run(() => {
      const safeId = requireId(id, 'id dépense');
      ExpenseRepository.remove(safeId);
      AuditService.log('EXPENSE_DELETE', 'expense', safeId, 'Dépense supprimée');
      return { success: true };
    });
  });

  // ─── Marge brute / Résultat estimé (§Phase 12) ─────────────────────────────
  ipcMain.handle('profit:getSummary', async (_, payload: unknown) => {
    return run(() => {
      const p = (payload ?? {}) as { from?: unknown; to?: unknown };
      const from = typeof p.from === 'string' ? p.from.trim().slice(0, 20) : '';
      const to = typeof p.to === 'string' ? p.to.trim().slice(0, 20) : '';
      return ProfitService.getSummary(from, to);
    });
  });

  // ─── Audit ─────────────────────────────────────────────────────────────────
  ipcMain.handle('audit:getLogs', async (_, limit?: unknown) => {
    const l = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    return AuditService.getLogs(l);
  });

  // ─── Rapports ──────────────────────────────────────────────────────────────
  ipcMain.handle('reports:generate', async (_, month?: unknown) => {
    return run(async () => {
      const safeMonth = typeof month === 'string' ? month.trim().slice(0, 20) : undefined;
      const filePath = await PDFService.generateMonthlyReport(safeMonth);
      shell.openPath(filePath);
      return { success: true, filePath };
    });
  });

  // Export CSV du rapport de gestion — anti-injection de formule CSV §1.4
  // via csvEscape() centralisé (idéntique à ExportService).
  ipcMain.handle('reports:exportCsv', async (_, data: unknown) => {
    return run(async () => {
      // Le payload vient du renderer : on ne lit que des champs connus et on
      // ignore le reste — pas de `any` à la frontière (validé structurellement).
      interface ReportRow { [key: string]: unknown }
      const payload = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
      const stats = (payload['stats'] && typeof payload['stats'] === 'object' && !Array.isArray(payload['stats']) ? payload['stats'] : {}) as ReportRow;
      const rows = (value: unknown): ReportRow[] => Array.isArray(value) ? value as ReportRow[] : [];

      const wb = new ExcelJS.Workbook();
      wb.creator = 'StockLocal';
      wb.created = new Date();
      const ws = wb.addWorksheet('Rapport');

      // Largeurs de colonnes — vrai .xlsx : appliquées par Excel.
      ws.columns = [
        { width: 24 }, // A — Produit / Client / Document
        { width: 18 }, // B — Référence / Factures / Client
        { width: 12 }, // C — Quantité / CA / Échéance
        { width: 14 }, // D — CA / Marge / Reste
        { width: 14 }, // E — Valeur / Jours
        { width: 12 }, // F — Impayés
      ];

      const thinBorder: Partial<ExcelJS.Borders> = {
        top: { style: 'thin', color: { argb: 'FFC4C9D0' } },
        left: { style: 'thin', color: { argb: 'FFC4C9D0' } },
        bottom: { style: 'thin', color: { argb: 'FFC4C9D0' } },
        right: { style: 'thin', color: { argb: 'FFC4C9D0' } },
      };

      const styleRow = (row: ExcelJS.Row, opts: { bold?: boolean; fill?: string; color?: string; center?: boolean } = {}) => {
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = thinBorder;
          cell.alignment = { vertical: 'middle', wrapText: true, ...(opts.center ? { horizontal: 'center' } : {}) };
          const font: Partial<ExcelJS.Font> = { ...(cell.font ?? {}) };
          if (opts.bold) font.bold = true;
          if (opts.color) font.color = { argb: opts.color };
          cell.font = font;
          if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
        });
      };

      const addSection = (title: string, span: number) => {
        const row = ws.addRow([title]);
        ws.mergeCells(row.number, 1, row.number, span);
        styleRow(row, { bold: true, fill: 'FFD9E2F3' });
        return row;
      };
      const addHeader = (cells: string[]) => {
        const row = ws.addRow(cells);
        styleRow(row, { bold: true, fill: 'FFEEF2F7' });
        return row;
      };
      const addData = (vals: unknown[]) => {
        const row = ws.addRow(vals);
        styleRow(row);
        return row;
      };
      const addSpacer = () => {
        const row = ws.addRow([]);
        row.height = 6;
        return row;
      };

      // Titre — sans fond, gras + italique + souligné + centré
      const date = new Date().toISOString().split('T')[0];
      const titleRow = ws.addRow([`Rapport de gestion — ${date}`]);
      ws.mergeCells(titleRow.number, 1, titleRow.number, 6);
      const titleCell = titleRow.getCell(1);
      titleCell.font = { bold: true, italic: true, underline: true };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      titleRow.height = 24;

      addSpacer();
      addSection('INDICATEURS', 6);
      addHeader(['CA Jour', 'CA Semaine', 'CA Mois', 'Marge Mois', 'Valeur Stock', 'Impayés']);
      addData([stats.revenue_today, stats.revenue_week, stats.revenue_month, stats.gross_margin_month, stats.total_stock_value, stats.unpaid_total]);
      addSpacer();
      addSection('TOP PRODUITS', 4);
      addHeader(['Produit', 'Référence', 'Quantité', 'CA']);
      for (const p of rows(payload['topProducts'])) addData([p.designation, p.reference, p.total_qty, p.total_revenue]);
      addSpacer();
      addSection('TOP CLIENTS', 3);
      addHeader(['Client', 'Factures', 'CA']);
      for (const c of rows(payload['topClients'])) addData([c.name, c.invoice_count, c.total_revenue]);
      addSpacer();
      addSection('ALERTES STOCK', 4);
      addHeader(['Produit', 'Référence', 'Stock', 'Min']);
      for (const s of rows(payload['lowStock'])) addData([s.designation, s.reference, s.current_stock, s.min_stock]);
      addSpacer();
      addSection('ECHEANCES', 5);
      addHeader(['Document', 'Client', 'Echéance', 'Reste', 'Jours']);
      for (const d of rows(payload['dues'])) addData([d.document_number, d.customer_name, d.due_date, d.remaining, d.days_left]);

      const exportsDir = DataStorageService.getExportsPath();
      fs.mkdirSync(exportsDir, { recursive: true });
      const filePath = path.join(exportsDir, `rapport_${date}.xlsx`);
      await wb.xlsx.writeFile(filePath);
      shell.openPath(filePath);
      return { success: true, filePath };
    });
  });
}
