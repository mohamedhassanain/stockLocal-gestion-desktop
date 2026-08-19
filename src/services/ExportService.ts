import fs from 'fs';
import path from 'path';
import { DataStorageService } from './DataStorageService';
import { ProductRepository } from '../repositories/ProductRepository';
import { ClientRepository } from '../repositories/ClientRepository';
import { SupplierRepository } from '../repositories/SupplierRepository';
import { DocumentRepository } from '../repositories/DocumentRepository';
import { DashboardRepository } from '../repositories/DashboardRepository';

/**
 * Service d'export CSV pour tous les types de données.
 * Génère des fichiers CSV robusts avec BOM UTF-8 et séparateur point-virgule.
 */

function csvEscape(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cols: unknown[]): string {
  return cols.map(csvEscape).join(';');
}

function writeCsv(filename: string, lines: string[]): string {
  const exportsDir = DataStorageService.getExportsPath();
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
  const filePath = path.join(exportsDir, filename);
  // BOM UTF-8 pour Excel
  fs.writeFileSync(filePath, '\uFEFF' + lines.join('\r\n'), 'utf-8');
  return filePath;
}

export const ExportService = {
  /** Export de tous les produits actifs */
  exportProducts(): string {
    const products = ProductRepository.search('', 100000);
    const lines: string[] = [
      csvRow(['Référence', 'Désignation', 'Description', 'Catégorie', 'Code-barres', 'Unité', 'Prix Achat', 'Prix Vente', 'Prix Gros', 'Stock Min', 'Stock Actuel', 'Statut']),
    ];
    for (const p of products) {
      lines.push(csvRow([
        p.reference, p.designation, p.description ?? '',
        p.category_id ?? '', p.barcode ?? '', p.unit ?? 'PIÈCE',
        p.purchase_price, p.selling_price, p.wholesale_price,
        p.min_stock, p.current_stock ?? 0, p.status
      ]));
    }
    const date = new Date().toISOString().split('T')[0];
    return writeCsv(`produits_${date}.csv`, lines);
  },

  /** Export de tous les clients */
  exportClients(): string {
    const clients = ClientRepository.getAll();
    const lines: string[] = [
      csvRow(['Nom', 'Téléphone', 'Adresse', 'ICE', 'Conditions Paiement', 'Plafond Crédit', 'Solde', 'Catégorie']),
    ];
    for (const c of clients) {
      lines.push(csvRow([
        c.name, c.phone ?? '', c.address ?? '', c.ice ?? '',
        c.payment_conditions ?? '', c.credit_limit, c.balance ?? 0, c.category
      ]));
    }
    const date = new Date().toISOString().split('T')[0];
    return writeCsv(`clients_${date}.csv`, lines);
  },

  /** Export de tous les fournisseurs */
  exportSuppliers(): string {
    const suppliers = SupplierRepository.getAll();
    const lines: string[] = [
      csvRow(['Nom', 'Téléphone', 'Adresse', 'ICE', 'Dette']),
    ];
    for (const s of suppliers) {
      lines.push(csvRow([s.name, s.phone ?? '', s.address ?? '', s.ice ?? '', s.balance ?? 0]));
    }
    const date = new Date().toISOString().split('T')[0];
    return writeCsv(`fournisseurs_${date}.csv`, lines);
  },

  /** Export de l'historique des mouvements de stock pour un produit */
  exportStockMovements(productId?: string): string {
    const lines: string[] = [
      csvRow(['Date', 'Produit', 'Type', 'Quantité', 'Prix Unit.', 'Référence Doc', 'Notes']),
    ];
    // Si productId est fourni, on exporte pour ce produit, sinon on exporte tous les mouvements
    // On utilise une requête SQL directe pour cet export bulk
    const { db } = require('../database/config/connection');
    const rows = productId
      ? db.prepare(`
          SELECT sm.*, p.reference, p.designation
          FROM stock_movements sm
          LEFT JOIN products p ON p.id = sm.product_id
          WHERE sm.product_id = ?
          ORDER BY sm.date DESC
        `).all(productId)
      : db.prepare(`
          SELECT sm.*, p.reference, p.designation
          FROM stock_movements sm
          LEFT JOIN products p ON p.id = sm.product_id
          ORDER BY sm.date DESC
          LIMIT 50000
        `).all();

    for (const r of rows as any[]) {
      lines.push(csvRow([
        r.date, `${r.reference ?? ''} - ${r.designation ?? ''}`,
        r.type, r.quantity, r.unit_price,
        r.reference_doc ?? '', r.notes ?? ''
      ]));
    }
    const date = new Date().toISOString().split('T')[0];
    const suffix = productId ? `_${productId.slice(0, 8)}` : '';
    return writeCsv(`mouvements_stock${suffix}_${date}.csv`, lines);
  },

  /** Export des documents (factures, avoirs, etc.) */
  exportDocuments(type?: string): string {
    const docType = (type || 'INVOICE') as any;
    const documents = DocumentRepository.getAll(docType);
    const lines: string[] = [
      csvRow(['Numéro', 'Client', 'Date', 'Total HT', 'Total TTC', 'Statut', 'Payé', 'Reste Dû']),
    ];
    for (const d of documents) {
      const paid = (d as any).amount_paid ?? 0;
      const remaining = d.total_incl_tax - paid;
      lines.push(csvRow([
        d.document_number, d.customer_name ?? '', d.date,
        d.total_excl_tax, d.total_incl_tax, d.status,
        paid, remaining
      ]));
    }
    const date = new Date().toISOString().split('T')[0];
    const typeLabels: Record<string, string> = { INVOICE: 'factures', DELIVERY_NOTE: 'bons_livraison', QUOTE: 'devis', CREDIT_NOTE: 'avoirs' };
    return writeCsv(`${typeLabels[docType] ?? 'documents'}_${date}.csv`, lines);
  },

  /** Export complet du dashboard */
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
