import { db } from '../database/config/connection';
// §Phase 2.2 — « aujourd'hui » et « ce mois » sont des dates MÉTIER locales.
// `date('now')` / `strftime('%Y-%m','now')` sont en UTC : à UTC+1, les premières
// heures de la journée faisaient tomber le CA du jour à 0 et pouvaient faire
// basculer le mois. On passe désormais la date locale en PARAMÈTRE lié.
import { todayDateOnly, daysBetweenDateOnly } from '../utils/date';

export interface DashboardStats {
  revenue_today: number;
  revenue_week: number;
  revenue_month: number;
  sales_count_today: number;
  sales_count_month: number;
  gross_margin_month: number;
  total_stock_value: number;
  unpaid_total: number;
  supplier_debt_total: number;
}

export interface TopProduct {
  product_id: string;
  designation: string;
  reference: string;
  total_qty: number;
  total_revenue: number;
}

export interface TopClient {
  customer_id: string;
  name: string;
  total_revenue: number;
  invoice_count: number;
}

export interface PaymentMethodTotal {
  payment_method: string;
  total: number;
}

export interface LowStockAlert {
  id: string;
  reference: string;
  designation: string;
  current_stock: number;
  min_stock: number;
}

export interface UpcomingDue {
  id: string;
  document_number: string;
  customer_name: string;
  due_date: string;
  remaining: number;
  days_left: number;
}

export interface RevenuePoint {
  label: string;
  revenue: number;
  margin: number;
  invoice_count: number;
}

export interface AlertSummary {
  low_stock_count: number;
  overdue_count: number;
  unpaid_count: number;
  expiring_soon_count: number;
}

/** §Phase 18 — produit actif sans aucune vente sur la période analysée. */
export interface DeadProduct {
  id: string;
  reference: string;
  designation: string;
  current_stock: number;
}

// ─── Requêtes SQL ultra-optimisées pour le Dashboard ─────────────────────────

const stmtRevenue = db.prepare<[string, string, string, string, string]>(`
  SELECT
    COALESCE(SUM(CASE WHEN date(d.date) = date(?) THEN d.total_incl_tax ELSE 0 END), 0) AS revenue_today,
    COALESCE(SUM(CASE WHEN d.date >= date(?, '-7 days') THEN d.total_incl_tax ELSE 0 END), 0) AS revenue_week,
    COALESCE(SUM(CASE WHEN strftime('%Y-%m', d.date) = ? THEN d.total_incl_tax ELSE 0 END), 0) AS revenue_month,
    COUNT(CASE WHEN date(d.date) = date(?) THEN 1 END) AS sales_count_today,
    COUNT(CASE WHEN strftime('%Y-%m', d.date) = ? THEN 1 END) AS sales_count_month
  FROM documents d
  WHERE d.type = 'INVOICE' AND d.status != 'CANCELLED'
`);

/** Mois courant au format `YYYY-MM`, calendrier LOCAL. */
function currentLocalMonth(): string {
  return todayDateOnly().slice(0, 7);
}

const stmtMargin = db.prepare<[string]>(`
  SELECT COALESCE(SUM((di.unit_price - p.purchase_price) * di.quantity * (1 - di.discount/100.0)), 0) AS gross_margin_month
  FROM document_items di
  JOIN documents d ON d.id = di.document_id
  JOIN products p ON p.id = di.product_id
  WHERE d.type = 'INVOICE'
    AND d.status != 'CANCELLED'
    AND strftime('%Y-%m', d.date) = ?
`);

// §14/§16 : valeur du stock au CMUP (inventory_balances.average_cost), alignée
// sur StockLedgerService.getStockValue(). Une seule requête agrégée.
// Le CMUP est cohérent avec la logique comptable du projet (moyenne pondérée
// des entrées) — le KPI "Valeur du stock" du dashboard renvoie désormais la
// même valeur que le service de valorisation.
const stmtStockValue = db.prepare<[]>(`
  SELECT COALESCE(SUM(ib.quantity * ib.average_cost), 0) AS total_stock_value
  FROM inventory_balances ib
  LEFT JOIN products p ON p.id = ib.product_id
  WHERE p.status = 'ACTIVE' AND ib.quantity > 0
`);

