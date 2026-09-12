/**
 * §Phase 15 — Domaine « statut de stock » : types + règles pures.
 *
 * ⚠️ CE MODULE NE DOIT JAMAIS IMPORTER LA BASE DE DONNÉES, NI `electron`,
 * NI QUOI QUE CE SOIT DE NODE. Il est chargé par le RENDERER (page Alertes
 * stock) : le moindre import de `database/config/connection` tirerait
 * better-sqlite3 dans le bundle navigateur et ferait planter l'évaluation du
 * module à l'import → écran blanc complet de l'application.
 *
 * Même découpage que `src/domain/credit/CreditStatus.ts` : la logique métier
 * pure vit dans `domain/`, l'accès aux données dans `repositories/`, et
 * l'orchestration dans `services/`.
 */

export type StockStatus = 'OUT_OF_STOCK' | 'CRITICAL' | 'NORMAL' | 'OVERSTOCK';

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  OUT_OF_STOCK: 'Rupture',
  CRITICAL: 'Stock critique',
  NORMAL: 'Stock normal',
  OVERSTOCK: 'Surstock',
};

/** Ligne de seuils telle que fournie par la couche données (aucune dépendance). */
export interface StockThresholdRow {
  product_id: string;
  reference: string;
  designation: string;
  current_stock: number;
  min_stock: number;
  max_stock: number;
}

export interface StockStatusItem extends StockThresholdRow {
  status: StockStatus;
  /** Quantité suggérée à commander — indication, jamais une commande créée. */
  suggestedOrder: number;
}

export interface StockStatusSummary {
  items: StockStatusItem[];
  outOfStock: number;
  critical: number;
  normal: number;
  overstock: number;
  /** Produits pour lesquels une commande est suggérée (rupture ou critique). */
  restockSuggestions: StockStatusItem[];
}

/**
 * RÈGLES MÉTIER (source de vérité unique) :
 *
 *   Rupture          current <= 0
 *   Stock critique   current <= min_stock
 *   Surstock         max_stock > 0 ET current > max_stock
 *   Stock normal     sinon
 *
 * Suggestion de commande (JAMAIS un achat automatique — une simple indication) :
 *   - si max_stock > 0 : max_stock − current   (recompléter jusqu'au maximum)
 *   - sinon             : min_stock − current  (remonter au seuil minimum)
 *   - toujours 0 si le stock est normal ou en surstock.
 *
 * Fonction pure → testable seule, sans base de données.
 */
export function classifyStock(row: StockThresholdRow): StockStatusItem {
  const current = Number(row.current_stock ?? 0);
  const min = Number(row.min_stock ?? 0);
  const max = Number(row.max_stock ?? 0);

  let status: StockStatus;
  if (current <= 0) status = 'OUT_OF_STOCK';
  else if (current <= min) status = 'CRITICAL';
  else if (max > 0 && current > max) status = 'OVERSTOCK';
  else status = 'NORMAL';

  let suggestedOrder = 0;
  if (status === 'OUT_OF_STOCK' || status === 'CRITICAL') {
    const target = max > 0 ? max : min;
    suggestedOrder = Math.max(0, Math.ceil(target - current));
  }

  return { ...row, current_stock: current, min_stock: min, max_stock: max, status, suggestedOrder };
}
