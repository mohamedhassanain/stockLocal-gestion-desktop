import fs from 'fs';
import path from 'path';
import { DataStorageService } from './DataStorageService';
import { DashboardRepository } from '../repositories/DashboardRepository';
import { db } from '../database/config/connection';

/**
 * Service d'export CSV pour tous les types de données.
 * Génère des fichiers CSV robustes avec BOM UTF-8 et séparateur point-virgule.
 *
 * Phase 4 — exports volumineux par batch SQL (jamais tout en mémoire) :
 * les exports "complets" (produits, mouvements de stock) itèrent par lots
 * de 10 000 lignes côté SQLite et écrivent progressivement dans le fichier.
 * Aucun plafond silencieux n'est appliqué : le fichier contient TOUTES les
 * données. La protection anti-injection de formule CSV est conservée.
 */

// ─── Helpers CSV ─────────────────────────────────────────────────────────────

function csvEscape(val: unknown): string {
  let s = String(val ?? '');
  // Anti-injection de formule CSV (§1.4) : une valeur (nom client, fournisseur,
  // produit…) commençant par =, +, - ou @ est préfixée d'une apostrophe pour
  // empêcher Excel/LibreOffice de l'interpréter comme une formule.
  if (/^[=+\-@]/.test(s)) {
    s = `'${s}`;
  }
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cols: unknown[]): string {
  return cols.map(csvEscape).join(';');
}

/** Crée le fichier CSV avec BOM UTF-8 et le header, retourne le chemin. */
function createCsvFile(filename: string, header: unknown[]): string {
  const exportsDir = DataStorageService.getExportsPath();
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
  const filePath = path.join(exportsDir, filename);
  // BOM UTF-8 pour Excel + première ligne (header)
  fs.writeFileSync(filePath, '\uFEFF' + csvRow(header) + '\r\n', 'utf-8');
  return filePath;
}

/** Ajoute des lignes CSV à la fin du fichier (append, batch par batch). */
function appendCsvLines(filePath: string, lines: string[]): void {
  if (lines.length === 0) return;
  fs.appendFileSync(filePath, lines.join('\r\n') + '\r\n', 'utf-8');
}

