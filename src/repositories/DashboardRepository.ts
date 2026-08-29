import { db } from '../database/config/connection';

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

export interface MonthlyRevenue {
  month: string;
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

// ─── Requêtes SQL ultra-optimisées pour le Dashboard ─────────────────────────

const stmtRevenue = db.prepare<[]>(`
  SELECT
    COALESCE(SUM(CASE WHEN date(d.date) = date('now') THEN d.total_incl_tax ELSE 0 END), 0) AS revenue_today,
    COALESCE(SUM(CASE WHEN d.date >= date('now', '-7 days') THEN d.total_incl_tax ELSE 0 END), 0) AS revenue_week,
    COALESCE(SUM(CASE WHEN strftime('%Y-%m', d.date) = strftime('%Y-%m', 'now') THEN d.total_incl_tax ELSE 0 END), 0) AS revenue_month,
    COUNT(CASE WHEN date(d.date) = date('now') THEN 1 END) AS sales_count_today,
    COUNT(CASE WHEN strftime('%Y-%m', d.date) = strftime('%Y-%m', 'now') THEN 1 END) AS sales_count_month
  FROM documents d
  WHERE d.type = 'INVOICE' AND d.status != 'CANCELLED'
`);

const stmtMargin = db.prepare<[]>(`
  SELECT COALESCE(SUM((di.unit_price - p.purchase_price) * di.quantity * (1 - di.discount/100.0)), 0) AS gross_margin_month
  FROM document_items di
  JOIN documents d ON d.id = di.document_id
  JOIN products p ON p.id = di.product_id
  WHERE d.type = 'INVOICE'
    AND d.status != 'CANCELLED'
    AND strftime('%Y-%m', d.date) = strftime('%Y-%m', 'now')
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

const stmtTopProducts = db.prepare<[]>(`
  SELECT di.product_id, p.designation, p.reference,
    SUM(di.quantity) AS total_qty,
    SUM(di.total) AS total_revenue
  FROM document_items di
  JOIN documents d ON d.id = di.document_id
  JOIN products p ON p.id = di.product_id
  WHERE d.type = 'INVOICE'
    AND d.status != 'CANCELLED'
    AND strftime('%Y-%m', d.date) = strftime('%Y-%m', 'now')
  GROUP BY di.product_id
  ORDER BY total_qty DESC
  LIMIT 5
`);

const stmtTopClients = db.prepare<[]>(`
  SELECT d.entity_id AS customer_id, c.name,
    SUM(d.total_incl_tax) AS total_revenue,
    COUNT(*) AS invoice_count
  FROM documents d
  JOIN customers c ON c.id = d.entity_id
  WHERE d.type = 'INVOICE'
    AND d.status != 'CANCELLED'
    AND strftime('%Y-%m', d.date) = strftime('%Y-%m', 'now')
  GROUP BY d.entity_id
  ORDER BY total_revenue DESC
  LIMIT 5
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

const stmtUpcomingDue = db.prepare<[number]>(`
  SELECT d.id, d.document_number, c.name AS customer_name, d.due_date,
    (d.total_incl_tax - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.document_id = d.id), 0)) AS remaining,
    CAST(julianday(d.due_date) - julianday('now') AS INTEGER) AS days_left
  FROM documents d
  JOIN customers c ON c.id = d.entity_id
  WHERE d.type = 'INVOICE'
    AND d.status IN ('UNPAID', 'PARTIAL')
    AND d.due_date IS NOT NULL
    AND julianday(d.due_date) - julianday('now') <= ?
  ORDER BY d.due_date ASC
  LIMIT 10
`);

// ─── Repository ───────────────────────────────────────────────────────────────

interface RevenueRow { revenue_today: number; revenue_week: number; revenue_month: number; sales_count_today: number; sales_count_month: number }
interface MarginRow { gross_margin_month: number }
interface StockValueRow { total_stock_value: number }
interface UnpaidRow { unpaid_total: number }
interface SupplierDebtRow { supplier_debt_total: number }

export const DashboardRepository = {
  getStats(): DashboardStats {
    const revenue = stmtRevenue.get() as RevenueRow | undefined;
    const margin = stmtMargin.get() as MarginRow | undefined;
    const stockVal = stmtStockValue.get() as StockValueRow | undefined;
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
    return stmtTopProducts.all() as TopProduct[];
  },

  getTopClients(): TopClient[] {
    return stmtTopClients.all() as TopClient[];
  },

  getLowStockAlerts(): LowStockAlert[] {
    return stmtLowStock.all() as LowStockAlert[];
  },

  getUpcomingDues(daysAhead: number = 30): UpcomingDue[] {
    return stmtUpcomingDue.all(daysAhead) as UpcomingDue[];
  },

  getMonthlyRevenue(months: number = 6): MonthlyRevenue[] {
    return db.prepare(`
      SELECT 
        strftime('%Y-%m', d.date) AS month,
        COALESCE(SUM(d.total_incl_tax), 0) AS revenue,
        COALESCE(SUM(
          (SELECT SUM((di.unit_price - p.purchase_price) * di.quantity * (1 - di.discount/100.0))
           FROM document_items di JOIN products p ON p.id = di.product_id
           WHERE di.document_id = d.id)
        ), 0) AS margin,
        COUNT(*) AS invoice_count
      FROM documents d
      WHERE d.type = 'INVOICE' AND d.status != 'CANCELLED'
        AND d.date >= date('now', '-' || ? || ' months')
      GROUP BY strftime('%Y-%m', d.date)
      ORDER BY month ASC
    `).all(months) as MonthlyRevenue[];
  },

  getAlertSummary(): AlertSummary {
    const lowStock = db.prepare(`
      SELECT COUNT(*) AS cnt FROM (
        SELECT p.id FROM products p
        LEFT JOIN inventory_balances ib ON ib.product_id = p.id
        WHERE p.status = 'ACTIVE' AND COALESCE(ib.quantity, 0) <= p.min_stock
      )
    `).get() as { cnt: number };

    const overdue = db.prepare(`
      SELECT COUNT(*) AS cnt FROM documents d
      WHERE d.type = 'INVOICE' AND d.status IN ('UNPAID', 'PARTIAL')
        AND d.due_date IS NOT NULL AND julianday(d.due_date) < julianday('now')
    `).get() as { cnt: number };

    const unpaid = db.prepare(`
      SELECT COUNT(*) AS cnt FROM documents d
      WHERE d.type = 'INVOICE' AND d.status IN ('UNPAID', 'PARTIAL')
    `).get() as { cnt: number };

    const expiringSoon = db.prepare(`
      SELECT COUNT(*) AS cnt FROM documents d
      WHERE d.type = 'INVOICE' AND d.status IN ('UNPAID', 'PARTIAL')
        AND d.due_date IS NOT NULL
        AND julianday(d.due_date) - julianday('now') BETWEEN 0 AND 7
    `).get() as { cnt: number };

    return {
      low_stock_count: lowStock.cnt,
      overdue_count: overdue.cnt,
      unpaid_count: unpaid.cnt,
      expiring_soon_count: expiringSoon.cnt,
    };
  }
};
