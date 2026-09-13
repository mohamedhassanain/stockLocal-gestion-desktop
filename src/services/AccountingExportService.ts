import { db } from '../database/config/connection';
import { DashboardRepository } from '../repositories/DashboardRepository';
// §Solde client/fournisseur — l'export réutilise l'expression de solde UNIQUE
// des repositories : un export comptable ne peut pas diverger des écrans.
import { clientBalanceSql } from '../repositories/ClientRepository';
import { supplierBalanceSql } from '../repositories/SupplierRepository';
import { appendCsvLines, createCsvFile, csvRow, dateRangeClause } from './csvUtils';
import { CompanySettingsService } from './CompanySettingsService';
import { toLocalDateString } from '../utils/date';

/**
 * §Export comptable simplifié.
 *
 * Produit un CSV lisible par un comptable / expert-comptable : chiffre
 * d'affaires (HT / TVA / TTC, nets des avoirs), coût des marchandises vendues
 * et marge, détail de la TVA par taux, dépenses par catégorie, encaissements
 * par mode de règlement, achats (entrées de stock valorisées) et situation des
 * créances / dettes.
 *
 * RÈGLE DE FIDÉLITÉ : aucun montant n'est recalculé ici. Le CA et le coût
 * proviennent de `DashboardRepository.getRevenueAndCost` (la MÊME méthode que
 * le tableau de bord, déjà couverte par les tests) ; les soldes proviennent des
 * expressions SQL partagées des repositories. Un export ne peut donc pas
 * contredire les écrans.
 *
 * LIMITE PUBLIÉE : la TVA sur les ACHATS n'est pas saisie dans l'application
 * (aucune colonne ne la stocke) → elle n'est donc PAS inventée ici. Le détail
 * de TVA fourni porte sur les VENTES. Une ligne explicite le signale.
 */

/** Arrondi monétaire à 2 décimales (jamais de bruit flottant dans un CSV). */
function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** Montant formaté pour le CSV (2 décimales, sans séparateur de milliers). */
function money(value: number): string {
  return round2(value).toFixed(2);
}

const ALL_TIME_START = '0000-01-01';
const ALL_TIME_END = '9999-12-31';

/** Dates de période sûres : bornes ouvertes remplacées par des extrêmes valides. */
function periodBounds(from?: string, to?: string): { from: string; to: string } {
  return { from: from && from.trim() ? from.trim() : ALL_TIME_START, to: to && to.trim() ? to.trim() : ALL_TIME_END };
}

interface VatRateRow { vat_rate: number; ht: number; tva: number }
interface ExpenseRow { category: string; cnt: number; total: number }
interface PaymentRow { payment_method: string; cnt: number; total: number }

