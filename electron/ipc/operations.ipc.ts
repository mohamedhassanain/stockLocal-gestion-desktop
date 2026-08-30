import { ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { requireId, toHumanError } from '../ipcValidation';
import { DashboardRepository } from '../../src/repositories/DashboardRepository';
import { PurchaseOrderRepository } from '../../src/repositories/PurchaseOrderRepository';
import { InventorySessionRepository } from '../../src/repositories/InventorySessionRepository';
import { AuditService } from '../../src/services/AuditService';
import { PDFService } from '../../src/services/PDFService';
import { DataStorageService } from '../../src/services/DataStorageService';
import { safeParse, PurchaseSchema, PurchaseReceiveSchema } from '../../src/validation/schemas';

async function run(action: () => unknown): Promise<unknown> {
  try {
    return await action();
  } catch (error: unknown) {
    return { success: false, error: toHumanError(error) };
  }
}

export function registerOperationsHandlers(): void {
  // ─── Dashboard ─────────────────────────────────────────────────────────────
  ipcMain.handle('dashboard:getStats', async () => DashboardRepository.getStats());
  ipcMain.handle('dashboard:getTopProducts', async () => DashboardRepository.getTopProducts());
  ipcMain.handle('dashboard:getTopClients', async () => DashboardRepository.getTopClients());
  ipcMain.handle('dashboard:getLowStock', async () => DashboardRepository.getLowStockAlerts());
  ipcMain.handle('dashboard:getUpcomingDues', async (_, days: unknown) => {
    const d = Math.min(Math.max(Number(days) || 30, 1), 365);
    return DashboardRepository.getUpcomingDues(d);
  });
  ipcMain.handle('dashboard:getRevenue', async (_, period: unknown) => {
    const p = typeof period === 'string' ? period : '';
    return DashboardRepository.getRevenue(p);
  });
  ipcMain.handle('dashboard:getAlertSummary', async () => DashboardRepository.getAlertSummary());

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
      const payload = (data ?? {}) as { name?: unknown; notes?: unknown };
      const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 200) : '';
      if (!name) throw new Error('Le nom de la session est obligatoire.');
      const notes = typeof payload.notes === 'string' ? payload.notes.trim().slice(0, 1000) : undefined;
      const session = InventorySessionRepository.create({ name, notes });
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

  // ─── Inventaire : Versioning ───────────────────────────────────────────────
  ipcMain.handle('inventory:createVersion', async (_, { sessionId, note }: { sessionId: unknown; note: unknown }) => {
    return run(() => {
      const safeId = requireId(sessionId, 'id session');
      const safeNote = typeof note === 'string' ? note.trim().slice(0, 500) : undefined;
      InventorySessionRepository.createVersion(safeId, safeNote);
      AuditService.log('INVENTORY_VERSION', 'inventory', safeId, `Version sauvegardée${safeNote ? ` — ${safeNote}` : ''}`);
      return { success: true };
    });
  });

  ipcMain.handle('inventory:getVersions', async (_, sessionId: unknown) => {
    return InventorySessionRepository.getVersions(requireId(sessionId, 'id session'));
  });

  ipcMain.handle('inventory:restoreVersion', async (_, { sessionId, versionId, note }: { sessionId: unknown; versionId: unknown; note: unknown }) => {
    return run(() => {
      const safeSessionId = requireId(sessionId, 'id session');
      const safeVersionId = requireId(versionId, 'id version');
      const safeNote = typeof note === 'string' ? note.trim().slice(0, 500) : undefined;
      InventorySessionRepository.restoreVersion(safeVersionId, safeNote);
      AuditService.log('INVENTORY_RESTORE', 'inventory', safeSessionId, `Version ${safeVersionId} restaurée`);
      return { success: true };
    });
  });

  ipcMain.handle('inventory:correctValidatedInventory', async (_, { sessionId, corrections }: { sessionId: unknown; corrections: unknown }) => {
    return run(() => {
      const safeSessionId = requireId(sessionId, 'id session');
      if (!corrections || typeof corrections !== 'object' || Array.isArray(corrections)) {
        throw new Error('Corrections invalides : objet { itemId → quantité } attendu.');
      }
      const safeCorrections: Record<string, number> = {};
      for (const [itemId, qty] of Object.entries(corrections as Record<string, unknown>)) {
        const numQty = Number(qty);
        if (!itemId || !Number.isFinite(numQty) || numQty < 0) {
          throw new Error(`Quantité corrigée invalide pour l'article ${itemId}.`);
        }
        safeCorrections[itemId.slice(0, 64)] = numQty;
      }
      if (Object.keys(safeCorrections).length === 0) throw new Error('Aucune correction fournie.');
      for (const [itemId, qty] of Object.entries(safeCorrections)) {
        InventorySessionRepository.correctValidatedInventory(safeSessionId, itemId, qty);
      }
      AuditService.log('INVENTORY_CORRECT', 'inventory', safeSessionId, `Correction post-validation : ${Object.keys(safeCorrections).length} article(s)`);
      return { success: true };
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