// Multi-dépôts : valeur du stock filtrée sur UN dépôt (filtre optionnel du
// dashboard/rapports ; par défaut, vue CONSOLIDÉE = tous les dépôts).
const stmtStockValueByWarehouse = db.prepare<[string]>(`
  SELECT COALESCE(SUM(ib.quantity * ib.average_cost), 0) AS total_stock_value
  FROM inventory_balances ib
  LEFT JOIN products p ON p.id = ib.product_id
  WHERE p.status = 'ACTIVE' AND ib.quantity > 0 AND ib.warehouse_id = ?
`);

const stmtUnpaid = db.prepare<[]>(`
  SELECT COALESCE(SUM(d.total_incl_tax - COALESCE(
    (SELECT SUM(pay.amount) FROM payments pay WHERE pay.document_id = d.id), 0
  )), 0) AS unpaid_total
  FROM documents d
  WHERE d.type = 'INVOICE' AND d.status IN ('UNPAID', 'PARTIAL')
`);

// §Phase 10 — Total des dettes fournisseurs (SQL agrégé, jamais chargé en mémoire)
const stmtSupplierDebt = db.prepare<[]>(`
  SELECT COALESCE(SUM(CASE WHEN sc.type='DEBT' THEN sc.amount ELSE -sc.amount END), 0) AS supplier_debt_total
  FROM supplier_credits sc
`);

const stmtTopProducts = db.prepare<[string]>(`
  SELECT di.product_id, p.designation, p.reference,
    SUM(di.quantity) AS total_qty,
    SUM(di.total) AS total_revenue
  FROM document_items di
  JOIN documents d ON d.id = di.document_id
  JOIN products p ON p.id = di.product_id
  WHERE d.type = 'INVOICE'
    AND d.status != 'CANCELLED'
    AND strftime('%Y-%m', d.date) = ?
  GROUP BY di.product_id
  ORDER BY total_qty DESC
  LIMIT 5
`);

const stmtTopClients = db.prepare<[string]>(`
  SELECT d.entity_id AS customer_id, c.name,
    SUM(d.total_incl_tax) AS total_revenue,
    COUNT(*) AS invoice_count
  FROM documents d
  JOIN customers c ON c.id = d.entity_id
  WHERE d.type = 'INVOICE'
    AND d.status != 'CANCELLED'
    AND strftime('%Y-%m', d.date) = ?
  GROUP BY d.entity_id
  ORDER BY total_revenue DESC
  LIMIT 5
`);

// Répartition des encaissements du mois courant par mode de paiement — SQL agrégé.
const stmtPaymentsByMethod = db.prepare<[string]>(`
  SELECT py.payment_method,
    COALESCE(SUM(py.amount), 0) AS total
  FROM payments py
  JOIN documents d ON d.id = py.document_id
  WHERE strftime('%Y-%m', py.date) = ?
    AND d.status != 'CANCELLED'
  GROUP BY py.payment_method
  ORDER BY total DESC
`);

const stmtLowStock = db.prepare<[]>(`
  SELECT p.id, p.reference, p.designation, p.min_stock,
    COALESCE(ib.quantity, 0) AS current_stock
  FROM products p
  LEFT JOIN inventory_balances ib ON ib.product_id = p.id
  WHERE p.status = 'ACTIVE' AND COALESCE(ib.quantity, 0) <= p.min_stock
  ORDER BY current_stock ASC
  LIMIT 20
`);

// Alertes de stock bas calculées PAR DÉPÔT : un produit peut être bas dans un
// dépôt et suffisant dans un autre.
const stmtLowStockByWarehouse = db.prepare<[string]>(`
  SELECT p.id, p.reference, p.designation, p.min_stock,
    COALESCE(ib.quantity, 0) AS current_stock
  FROM products p
  LEFT JOIN inventory_balances ib ON ib.product_id = p.id AND ib.warehouse_id = ?
  WHERE p.status = 'ACTIVE' AND COALESCE(ib.quantity, 0) <= p.min_stock
  ORDER BY current_stock ASC
  LIMIT 20
`);

const stmtLowStockCount = db.prepare<[]>(`
  SELECT COUNT(*) AS cnt FROM (
    SELECT p.id FROM products p
    LEFT JOIN inventory_balances ib ON ib.product_id = p.id
    WHERE p.status = 'ACTIVE' AND COALESCE(ib.quantity, 0) <= p.min_stock
  )
`);

