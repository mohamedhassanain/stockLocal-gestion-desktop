import { StockLedgerService, type MovementType, type StockMovementRow } from '../services/StockLedgerService';

export type { MovementType } from '../services/StockLedgerService';
export type StockMovement = StockMovementRow;

/**
 * Compatibilité : ancien type 'IN' | 'OUT' | 'INVENTORY' est remplacé par
 * des mouvements physiques IN/OUT + un type métier explicite (movement_type).
 */
export class StockMovementRepository {
  /** Ajoute un mouvement via le StockLedgerService (écriture unique). */
  static create(movement: StockMovement & { movement_type?: MovementType; document_id?: string }): void {
    StockLedgerService.recordMovement({
      product_id: movement.product_id,
      direction: movement.type === 'OUT' ? 'OUT' : 'IN',
      movement_type: movement.movement_type ?? (movement.type === 'OUT' ? 'SALE_OUT' : 'PURCHASE_IN'),
      quantity: movement.quantity,
      unit_price: movement.unit_price,
      date: movement.date,
      reference_doc: movement.reference_doc ?? undefined,
      document_id: movement.document_id ?? undefined,
      supplier_id: movement.supplier_id ?? undefined,


      notes: movement.notes ?? undefined,


    });
  }

  static getHistory(productId: string, limit: number = 50, offset: number = 0): StockMovement[] {
    return StockLedgerService.getHistory(productId, limit, offset);
  }

  static getHistoryWithUser(productId: string, limit: number = 50, offset: number = 0): StockMovement[] {
    return StockLedgerService.getHistory(productId, limit, offset);
  }

  static getStockLevel(productId: string): number {
    return StockLedgerService.getStockLevel(productId);
  }

  /** GetAll movements across all products (for full history/export). */
  static getAllHistory(limit: number = 200, offset: number = 0): Array<StockMovement & { product_ref?: string; product_name?: string }> {
    return StockLedgerService.getAllHistory(limit, offset);
  }
}