export const AccountingExportService = {
  /**
   * Génère le CSV de synthèse comptable sur la période [from, to] (incluses).
   * Sans bornes, l'export couvre tout l'historique.
   */
  exportAccountingSummary(from?: string, to?: string): string {
    const settings = CompanySettingsService.getAll();
    const { from: fromDate, to: toDate } = periodBounds(from, to);
    const today = toLocalDateString();

    const suffixFrom = fromDate === ALL_TIME_START ? 'origine' : fromDate;
    const suffixTo = toDate === ALL_TIME_END ? today : toDate;
    const filePath = createCsvFile(
      `export_comptable_${suffixFrom}_${suffixTo}.csv`,
      [`Export comptable simplifié — ${settings.name || 'StockLocal'}`],
    );

    const lines: string[] = [];
    const add = (...cols: unknown[]): void => { lines.push(csvRow(cols)); };
    const section = (title: string): void => { add(''); add(`--- ${title} ---`); };

    // ─── En-tête ────────────────────────────────────────────────────────────
    add('Période', `du ${suffixFrom}`, `au ${suffixTo}`);
    add('ICE', settings.ice || '', 'RC', settings.rc || '', 'IF', settings.if_ || '');
    add('Généré le', today);

    // ─── Chiffre d'affaires & marge (source UNIQUE : tableau de bord) ────────
    const revenue = DashboardRepository.getRevenueAndCost(fromDate, toDate);
    const vatCollected = round2(revenue.revenueInclTax - revenue.revenueExclTax);
    const grossMargin = round2(revenue.revenueExclTax - revenue.costOfGoods);
    const marginRate = revenue.revenueExclTax > 0
      ? round2((grossMargin / revenue.revenueExclTax) * 100)
      : 0;

    section('CHIFFRE D\'AFFAIRES (net des avoirs, TVA non annulée exclue)');
    add('Ventes nettes HT', money(revenue.revenueExclTax));
    add('TVA collectée', money(vatCollected));
    add('Chiffre d\'affaires TTC', money(revenue.revenueInclTax));
    add('Nombre de ventes', revenue.salesCount);

    section('MARGE (coût au CMUP réel des sorties de stock)');
    add('Coût des marchandises vendues', money(revenue.costOfGoods));
    add('Marge brute', money(grossMargin));
    add('Taux de marge (%)', marginRate.toFixed(2));

    // ─── TVA — détail par taux (VENTES) ─────────────────────────────────────
    section("TVA COLLECTÉE — DÉTAIL PAR TAUX (ventes, net des avoirs)");
    add('Taux (%)', 'Base HT', 'TVA');
    const vatRange = dateRangeClause('d.date', fromDate, toDate);
    const vatRows = db.prepare(`
      SELECT di.vat_rate AS vat_rate,
        COALESCE(SUM(di.total), 0) AS ht,
        COALESCE(SUM(di.total * di.vat_rate / 100.0), 0) AS tva
      FROM document_items di
      JOIN documents d ON d.id = di.document_id
      WHERE d.type IN ('INVOICE', 'DELIVERY_NOTE', 'CREDIT_NOTE') AND d.status != 'CANCELLED'
        ${vatRange.clause}
      GROUP BY di.vat_rate
      ORDER BY di.vat_rate ASC
    `).all(...vatRange.params) as VatRateRow[];
    for (const row of vatRows) {
      add(Number(row.vat_rate).toFixed(2), money(row.ht), money(row.tva));
    }
    add('TOTAL', '', money(vatCollected));
    add("TVA déductible sur achats", "non suivie par l'application (aucune saisie de TVA fournisseur)");

    // ─── Dépenses d'exploitation ───────────────────────────────────────────
    section("DÉPENSES D'EXPLOITATION PAR CATÉGORIE");
    add('Catégorie', 'Nombre', 'Montant');
    const expenseRange = dateRangeClause('date', fromDate, toDate);
    const expenseRows = db.prepare(`
      SELECT category, COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total
      FROM expenses
      WHERE 1 = 1 ${expenseRange.clause}
      GROUP BY category
      ORDER BY total DESC
    `).all(...expenseRange.params) as ExpenseRow[];
    let expensesTotal = 0;
    for (const row of expenseRows) {
      expensesTotal += Number(row.total ?? 0);
      add(row.category, row.cnt, money(row.total));
    }
    add('TOTAL', expenseRows.reduce((sum, r) => sum + Number(r.cnt ?? 0), 0), money(expensesTotal));

    // ─── Encaissements clients ─────────────────────────────────────────────
    section('ENCAISSEMENTS CLIENTS PAR MODE DE RÈGLEMENT');
    add('Mode', 'Nombre', 'Montant');
    const paymentLabels: Record<string, string> = { CASH: 'Espèces', CHECK: 'Chèque', TRANSFER: 'Virement' };
    const paymentRange = dateRangeClause('p.date', fromDate, toDate);
    const paymentRows = db.prepare(`
      SELECT p.payment_method AS payment_method, COUNT(*) AS cnt, COALESCE(SUM(p.amount), 0) AS total
      FROM payments p
      JOIN documents d ON d.id = p.document_id
      WHERE d.status != 'CANCELLED' ${paymentRange.clause}
      GROUP BY p.payment_method
      ORDER BY total DESC
    `).all(...paymentRange.params) as PaymentRow[];
    let paymentsTotal = 0;
    for (const row of paymentRows) {
      paymentsTotal += Number(row.total ?? 0);
      add(paymentLabels[row.payment_method] ?? row.payment_method, row.cnt, money(row.total));
    }
    add('TOTAL', paymentRows.reduce((sum, r) => sum + Number(r.cnt ?? 0), 0), money(paymentsTotal));

    // ─── Achats (entrées de stock valorisées) ──────────────────────────────
    section("ACHATS — ENTRÉES DE STOCK (valorisées au coût d'acquisition)");
    const purchaseRange = dateRangeClause('date', fromDate, toDate);
    const purchases = db.prepare(`
      SELECT COUNT(*) AS cnt,
        COALESCE(SUM(quantity * CASE WHEN unit_cost > 0 THEN unit_cost ELSE unit_price END), 0) AS total
      FROM stock_movements
      WHERE movement_type = 'PURCHASE_IN' ${purchaseRange.clause}
    `).get(...purchaseRange.params) as { cnt: number; total: number };
    add('Nombre d\'entrées', Number(purchases?.cnt ?? 0));
    add('Valeur HT estimée des achats', money(purchases?.total ?? 0));
    add("Note", "coût utilisé : CMUP du mouvement, sinon prix unitaire saisi");

    // ─── Situation des tiers (à la date d'export) ──────────────────────────
    section('SITUATION DES TIERS À LA DATE D\'EXPORT');
    const receivables = db.prepare(
      `SELECT COALESCE(SUM(${clientBalanceSql('c.id')}), 0) AS total FROM customers c`,
    ).get() as { total: number };
    const payables = db.prepare(
      `SELECT COALESCE(SUM(${supplierBalanceSql('s.id')}), 0) AS total FROM suppliers s`,
    ).get() as { total: number };
    add('Créances clients (total)', money(receivables?.total ?? 0));
    add('Dettes fournisseurs (total)', money(payables?.total ?? 0));

    add('');
    add('Document non contractuel — généré automatiquement par StockLocal à partir des données saisies.');

    appendCsvLines(filePath, lines);
    return filePath;
  },
};
