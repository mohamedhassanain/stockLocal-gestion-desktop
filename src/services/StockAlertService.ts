import {
  classifyStock,
  STOCK_STATUS_LABELS,
  type StockStatus,
  type StockStatusItem,
  type StockStatusSummary,
  type StockThresholdRow,
} from '../domain/stock/StockStatus';
import { StockAlertRepository } from '../repositories/StockAlertRepository';

/**
 * §Phase 15 — Alertes de stock intelligentes + suggestion de commande.
 *
 * Ce service ne fait plus QUE l'orchestration (lecture des données + agrégats).
 * La RÈGLE MÉTIER (classification Rupture / Critique / Normal / Surstock et
 * suggestion de commande) vit dans `domain/stock/StockStatus` — un module PUR,
 * sans aucune dépendance base de données / Node.
 *
 * ⚠️ POURQUOI CE DÉCOUPAGE EST CRITIQUE : la page `StockAlertsPage` (renderer)
 * a besoin des libellés `STOCK_STATUS_LABELS`. Les importer depuis CE fichier
 * tirait `StockAlertRepository` → `database/config/connection` → better-sqlite3
 * dans le bundle du navigateur. L'évaluation de ce module échouait alors à
 * l'import et, comme `main.tsx` importe toute l'arborescence des pages, TOUTE
 * l'application restait sur une fenêtre entièrement blanche.
 *
 * Les symboles de domaine sont ré-exportés ici pour ne pas casser les imports
 * existants (tests, IPC).
 */

export { classifyStock, STOCK_STATUS_LABELS };
export type { StockStatus, StockStatusItem, StockStatusSummary, StockThresholdRow };

export const StockAlertService = {
  /**
   * Classement complet du stock + suggestions de réapprovisionnement.
   * @param warehouseId Filtre optionnel (sinon vue consolidée tous dépôts).
   */
  getStatus(warehouseId?: string): StockStatusSummary {
    const items = StockAlertRepository.getThresholds(warehouseId).map(classifyStock);

    return {
      items,
      outOfStock: items.filter(i => i.status === 'OUT_OF_STOCK').length,
      critical: items.filter(i => i.status === 'CRITICAL').length,
      normal: items.filter(i => i.status === 'NORMAL').length,
      overstock: items.filter(i => i.status === 'OVERSTOCK').length,
      restockSuggestions: items
        .filter(i => i.suggestedOrder > 0)
        .sort((a, b) => b.suggestedOrder - a.suggestedOrder),
    };
  },
};