const stmtLowStockCountByWarehouse = db.prepare<[string]>(`
  SELECT COUNT(*) AS cnt FROM (
    SELECT p.id FROM products p
    LEFT JOIN inventory_balances ib ON ib.product_id = p.id AND ib.warehouse_id = ?
    WHERE p.status = 'ACTIVE' AND COALESCE(ib.quantity, 0) <= p.min_stock
  )
`);

// §Phase 2 — le SQL ne calcule PLUS `days_left` : `julianday('now')` est en UTC
// et la troncature `CAST(... AS INTEGER)` décalait le compte à rebours d'un jour
// (incohérent avec `evaluateCredit`). On ne filtre ici que sur le CALENDRIER
// (date d'échéance ≤ aujourd'hui local + N jours) ; `days_left` est calculé
// ensuite par le même moteur de dates que le reste de l'application.
const stmtUpcomingDue = db.prepare<[string, string]>(`
  SELECT d.id, d.document_number, c.name AS customer_name, d.due_date,
    (d.total_incl_tax - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.document_id = d.id), 0)) AS remaining
  FROM documents d
  JOIN customers c ON c.id = d.entity_id
  WHERE d.type = 'INVOICE'
    AND d.status IN ('UNPAID', 'PARTIAL')
    AND d.due_date IS NOT NULL
    AND date(d.due_date) <= date(?, ?)
  ORDER BY d.due_date ASC
  LIMIT 10
`);

interface UpcomingDueRow {
  id: string;
  document_number: string;
  customer_name: string;
  due_date: string;
  remaining: number;
}

// ─── Repository ───────────────────────────────────────────────────────────────

interface RevenueRow { revenue_today: number; revenue_week: number; revenue_month: number; sales_count_today: number; sales_count_month: number }
interface MarginRow { gross_margin_month: number }
interface StockValueRow { total_stock_value: number }
interface UnpaidRow { unpaid_total: number }
interface SupplierDebtRow { supplier_debt_total: number }

