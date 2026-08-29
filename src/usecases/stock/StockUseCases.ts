/**
 * Use Cases — Stock
 *
 * Règle Clean Architecture : les Use Cases ne dépendent pas de Electron,
 * React, ni de better-sqlite3 directement. Ils utilisent les services et
 * repositories existants comme infrastructure.
 *
 * Ces Use Cases sont des façades légères au-dessus des services existants.
 * L'objectif est de centraliser la logique applicative et de la rendre testable
 * sans dépendances Electron/React.
 */

import { StockService } from '../../services/StockService';
import { StockLedgerService } from '../../services/StockLedgerService';
import { AuditService } from '../../services/AuditService';
import type { StockMovementRow } from '../../services/StockLedgerService';

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface AddStockEntryInput {
  product_id: string;
  quantity: number;
  unit_price?: number;
  reference_doc?: string | null;
  supplier_id?: string | null;
  notes?: string | null;
  document_id?: string | null;
  movement_type?: 'PURCHASE_IN' | 'RETURN_IN' | 'OPENING_BALANCE' | 'TRANSFER_IN' | 'ADJUSTMENT_IN';
}

export interface AddStockExitInput {
  product_id: string;
  quantity: number;
  unit_price?: number;
  exitType: 'VENTE' | 'CASSE' | 'PERTE' | 'RETOUR';
  notes?: string | null;
  document_id?: string | null;
  reference_doc?: string | null;
}

// ─── Use Cases ───────────────────────────────────────────────────────────────

/**
 * UC-S01 : Enregistrer une entrée de stock.
 * Atomique : le mouvement et la balance sont mis à jour dans la même transaction.
 */
export function addStockEntryUseCase(input: AddStockEntryInput): StockMovementRow {
  const movement = StockService.addStockEntry({
    product_id: input.product_id,
    quantity: input.quantity,
    unit_price: input.unit_price ?? 0,
    reference_doc: input.reference_doc ?? undefined,
    supplier_id: input.supplier_id ?? undefined,
    notes: input.notes ?? undefined,
    document_id: input.document_id ?? undefined,
    movement_type: input.movement_type ?? 'PURCHASE_IN',
    date: new Date().toISOString(),
  });
  AuditService.log('STOCK_IN', 'stock', input.product_id, `Entrée de ${input.quantity} (${input.movement_type ?? 'PURCHASE_IN'})`);
  return movement as unknown as StockMovementRow;
}

/**
 * UC-S02 : Enregistrer une sortie de stock typée.
 * Atomique : le mouvement et la balance sont mis à jour dans la même transaction.
 */
export function addStockExitUseCase(input: AddStockExitInput): StockMovementRow {
  const movement = StockService.addStockExit({
    product_id: input.product_id,
    quantity: input.quantity,
    unit_price: input.unit_price ?? 0,
    exitType: input.exitType,
    notes: input.notes ?? undefined,
    document_id: input.document_id ?? undefined,
    reference_doc: input.reference_doc ?? undefined,
    date: new Date().toISOString(),
  });
  AuditService.log('STOCK_OUT', 'stock', input.product_id, `Sortie de ${input.quantity} (${input.exitType})`);
  return movement as unknown as StockMovementRow;
}

/**
 * UC-S03 : Lire le niveau de stock actuel d'un produit (depuis la balance précalculée).
 * Lecture seule — pas de transaction nécessaire.
 */
export function getStockLevelUseCase(productId: string): number {
  return StockLedgerService.getStockLevel(productId);
}

/**
 * UC-S04 : Lire le CMUP (Coût Moyen Pondéré) d'un produit.
 * CMUP = total_in_value / total_in_qty
 */
export function getAverageCostUseCase(productId: string): number {
  return StockLedgerService.getAverageCost(productId);
}

/**
 * UC-S05 : Reconstruire toutes les balances stock à partir de l'historique.
 * À n'exécuter que lors : première installation, migration, restauration,
 * ou réparation manuelle. Ne jamais appeler en routine.
 */
export function rebuildInventoryBalancesUseCase(): { rebuilt: number } {
  StockLedgerService.rebuildBalances();
  AuditService.log('STOCK_REBUILD', 'stock', 'all', 'Reconstruction des balances stock');
  return { rebuilt: 1 };
}
