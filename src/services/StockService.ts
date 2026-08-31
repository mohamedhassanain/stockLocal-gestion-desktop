import type { StockMovement } from '../repositories/StockMovementRepository';
import { StockLedgerService } from './StockLedgerService';

/**
 * Type de sortie de stock.
 *
 * Les types « standards » (VENTE, CASSE, PERTE, RETOUR) sont mappés vers des
 * types de mouvement officiels (SALE_OUT, DAMAGE_OUT, LOSS_OUT, RETURN_OUT).
 * Tout autre type (ex : DON, CADEau) est défini par l'utilisateur dans les
 * Paramètres → il est stocké tel quel et reste une sortie (direction OUT).
 */
export type StockExitType = string;

/**
 * Service métier de stock — FAÇADE d'usage courant.
 *
 * TOUTES les écritures passent par le StockLedgerService (moteur central) :
 *   - entrées d'achat      → PURCHASE_IN
 *   - sorties typées       → SALE_OUT / DAMAGE_OUT / LOSS_OUT / RETURN_OUT
 *   - inventaire           → ADJUSTMENT_IN / ADJUSTMENT_OUT (signe directionnel correct)
 */
export class StockService {
  /**
   * Entrée de stock (réception fournisseur, stock initial, retour…).
   */
  static addStockEntry(data: Omit<StockMovement, 'id' | 'type' | 'notes' | 'movement_type'> & {
    reference_doc?: string;
    notes?: string;
    movement_type?: 'PURCHASE_IN' | 'RETURN_IN' | 'OPENING_BALANCE' | 'TRANSFER_IN' | 'ADJUSTMENT_IN';
    document_id?: string;
  }): StockMovement {
    return StockLedgerService.recordMovement({
      product_id: data.product_id,
      direction: 'IN',
      movement_type: data.movement_type ?? 'PURCHASE_IN',
      quantity: data.quantity,
      unit_price: data.unit_price,
      date: data.date ?? undefined,
      reference_doc: data.reference_doc ?? undefined,
      document_id: data.document_id ?? undefined,
      supplier_id: data.supplier_id ?? undefined,
      notes: data.notes ?? (data.reference_doc ? `Réception BL ${data.reference_doc}` : undefined),
    });
  }

  /**
   * Sortie de stock typée (VENTE, CASSE, PERTE, RETOUR).
   */
  static addStockExit(data: Omit<StockMovement, 'id' | 'type' | 'movement_type'> & {
    exitType?: StockExitType;
    reference_doc?: string;
    document_id?: string;
    movement_type?: 'SALE_OUT' | 'DAMAGE_OUT' | 'LOSS_OUT' | 'RETURN_OUT' | 'TRANSFER_OUT' | 'ADJUSTMENT_OUT' | (string & {});
  }): StockMovement {
    const exitType = data.exitType ?? 'VENTE';
    // Types standards → types de mouvement officiels. Type personnalisé → stocké tel quel.
    const EXIT_TO_MOVEMENT: Record<string, string> = {
      VENTE: 'SALE_OUT',
      CASSE: 'DAMAGE_OUT',
      PERTE: 'LOSS_OUT',
      RETOUR: 'RETURN_OUT',
    };
    const movementType = data.movement_type ?? EXIT_TO_MOVEMENT[exitType] ?? exitType;

    return StockLedgerService.recordMovement({
      product_id: data.product_id,
      direction: 'OUT',
      movement_type: movementType,
      quantity: data.quantity,
      unit_price: data.unit_price,
      date: data.date ?? undefined,
      reference_doc: data.reference_doc ?? undefined,
      document_id: data.document_id ?? undefined,
      supplier_id: data.supplier_id ?? undefined,
      notes: data.notes
        ? `SORTIE:${exitType} — ${data.notes}`
        : `SORTIE:${exitType}`,
    });
  }

  /**
   * Ajustement d'inventaire (comptage physique).
   *
   * théorique 100 / compté  90 → ADJUSTMENT_OUT 10 → stock = 90
   * théorique 100 / compté 110 → ADJUSTMENT_IN  10 → stock = 110
   */
  static addInventory(data: Omit<StockMovement, 'id' | 'type' | 'quantity' | 'movement_type'>, actualCount: number): StockMovement | null {


    const movement = StockLedgerService.adjustInventory({
      product_id: data.product_id,
      actualCount,
      unit_price: data.unit_price,
      document_id: data.document_id ?? undefined,
      notes: data.notes ?? undefined,


    });

    // Aucun écart → aucun mouvement créé
    return movement;
  }
}