export const DashboardRepository = {
  /**
   * Indicateurs du tableau de bord.
   * @param warehouseId Filtre optionnel sur UN dépôt. Absent → CONSOLIDÉ
   *   (tous dépôts), comportement identique à avant le multi-dépôts.
   */
  getStats(warehouseId?: string): DashboardStats {
    // §Phase 2.2 — « aujourd'hui »/« ce mois » = calendrier LOCAL, passé en
    // paramètre (plus aucun `date('now')` UTC dans les agrégats).
    const today = todayDateOnly();
    const month = currentLocalMonth();
    const revenue = stmtRevenue.get(today, today, month, today, month) as RevenueRow | undefined;
    const margin = stmtMargin.get(month) as MarginRow | undefined;
    const stockVal = (warehouseId
      ? stmtStockValueByWarehouse.get(warehouseId)
      : stmtStockValue.get()) as StockValueRow | undefined;
    const unpaid = stmtUnpaid.get() as UnpaidRow | undefined;
    const supplierDebt = stmtSupplierDebt.get() as SupplierDebtRow | undefined;

    return {
      revenue_today: revenue?.revenue_today ?? 0,
      revenue_week: revenue?.revenue_week ?? 0,
      revenue_month: revenue?.revenue_month ?? 0,
      sales_count_today: revenue?.sales_count_today ?? 0,
      sales_count_month: revenue?.sales_count_month ?? 0,
      gross_margin_month: margin?.gross_margin_month ?? 0,
      total_stock_value: stockVal?.total_stock_value ?? 0,
      unpaid_total: unpaid?.unpaid_total ?? 0,
      supplier_debt_total: supplierDebt?.supplier_debt_total ?? 0,
    };
  },

  getTopProducts(): TopProduct[] {
    return stmtTopProducts.all(currentLocalMonth()) as TopProduct[];
  },

  /**
   * §Phase 18 — Produits ACTIFS n'ayant fait l'objet d'AUCUNE facture sur les
   * `days` derniers jours. Lecture seule, limitée : sert à repérer le stock qui
   * dort. Les avoirs ne comptent pas comme une vente.
   */
  getProductsWithoutSales(days: number = 90, limit: number = 15): DeadProduct[] {
    // Même règle : seuls NaN retombent sur les valeurs par défaut (jamais 0).
    const requestedDays = Number(days);
    const requestedLimit = Number(limit);
    const safeDays = Number.isFinite(requestedDays) ? Math.max(1, Math.min(3650, Math.trunc(requestedDays))) : 90;
    const safeLimit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.trunc(requestedLimit))) : 15;
    return db.prepare(`
      SELECT p.id, p.reference, p.designation, COALESCE(ib.quantity, 0) AS current_stock
      FROM products p
      LEFT JOIN inventory_balances ib ON ib.product_id = p.id
      WHERE p.status = 'ACTIVE'
        AND p.id NOT IN (
          SELECT DISTINCT di.product_id
          FROM document_items di
          JOIN documents d ON d.id = di.document_id
          WHERE d.type = 'INVOICE' AND d.status != 'CANCELLED'
            AND date(d.date) >= date(?, ?)
        )
      ORDER BY p.designation ASC
      LIMIT ?
    `).all(todayDateOnly(), `-${safeDays} days`, safeLimit) as DeadProduct[];
  },

  getTopClients(): TopClient[] {
    return stmtTopClients.all(currentLocalMonth()) as TopClient[];
  },

  getPaymentsByMethod(): PaymentMethodTotal[] {
    return stmtPaymentsByMethod.all(currentLocalMonth()) as PaymentMethodTotal[];
  },

  /** Alertes de stock bas. @param warehouseId Filtre optionnel (sinon consolidé). */
  getLowStockAlerts(warehouseId?: string): LowStockAlert[] {
    return (warehouseId
      ? stmtLowStockByWarehouse.all(warehouseId)
      : stmtLowStock.all()) as LowStockAlert[];
  },

  getUpcomingDues(daysAhead: number = 30): UpcomingDue[] {
    // ATTENTION : `Number(x) || 30` serait FAUX pour x = 0 (0 est falsy -> 30).
    // « Jusqu'à aujourd'hui » (0 jour) doit rester 0 ; seul NaN retombe sur 30.
    const requestedDays = Number(daysAhead);
    const safeDays = Number.isFinite(requestedDays) ? Math.max(0, Math.min(3650, Math.trunc(requestedDays))) : 30;
    const today = todayDateOnly();
    const rows = stmtUpcomingDue.all(today, `+${safeDays} days`) as UpcomingDueRow[];
    return rows.map(row => ({
      id: row.id,
      document_number: row.document_number,
      customer_name: row.customer_name,
      due_date: row.due_date,
      remaining: Number(row.remaining ?? 0),
      // §Phase 2 — même moteur de dates que `evaluateCredit` (calendrier local).
      days_left: daysBetweenDateOnly(today, row.due_date) ?? 0,
    }));
  },

  getRevenue(period: string = '6months'): RevenuePoint[] {
    const p = ['week', 'month', '3months', '6months', 'year'].includes(period) ? period : '6months';
    const isDaily = p === 'week' || p === 'month';
    const offset = p === 'week' ? '-7 days' : p === 'month' ? '-30 days' : p === '3months' ? '-3 months' : p === 'year' ? '-12 months' : '-6 months';
    const group = isDaily ? "date(d.date)" : "strftime('%Y-%m', d.date)";
    return db.prepare(`
      SELECT ${group} AS label,
        COALESCE(SUM(d.total_incl_tax), 0) AS revenue,
        COALESCE(SUM(
          (SELECT SUM((di.unit_price - p.purchase_price) * di.quantity * (1 - di.discount/100.0))
           FROM document_items di JOIN products p ON p.id = di.product_id
           WHERE di.document_id = d.id)
        ), 0) AS margin,
        COUNT(*) AS invoice_count
      FROM documents d
      WHERE d.type = 'INVOICE' AND d.status != 'CANCELLED'
        AND date(d.date) >= date(?, ?)
      GROUP BY ${group}
      ORDER BY label ASC
    `).all(todayDateOnly(), offset) as RevenuePoint[];
  },

  /** Résumé des alertes. @param warehouseId Filtre optionnel sur le stock bas. */
  getAlertSummary(warehouseId?: string): AlertSummary {
    const lowStock = (warehouseId
      ? stmtLowStockCountByWarehouse.get(warehouseId)
      : stmtLowStockCount.get()) as { cnt: number };

    // §Phase 2 — « en retard » et « échéance dans 7 jours » suivent le CALENDRIER
    // LOCAL (donc `evaluateCredit`), jamais `julianday('now')` qui est en UTC.
    const today = todayDateOnly();

    const overdue = db.prepare(`
      SELECT COUNT(*) AS cnt FROM documents d
      WHERE d.type = 'INVOICE' AND d.status IN ('UNPAID', 'PARTIAL')
        AND d.due_date IS NOT NULL AND date(d.due_date) < date(?)
    `).get(today) as { cnt: number };

    const unpaid = db.prepare(`
      SELECT COUNT(*) AS cnt FROM documents d
      WHERE d.type = 'INVOICE' AND d.status IN ('UNPAID', 'PARTIAL')
    `).get() as { cnt: number };

    const expiringSoon = db.prepare(`
      SELECT COUNT(*) AS cnt FROM documents d
      WHERE d.type = 'INVOICE' AND d.status IN ('UNPAID', 'PARTIAL')
        AND d.due_date IS NOT NULL
        AND date(d.due_date) BETWEEN date(?) AND date(?, '+7 days')
    `).get(today, today) as { cnt: number };

    return {
      low_stock_count: lowStock.cnt,
      overdue_count: overdue.cnt,
      unpaid_count: unpaid.cnt,
      expiring_soon_count: expiringSoon.cnt,
    };
  },

  /**
   * §Phase 12 — Chiffre d'affaires et coût des marchandises sur une période.
   *
   * RÈGLES (documentées, nettes des retours) :
   *   - Les lignes d'AVOIR (`CREDIT_NOTE`) sont INCLUSES et soustraites :
   *     `document_items.total` y est déjà stocké en négatif, et le coût est
   *     pondéré par un facteur −1 → un retour annule bien la vente et sa marge.
   *   - Les documents `CANCELLED` sont exclus (déjà neutralisés par l'avoir).
   *   - `costOfGoods` utilise le prix d'achat ACTUEL du produit (`products.purchase_price`),
   *     faute de coût figé par ligne : c'est une estimation, jamais une écriture comptable.
   */
  getRevenueAndCost(from: string, to: string): {
    revenueInclTax: number;
    revenueExclTax: number;
    costOfGoods: number;
    salesCount: number;
  } {
    const revenue = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN d.type = 'CREDIT_NOTE' THEN -d.total_incl_tax ELSE d.total_incl_tax END), 0) AS revenue_incl_tax,
        COUNT(*) AS sales_count
      FROM documents d
      WHERE d.type IN ('INVOICE', 'DELIVERY_NOTE') AND d.status != 'CANCELLED'
        AND date(d.date) BETWEEN date(?) AND date(?)
    `).get(from, to) as { revenue_incl_tax: number; sales_count: number };

    const exclTax = db.prepare(`
      SELECT COALESCE(SUM(di.total), 0) AS revenue_excl_tax
      FROM document_items di
      JOIN documents d ON d.id = di.document_id
      WHERE d.type IN ('INVOICE', 'DELIVERY_NOTE', 'CREDIT_NOTE') AND d.status != 'CANCELLED'
        AND date(d.date) BETWEEN date(?) AND date(?)
    `).get(from, to) as { revenue_excl_tax: number };

    const cost = db.prepare(`
      SELECT COALESCE(SUM(
        p.purchase_price * di.quantity * (CASE WHEN d.type = 'CREDIT_NOTE' THEN -1 ELSE 1 END)
      ), 0) AS cost_of_goods
      FROM document_items di
      JOIN documents d ON d.id = di.document_id
      JOIN products p ON p.id = di.product_id
      WHERE d.type IN ('INVOICE', 'DELIVERY_NOTE', 'CREDIT_NOTE') AND d.status != 'CANCELLED'
        AND date(d.date) BETWEEN date(?) AND date(?)
    `).get(from, to) as { cost_of_goods: number };

    return {
      revenueInclTax: Number(revenue.revenue_incl_tax ?? 0),
      revenueExclTax: Number(exclTax.revenue_excl_tax ?? 0),
      costOfGoods: Number(cost.cost_of_goods ?? 0),
      salesCount: Number(revenue.sales_count ?? 0),
    };
  },
};
