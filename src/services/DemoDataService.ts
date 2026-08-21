import { db, runInTransaction } from '../database/config/connection';
import { CategoryRepository } from '../repositories/CategoryRepository';
import { StockLedgerService } from './StockLedgerService';
import { randomUUID } from 'crypto';

/**
 * Jeu de données de démonstration (cahier des charges §11).
 * Ne crée des données que si la base est vide (aucun produit).
 */
export class DemoDataService {
  private static hasData(): boolean {
    const { count } = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };
    return count > 0;
  }

  static seedIfEmpty(): { seeded: boolean; message: string } {
    if (this.hasData()) {
      return { seeded: false, message: 'La base contient déjà des données, aucun seed effectué.' };
    }

    runInTransaction(() => {
      const now = new Date().toISOString();

      // ─── Catégories & sous-catégories ──────────────────────────────────────
      const catEpicerie = CategoryRepository.create({ name: 'Épicerie & Crémerie', description: 'Produits alimentaires courants' });
      const catBoissons = CategoryRepository.create({ name: 'Boissons', description: 'Eaux, sodas, jus' });
      const catEntretien = CategoryRepository.create({ name: 'Entretien & Hygiène', description: "Produits d'entretien" });
      const catSnacks = CategoryRepository.create({ name: 'Snacks & Confiserie', description: 'Biscuits, chips, bonbons' });

      const subLaitiers = CategoryRepository.addSubcategory(catEpicerie.id, { name: 'Produits laitiers' });
      const subSodas = CategoryRepository.addSubcategory(catBoissons.id, { name: 'Sodas' });
      const subEaux = CategoryRepository.addSubcategory(catBoissons.id, { name: 'Eaux' });
      const subNettoyants = CategoryRepository.addSubcategory(catEntretien.id, { name: 'Nettoyants' });

      // ─── Produits de démo ─────────────────────────────────────────────────
      const defineProduct = (p: {
        reference: string; designation: string; unit: string;
        category_id?: string; subcategory_id?: string;
        barcode: string; purchase_price: number; selling_price: number; wholesale_price: number;
        min_stock: number; qty: number;
      }) => {
        const id = randomUUID();
        const { qty, ...product } = p;
        db.prepare(`
          INSERT INTO products (id, reference, designation, description, category_id, subcategory_id, barcode, unit, purchase_price, selling_price, wholesale_price, min_stock, status)
          VALUES (@id, @reference, @designation, @description, @category_id, @subcategory_id, @barcode, @unit, @purchase_price, @selling_price, @wholesale_price, @min_stock, 'ACTIVE')
        `).run({
          ...product,
          id,
          description: `Produit de démonstration ${p.designation}`,
        });
        db.prepare(`
          INSERT INTO stock_movements (id, product_id, type, quantity, unit_price, date, notes)
          VALUES (?, ?, 'IN', ?, ?, ?, 'Stock initial de démonstration')
        `).run(randomUUID(), id, qty, p.purchase_price, now);
      };

      defineProduct({ reference: 'LAIT-1L', designation: 'Lait entier 1L', unit: 'PIÈCE', category_id: catEpicerie.id, subcategory_id: subLaitiers.id, barcode: '6111000000011', purchase_price: 6.5, selling_price: 9.0, wholesale_price: 7.5, min_stock: 24, qty: 120 });
      defineProduct({ reference: 'YAOURT-4X', designation: 'Yaourt nature 4x100g', unit: 'CARTON', category_id: catEpicerie.id, subcategory_id: subLaitiers.id, barcode: '6111000000028', purchase_price: 3.2, selling_price: 5.0, wholesale_price: 4.0, min_stock: 12, qty: 60 });
      defineProduct({ reference: 'COCA-2L', designation: 'Coca-Cola 2L', unit: 'PIÈCE', category_id: catBoissons.id, subcategory_id: subSodas.id, barcode: '6111000000035', purchase_price: 12.0, selling_price: 16.0, wholesale_price: 13.5, min_stock: 20, qty: 80 });
      defineProduct({ reference: 'EAU-1.5L', designation: 'Eau minérale 1.5L', unit: 'PIÈCE', category_id: catBoissons.id, subcategory_id: subEaux.id, barcode: '6111000000042', purchase_price: 4.0, selling_price: 6.0, wholesale_price: 4.8, min_stock: 48, qty: 240 });
      defineProduct({ reference: 'JAVEL-1L', designation: 'Eau de Javel 1L', unit: 'PIÈCE', category_id: catEntretien.id, subcategory_id: subNettoyants.id, barcode: '6111000000059', purchase_price: 5.5, selling_price: 8.0, wholesale_price: 6.5, min_stock: 12, qty: 40 });
      defineProduct({ reference: 'CHIPS-150G', designation: 'Chips nature 150g', unit: 'PIÈCE', category_id: catSnacks.id, barcode: '6111000000066', purchase_price: 4.8, selling_price: 7.5, wholesale_price: 6.0, min_stock: 30, qty: 90 });

      // ─── Clients de démo ──────────────────────────────────────────────────
      const customerRows: Array<{ id: string; name: string; phone: string; address: string; ice: string; payment_conditions: string; credit_limit: number; category: string }> = [
        { id: randomUUID(), name: 'Épicerie Al Amana', phone: '0661234567', address: 'Quartier Anassi, Casablanca', ice: '001234567000045', payment_conditions: '30 jours', credit_limit: 5000, category: 'GROSSISTE' },
        { id: randomUUID(), name: "Supermarché Atlas", phone: '0662345678', address: "Route de l'Ourika, Marrakech", ice: '001234568000062', payment_conditions: '15 jours', credit_limit: 3000, category: 'VIP' },
        { id: randomUUID(), name: 'Hajj Ahmed', phone: '0663456789', address: 'Souk Lahdab, Fès', ice: '', payment_conditions: 'Comptant', credit_limit: 1000, category: 'DÉTAIL' },
      ];
      const insertCustomer = db.prepare(`
        INSERT INTO customers (id, name, phone, address, ice, payment_conditions, credit_limit, category)
        VALUES (@id, @name, @phone, @address, @ice, @payment_conditions, @credit_limit, @category)
      `);
      for (const c of customerRows) insertCustomer.run(c);

      // Crédit initial pour démontrer le système de نسيئة
      db.prepare(`
        INSERT INTO client_credits (id, customer_id, type, amount, description, date)
        VALUES (?, ?, 'CREDIT', ?, 'Crédit initial de démonstration', ?)
      `).run(randomUUID(), customerRows[0].id, 750, now);

      // ─── Fournisseurs de démo ─────────────────────────────────────────────
      const suppliers = [
        { id: randomUUID(), name: 'Centrale Laitière', phone: '0522456789', address: 'Casablanca', ice: '001987654000012' },
        { id: randomUUID(), name: 'Les Eaux de Marrakech', phone: '0524321098', address: 'Marrakech', ice: '001987655000039' },
        { id: randomUUID(), name: 'Distributor Nour & Fils', phone: '0622987654', address: 'Tanger', ice: '' },
      ];
      const insertSupplier = db.prepare(`
        INSERT INTO suppliers (id, name, phone, address, ice)
        VALUES (@id, @name, @phone, @address, @ice)
      `);
      for (const s of suppliers) insertSupplier.run(s);

      // ─── Remises par volume de démo ───────────────────────────────────────
      const insertDiscount = db.prepare(`
        INSERT INTO volume_discounts (id, name, min_qty, max_qty, discount_pct)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertDiscount.run(randomUUID(), 'Petit lot (3-9 pièces)', 3, 9, 5);
      insertDiscount.run(randomUUID(), 'Lot moyen (10-49 pièces)', 10, 49, 10);
      insertDiscount.run(randomUUID(), 'Gros volume (50+ pièces)', 50, null, 15);

      // ─── Paramètres entreprise par défaut ─────────────────────────────────
      const settings = [
        ['name', 'StockLocal SARL'],
        ['ice', '000000000000000'],
        ['rc', '000000'],
        ['if', '00000000'],
        ['address', 'Rue des Jardins, Casablanca'],
        ['phone', '0522000000'],
        ['email', 'contact@stocklocal.ma'],
      ];
      const upsertSetting = db.prepare(`
        INSERT INTO company_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `);
      for (const [k, v] of settings) upsertSetting.run(k, v);
    });

    // §14 : les mouvements de démo sont insérés en SQL direct (contournement
    // volontaire du StockLedgerService pour la concision) → on reconstruit les
    // balances une fois le seed terminé, sans toucher à la logique métier.
    try {
      StockLedgerService.rebuildBalances();
    } catch (e) {
      console.warn('[Seed] Recalcul des balances échoué (non bloquant) :', e);
    }

    return { seeded: true, message: 'Jeu de données de démonstration créé (6 produits, 3 clients, 3 fournisseurs, 3 paliers de remise).' };
  }
}
