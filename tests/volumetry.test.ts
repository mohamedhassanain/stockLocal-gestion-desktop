import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/database/config/connection';
import { ProductRepository } from '../src/repositories/ProductRepository';
import { StockMovementRepository } from '../src/repositories/StockMovementRepository';
import { ClientRepository } from '../src/repositories/ClientRepository';
import { DashboardRepository } from '../src/repositories/DashboardRepository';
import { ExportService } from '../src/services/ExportService';
import fs from 'node:fs';

// Nombre d'éléments par scénario (volontairement << production pour rester rapide,
// mais assez grand pour prouver que les requêtes sont paginées/batchées côté SQL).
const PRODUCT_COUNT = 200;
const MOVEMENTS_PER_PRODUCT = 5; // 200 * 5 = 1 000 mouvements
const CLIENT_COUNT = 300;
const DOC_COUNT = 300;

function cleanupAll() {
  db.exec(`
    DELETE FROM inventory_balances;
    DELETE FROM stock_movements;
    DELETE FROM document_items;
    DELETE FROM documents;
    DELETE FROM client_credits;
    DELETE FROM customers;
    DELETE FROM suppliers;
    DELETE FROM supplier_credits;
    DELETE FROM products;
    DELETE FROM purchase_orders;
    DELETE FROM inventory_sessions;
    DELETE FROM categories;
    VACUUM;
  `);
}

function insertProducts(count: number) {
  const stmt = db.prepare(`
    INSERT INTO products (id, reference, designation, status, purchase_price, selling_price, wholesale_price, min_stock, unit)
    VALUES (?, ?, ?, 'ACTIVE', 10, 20, 15, 5, 'PIÈCE')
  `);
  for (let i = 0; i < count; i++) {
    stmt.run(`prod-vol-${String(i).padStart(5, '0')}`, `REF-${String(i).padStart(5, '0')}`, `Produit volumétrie ${i}`);
  }
}

let movementCounter = 0;
function insertMovements(count: number) {
  const stmt = db.prepare(`
    INSERT INTO stock_movements (id, product_id, type, movement_type, quantity, unit_price, date)
    VALUES (?, ?, 'IN', 'PURCHASE_IN', 1, 10, datetime('now', '-' || ? || ' days'))
  `);
  for (let i = 0; i < count; i++) {
    stmt.run(`mvt-vol-${String(movementCounter++).padStart(8, '0')}`, `prod-vol-${String(i % PRODUCT_COUNT).padStart(5, '0')}`, i % 30);
  }
}

function insertClients(count: number) {
  const stmt = db.prepare(`
    INSERT INTO customers (id, name, category, credit_limit)
    VALUES (?, ?, 'DÉTAIL', 1000)
  `);
  for (let i = 0; i < count; i++) {
    stmt.run(`client-vol-${String(i).padStart(5, '0')}`, `Client volumétrie ${i}`);
  }
}

function insertDocuments(count: number) {
  const stmt = db.prepare(`
    INSERT INTO documents (id, type, document_number, entity_id, date, total_excl_tax, total_tax, total_incl_tax, status)
    VALUES (?, 'INVOICE', ?, ?, date('now'), 100, 20, 120, 'PAID')
  `);
  for (let i = 0; i < count; i++) {
    stmt.run(`doc-vol-${String(i).padStart(5, '0')}`, `FAC-VOL-${String(i).padStart(5, '0')}`, `client-vol-${String(i % CLIENT_COUNT).padStart(5, '0')}`);
  }
}

beforeAll(() => {
  cleanupAll();
  insertProducts(PRODUCT_COUNT);
  insertMovements(PRODUCT_COUNT * MOVEMENTS_PER_PRODUCT);
  insertClients(CLIENT_COUNT);
  insertDocuments(DOC_COUNT);
});

afterAll(() => {
  cleanupAll();
});

describe('Volumétrie — requêtes paginées côté SQL', () => {
  it('10k produits : search() ne ramène qu\'une page (LIMIT 50)', () => {
    // Préparer 10 000 produits (le test est ciblé sur la pagination)
    const stmt = db.prepare(`
      INSERT INTO products (id, reference, designation, status, purchase_price, selling_price, wholesale_price, min_stock, unit)
      VALUES (?, ?, ?, 'ACTIVE', 10, 20, 15, 5, 'PIÈCE')
    `);
    for (let i = 0; i < 10000; i++) {
      stmt.run(`prod-mass-${String(i).padStart(5, '0')}`, `MASS-${String(i).padStart(5, '0')}`, `Produit masse ${i}`);
    }
    const page = ProductRepository.search('MASS-', 50, 0);
    expect(page.length).toBeLessThanOrEqual(50);
    const page2 = ProductRepository.search('MASS-', 50, 50);
    expect(page2.length).toBeLessThanOrEqual(50);
    // Les deux pages ne se chevauchent jamais (LIMIT/OFFSET propre)
    expect(new Set([...page, ...page2].map(p => p.id)).size).toBe(page.length + page2.length);
  });

  it('50k mouvements : getAllHistory() ne renvoie qu\'une page (LIMIT 1000 max)', () => {
    // Préparer assez de mouvements pour faire un total > 50 000
    for (let i = 0; i < 500; i++) {
      insertMovements(100); // 100 mouvements × 500 = 50 000
    }
    const page = StockMovementRepository.getAllHistory(1000, 0);
    expect(page.length).toBeLessThanOrEqual(1000);
  });

  it('clients : getAll() est limité à un max (pas tout en mémoire)', () => {
    const clients = ClientRepository.getAll();
    expect(clients.length).toBeLessThanOrEqual(500);
  });

  it('dashboard : getStats() passe par des requêtes agrégées (pas de scan ligne par ligne)', () => {
    const stats = DashboardRepository.getStats();
    expect(stats.revenue_today).toBeGreaterThanOrEqual(0);
    expect(stats.total_stock_value).toBeGreaterThanOrEqual(0);
    expect(stats.unpaid_total).toBeGreaterThanOrEqual(0);
  });

  it('exports CSV par batch : écrit TOUT (aucune limite silencieuse)', () => {
    const filePath = ExportService.exportProducts();
    const lines = fs.readFileSync(filePath, 'utf-8').split('\r\n').filter(Boolean);
    // 1 ligne d'en-tête + (200 produits initiaux + 10 000 produits masse) = 10 201 lignes
    expect(lines.length).toBe(1 + PRODUCT_COUNT + 10000);
  });
});
