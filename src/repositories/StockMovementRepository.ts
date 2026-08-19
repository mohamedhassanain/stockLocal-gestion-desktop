import { db } from '../database/config/connection';

export interface StockMovement {
  id: string;
  product_id: string;
  type: 'IN' | 'OUT' | 'INVENTORY';
  quantity: number;
  unit_price: number;
  date?: string;
  reference_doc?: string;
  supplier_id?: string;
  notes?: string;
}

export class StockMovementRepository {
  private static stmts = {
    insert: db.prepare(`
      INSERT INTO stock_movements (id, product_id, type, quantity, unit_price, reference_doc, supplier_id, notes)
      VALUES (@id, @product_id, @type, @quantity, @unit_price, @reference_doc, @supplier_id, @notes)
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
    this.stmts.insert.run({
      id: movement.id,
      product_id: movement.product_id,
      type: movement.type,
      quantity: movement.quantity,
      unit_price: movement.unit_price,
      reference_doc: movement.reference_doc ?? null,
      supplier_id: movement.supplier_id ?? null,
      notes: movement.notes ?? null,
    });
  }

  static getHistory(productId: string, limit: number = 50, offset: number = 0): StockMovement[] {
    return this.stmts.findByProduct.all(productId, limit, offset) as StockMovement[];
  }

  static getHistoryWithUser(productId: string, limit: number = 50, offset: number = 0): StockMovement[] {
    return db.prepare(`
      SELECT sm.*
      FROM stock_movements sm
      WHERE sm.product_id = ?
      ORDER BY sm.date DESC
      LIMIT ? OFFSET ?
    `).all(productId, limit, offset) as StockMovement[];
  }

  static getStockLevel(productId: string): number {
    const result = this.stmts.getCurrentStock.get(productId) as { total_stock: number };
    return result?.total_stock || 0;
  }

  /** Get all movements across all products (for §16 full history) */
  static getAllHistory(limit: number = 200, offset: number = 0): Array<StockMovement & { product_ref?: string; product_name?: string }> {
    return db.prepare(`
      SELECT sm.*, p.reference AS product_ref, p.designation AS product_name
      FROM stock_movements sm
      LEFT JOIN products p ON p.id = sm.product_id
      ORDER BY sm.date DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as any[];
  }
}
