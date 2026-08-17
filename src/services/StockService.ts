import { StockMovement, StockMovementRepository } from '../repositories/StockMovementRepository';
import { runInTransaction } from '../database/config/connection';
import { randomUUID } from 'crypto';

export class StockService {
  /**
   * Ajoute une entrée de stock et s'assure que tout est fait dans une transaction
   */
  static addStockEntry(data: Omit<StockMovement, 'id' | 'type'>): StockMovement {
    return runInTransaction(() => {
      const movement: StockMovement = {
        ...data,
        id: randomUUID(),
        type: 'IN',
        date: new Date().toISOString()
      };

      StockMovementRepository.create(movement);
      return movement;
    });
  }

  /**
   * Enregistre une sortie de stock (vente, perte)
   */
  static addStockExit(data: Omit<StockMovement, 'id' | 'type'>): StockMovement {
    return runInTransaction(() => {
      const currentStock = StockMovementRepository.getStockLevel(data.product_id);
      if (currentStock < data.quantity) {
        throw new Error(`Stock insuffisant. Stock actuel : ${currentStock}`);
      }

      const movement: StockMovement = {
        ...data,
        id: randomUUID(),
        type: 'OUT',
        date: new Date().toISOString()
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