/** Export mono-lot (petits volumes) — conserve le comportement historique. */
function writeCsv(filename: string, lines: string[]): string {
  const exportsDir = DataStorageService.getExportsPath();
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
  const filePath = path.join(exportsDir, filename);
  fs.writeFileSync(filePath, '\uFEFF' + lines.join('\r\n'), 'utf-8');
  return filePath;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const ExportService = {
  /** Export de TOUS les produits (par batch SQL — jamais tout en mémoire). */
  exportProducts(): string {
    const filePath = createCsvFile(
      `produits_${new Date().toISOString().split('T')[0]}.csv`,
      ['Référence', 'Désignation', 'Description', 'Catégorie', 'Code-barres', 'Unité', 'Prix Achat', 'Prix Vente', 'Prix Gros', 'Stock Min', 'Stock Actuel', 'Statut']
    );
    const BATCH = 10000;
    let offset = 0;
    while (true) {
      const rows = db.prepare(`
        SELECT p.*, COALESCE(ib.quantity, 0) AS current_stock
        FROM products p
        LEFT JOIN inventory_balances ib ON ib.product_id = p.id
        ORDER BY p.reference ASC
        LIMIT ? OFFSET ?
      `).all(BATCH, offset) as Array<Record<string, unknown>>;
      if (rows.length === 0) break;
      appendCsvLines(filePath, rows.map((p) => csvRow([
        p.reference, p.designation, p.description ?? '',
        p.category_id ?? '', p.barcode ?? '', p.unit ?? 'PIÈCE',
        p.purchase_price, p.selling_price, p.wholesale_price,
        p.min_stock, p.current_stock ?? 0, p.status
      ])));
      offset += rows.length;
    }
    return filePath;
  },

  /** Export de tous les clients (volume limité par la recherche paginée — gros volumes en batch SQL aussi). */
  exportClients(): string {
    const filePath = createCsvFile(
      `clients_${new Date().toISOString().split('T')[0]}.csv`,
      ['Nom', 'Téléphone', 'Adresse', 'ICE', 'Conditions Paiement', 'Plafond Crédit', 'Solde', 'Catégorie']
    );
    const BATCH = 10000;
    let offset = 0;
    while (true) {
      const rows = db.prepare(`
        SELECT c.*,
          COALESCE(
            (SELECT SUM(CASE WHEN cc.type='CREDIT' THEN cc.amount ELSE -cc.amount END)
             FROM client_credits cc WHERE cc.customer_id = c.id),
          0) AS balance
        FROM customers c
        ORDER BY c.name ASC
        LIMIT ? OFFSET ?
      `).all(BATCH, offset) as Array<Record<string, unknown>>;
      if (rows.length === 0) break;
      appendCsvLines(filePath, rows.map((c) => csvRow([
        c.name, c.phone ?? '', c.address ?? '', c.ice ?? '',
        c.payment_conditions ?? '', c.credit_limit, c.balance ?? 0, c.category
      ])));
      offset += rows.length;
    }
    return filePath;
  },

  /** Export de tous les fournisseurs (batch SQL). */
  exportSuppliers(): string {
    const filePath = createCsvFile(
      `fournisseurs_${new Date().toISOString().split('T')[0]}.csv`,
      ['Nom', 'Téléphone', 'Adresse', 'ICE', 'Dette']
    );
    const BATCH = 10000;
    let offset = 0;
    while (true) {
      const rows = db.prepare(`
        SELECT s.*,
          COALESCE(
            (SELECT SUM(CASE WHEN sc.type='DEBT' THEN sc.amount ELSE -sc.amount END)
             FROM supplier_credits sc WHERE sc.supplier_id = s.id),
          0) AS balance
        FROM suppliers s
        ORDER BY s.name ASC
        LIMIT ? OFFSET ?
      `).all(BATCH, offset) as Array<Record<string, unknown>>;
      if (rows.length === 0) break;
      appendCsvLines(filePath, rows.map((s) => csvRow([
        s.name, s.phone ?? '', s.address ?? '', s.ice ?? '', s.balance ?? 0
      ])));
      offset += rows.length;
    }
    return filePath;
  },

  /**
   * Export de l'historique des mouvements de stock.
   * - Si productId est fourni : export complet de CE produit.
   * - Sinon : export complet de TOUS les mouvements, par batch (plus de
   *   limite silencieuse de 50 000 lignes).
   */
  exportStockMovements(productId?: string): string {
    const date = new Date().toISOString().split('T')[0];
    const suffix = productId ? `_${productId.slice(0, 8)}` : '';
    const filePath = createCsvFile(
      `mouvements_stock${suffix}_${date}.csv`,
      ['Date', 'Produit', 'Type', 'Quantité', 'Prix Unit.', 'Référence Doc', 'Notes']
    );

    const baseSql = `
      SELECT sm.*, p.reference, p.designation
      FROM stock_movements sm
      LEFT JOIN products p ON p.id = sm.product_id
      ${productId ? 'WHERE sm.product_id = ?' : ''}
      ORDER BY sm.date DESC
      LIMIT ? OFFSET ?
    `;

    const BATCH = 10000;
    let offset = 0;
    while (true) {
      const rows = (productId
        ? db.prepare(baseSql).all(productId, BATCH, offset)
        : db.prepare(baseSql).all(BATCH, offset)) as Array<Record<string, unknown>>;
      if (rows.length === 0) break;
      appendCsvLines(filePath, rows.map((r) => csvRow([
        r.date, `${r.reference ?? ''} - ${r.designation ?? ''}`,
        r.type, r.quantity, r.unit_price,
        r.reference_doc ?? '', r.notes ?? ''
      ])));
      offset += rows.length;
    }
    return filePath;
  },

  /** Export des documents (factures, avoirs, etc.) — par batch SQL. */
  exportDocuments(type?: string): string {
    const docType: string = type || 'INVOICE';
    const date = new Date().toISOString().split('T')[0];
    const typeLabels: Record<string, string> = { INVOICE: 'factures', DELIVERY_NOTE: 'bons_livraison', QUOTE: 'devis', CREDIT_NOTE: 'avoirs' };
    const filePath = createCsvFile(
      `${typeLabels[docType] ?? 'documents'}_${date}.csv`,
      ['Numéro', 'Client', 'Date', 'Total HT', 'Total TTC', 'Statut', 'Payé', 'Reste Dû']
    );
    const BATCH = 10000;
    let offset = 0;
    while (true) {
      const rows = db.prepare(`
        SELECT d.*, c.name AS customer_name,
          COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.document_id = d.id), 0) AS amount_paid
        FROM documents d
        LEFT JOIN customers c ON c.id = d.entity_id
        WHERE d.type = ?
        ORDER BY d.date DESC
        LIMIT ? OFFSET ?
      `).all(docType, BATCH, offset) as Array<Record<string, unknown>>;
      if (rows.length === 0) break;
      appendCsvLines(filePath, rows.map((d) => {
        const paid = Number(d.amount_paid ?? 0);
        const remaining = Number(d.total_incl_tax ?? 0) - paid;
        return csvRow([
          d.document_number, d.customer_name ?? '', d.date,
          d.total_excl_tax, d.total_incl_tax, d.status,
          paid, remaining
        ]);
      }));
      offset += rows.length;
    }
    return filePath;
  },

  /** Export du rapport de gestion (données agrégées — petits volumes). */
  exportDashboard(): string {
    const stats = DashboardRepository.getStats();
    const topProducts = DashboardRepository.getTopProducts();
    const topClients = DashboardRepository.getTopClients();
    const lowStock = DashboardRepository.getLowStockAlerts();

    const lines: string[] = [
      csvRow(['RAPPORT DE GESTION', new Date().toISOString().split('T')[0]]),
      '',
      csvRow(['INDICATEURS']),
      csvRow(['CA Jour', 'CA Semaine', 'CA Mois', 'Marge Mois', 'Valeur Stock', 'Impayés']),
      csvRow([stats.revenue_today, stats.revenue_week, stats.revenue_month, stats.gross_margin_month, stats.total_stock_value, stats.unpaid_total]),
      '',
      csvRow(['TOP PRODUITS']),
      csvRow(['Produit', 'Référence', 'Quantité', 'CA']),
      ...topProducts.map(p => csvRow([p.designation, p.reference, p.total_qty, p.total_revenue])),
      '',
      csvRow(['TOP CLIENTS']),
      csvRow(['Client', 'Factures', 'CA']),
      ...topClients.map(c => csvRow([c.name, c.invoice_count, c.total_revenue])),
      '',
      csvRow(['ALERTES STOCK']),
      csvRow(['Produit', 'Référence', 'Stock', 'Min']),
      ...lowStock.map(s => csvRow([s.designation, s.reference, s.current_stock, s.min_stock])),
    ];
    const date = new Date().toISOString().split('T')[0];
    return writeCsv(`rapport_${date}.csv`, lines);
  }
};
