import { db, runInTransaction } from '../database/config/connection';

export interface StockMovement {
  id: string;
  product_id: string;
  type: 'IN' | 'OUT' | 'INVENTORY';
  quantity: number;
  unit_price: number;
  date?: string;
  reference_doc?: string;
  supplier_id?: string;
  user_id: string;
  notes?: string;
}

export class StockMovementRepository {
  private static stmts = {
    insert: db.prepare(`
      INSERT INTO stock_movements (id, product_id, type, quantity, unit_price, reference_doc, supplier_id, user_id, notes)
      VALUES (@id, @product_id, @type, @quantity, @unit_price, @reference_doc, @supplier_id, @user_id, @notes)
    `),
    findByProduct: db.prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY date DESC LIMIT ? OFFSET ?'),
    getCurrentStock: db.prepare(`
      SELECT 
        SUM(CASE WHEN type IN ('IN', 'INVENTORY') THEN quantity ELSE 0 END) - 
        SUM(CASE WHEN type = 'OUT' THEN quantity ELSE 0 END) as total_stock
      FROM stock_movements 
      WHERE product_id = ?
    `)
  };

  static create(movement: StockMovement): void {
    this.stmts.insert.run(movement);
  }

  static getHistory(productId: string, limit: number = 50, offset: number = 0): StockMovement[] {
    return this.stmts.findByProduct.all(productId, limit, offset) as StockMovement[];
  }

  static getStockLevel(productId: string): number {
    const result = this.stmts.getCurrentStock.get(productId) as { total_stock: number };
    return result?.total_stock || 0;
  }
}
