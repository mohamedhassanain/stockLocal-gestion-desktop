import { StockMovement, StockMovementRepository } from '../repositories/StockMovementRepository';
import { runInTransaction } from '../database/config/connection';
import { randomUUID } from 'crypto';

export class StockService {
  /**
   * Ajoute une entrée de stock (réception fournisseur) avec référence BL optionnelle.
   */
  static addStockEntry(data: Omit<StockMovement, 'id' | 'type' | 'notes'> & { reference_doc?: string; notes?: string }): StockMovement {
    return runInTransaction(() => {
      const movement: StockMovement = {
        ...data,
        id: randomUUID(),
        type: 'IN',
        date: new Date().toISOString(),
        reference_doc: data.reference_doc || undefined,
        notes: data.notes || (data.reference_doc ? `Réception BL ${data.reference_doc}` : undefined)
      };

      StockMovementRepository.create(movement);
      return movement;
    });
  }

  /**
   * Enregistre une sortie de stock typée (VENTE, CASSE, PERTE, RETOUR).
   * Le type est encodé dans notes : "SORTIE:TYPE — description".
   */
  static addStockExit(data: Omit<StockMovement, 'id' | 'type'> & { exitType?: 'VENTE' | 'CASSE' | 'PERTE' | 'RETOUR'; reference_doc?: string }): StockMovement {
    return runInTransaction(() => {
      const currentStock = StockMovementRepository.getStockLevel(data.product_id);
      if (currentStock < data.quantity) {
        throw new Error(`Stock insuffisant. Stock actuel : ${currentStock}`);
      }

      const exitType = data.exitType ?? 'VENTE';
      const movement: StockMovement = {
        ...data,
        id: randomUUID(),
        type: 'OUT',
        date: new Date().toISOString(),
        notes: data.notes
          ? `SORTIE:${exitType} — ${data.notes}`
          : `SORTIE:${exitType}`
      };

      StockMovementRepository.create(movement);
      return movement;
    });
  }

  /**
   * Enregistre un ajustement d'inventaire.
   * @param data Les données du mouvement à créer
   * @param actualCount La quantité réellement comptée en magasin
   */
  static addInventory(data: Omit<StockMovement, 'id' | 'type' | 'quantity'>, actualCount: number): StockMovement {
    return runInTransaction(() => {
      const currentStock = StockMovementRepository.getStockLevel(data.product_id);
      const difference = actualCount - currentStock;

      // Aucun écart → rien à enregistrer
      if (difference === 0) {
        throw new Error(`Aucun écart d'inventaire pour ce produit (stock identique à ${currentStock}).`);
      }

      const movement: StockMovement = {
        ...data,
        id: randomUUID(),
        type: 'INVENTORY',
        quantity: Math.abs(difference),
        notes: difference > 0
          ? `${data.notes ? data.notes + ' · ' : ''}Inventaire : +${difference} (compté ${actualCount})`
          : `${data.notes ? data.notes + ' · ' : ''}Inventaire : ${difference} (compté ${actualCount})`,
        date: new Date().toISOString()
      };

      StockMovementRepository.create(movement);
      return movement;
    });
  }
}
