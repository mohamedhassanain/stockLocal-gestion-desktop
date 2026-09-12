import { db } from '../database/config/connection';
import type { StockThresholdRow } from '../domain/stock/StockStatus';

/**
 * §Phase 15 — Lecture des seuils de réapprovisionnement.
 *
 * Accès aux données uniquement : aucune règle de décision ici (elles vivent
 * dans `StockAlertService`). Une seule requête agrégée, jamais de chargement
 * complet de la table produits en mémoire.
 *
 * Le TYPE de ligne vient du domaine (`domain/stock/StockStatus`) : il est
 * ré-exporté ici pour ne pas casser les imports existants.
 */

export type { StockThresholdRow };

const stmtAll = db.prepare(`
  SELECT
    p.id AS product_id,
    p.reference,
    p.designation,
    COALESCE(SUM(ib.quantity), 0) AS current_stock,
    p.min_stock,
    p.max_stock
  FROM products p
  LEFT JOIN inventory_balances ib ON ib.product_id = p.id
  WHERE p.status = 'ACTIVE'
  GROUP BY p.id
  ORDER BY p.designation ASC
`);

const stmtByWarehouse = db.prepare(`
  SELECT
    p.id AS product_id,
    p.reference,
    p.designation,
    COALESCE(SUM(ib.quantity), 0) AS current_stock,
    p.min_stock,
    p.max_stock
  FROM products p
  LEFT JOIN inventory_balances ib ON ib.product_id = p.id AND ib.warehouse_id = ?
  WHERE p.status = 'ACTIVE'
  GROUP BY p.id
  ORDER BY p.designation ASC
`);

export const StockAlertRepository = {
  /**
   * Seuils et stock courant de tous les produits actifs.
   * @param warehouseId Filtre optionnel : sans lui, le stock est CONSOLIDÉ
   *   (somme de tous les dépôts).
   */
  getThresholds(warehouseId?: string): StockThresholdRow[] {
    const rows = (warehouseId
      ? stmtByWarehouse.all(warehouseId)
      : stmtAll.all()) as StockThresholdRow[];

    return rows.map(row => ({
      ...row,
      current_stock: Number(row.current_stock ?? 0),
      min_stock: Number(row.min_stock ?? 0),
      max_stock: Number(row.max_stock ?? 0),
    }));
  },
};
