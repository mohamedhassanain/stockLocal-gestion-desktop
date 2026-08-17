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

      // 1. Enregistrer le mouvement
      StockMovementRepository.create(movement);

      // 2. Mettre à jour le prix d'achat moyen pondéré (PAMP) du produit si nécessaire (logique métier)
      // ProductRepository.updatePurchasePrice(data.product_id, data.unit_price);

      return movement;
    });
  }

  /**
   * Enregistre une sortie de stock (vente, perte)
   */
  static addStockExit(data: Omit<StockMovement, 'id' | 'type'>): StockMovement {
    return runInTransaction(() => {
      // 1. Vérifier si le stock est suffisant
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
}
