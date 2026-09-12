import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { GlobalSearchRepository } from '../src/repositories/GlobalSearchRepository';
import { ProductService } from '../src/services/ProductService';
import { ClientRepository } from '../src/repositories/ClientRepository';
import { SupplierRepository } from '../src/repositories/SupplierRepository';
import type { ProductInput } from '../src/repositories/ProductRepository';

/**
 * §Phase 5 — Recherche globale : résultats groupés, requêtes indexées,
 * aucune fuite entre groupes, terme vide = aucun résultat.
 */

function createProduct(reference: string, designation: string, barcode: string | null = null): string {
  const input: ProductInput = {
    reference,
    designation,
    barcode,
    purchase_price: 10,
    selling_price: 20,
    wholesale_price: 12,
    min_stock: 0,
    unit: 'PIÈCE',
    status: 'ACTIVE',
  };
  return ProductService.createProduct(input).id;
}

describe('§Phase 5 — Recherche globale (Ctrl+K)', () => {
  beforeEach(() => {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
      DELETE FROM purchase_order_items;
      DELETE FROM purchase_orders;
      DELETE FROM credit_note_refs;
      DELETE FROM payments;
      DELETE FROM document_items;
      DELETE FROM stock_movements;
      DELETE FROM inventory_balances;
      DELETE FROM documents;
      DELETE FROM client_credits;
      DELETE FROM supplier_credits;
      DELETE FROM customers;
      DELETE FROM suppliers;
      DELETE FROM products;
    `);
    db.exec('PRAGMA foreign_keys = ON;');
  });

  it('un terme vide ne renvoie AUCUN résultat (pas de scan complet)', () => {
    createProduct('SKU-1', 'Chaise');
    const r = GlobalSearchRepository.search('');
    expect(r.total).toBe(0);
    expect(r.products).toHaveLength(0);
    expect(r.customers).toHaveLength(0);
    expect(r.documents).toHaveLength(0);

    const spaces = GlobalSearchRepository.search('   ');
    expect(spaces.total).toBe(0);
  });

  it('trouve un produit par RÉFÉRENCE', () => {
    createProduct('REF-ALPHA', 'Produit Alpha');
    createProduct('REF-BETA', 'Produit Bêta');

    const r = GlobalSearchRepository.search('REF-ALPHA');
    expect(r.products).toHaveLength(1);
    expect(r.products[0].reference).toBe('REF-ALPHA');
  });

  it('trouve un produit par DÉSIGNATION (insensible à la casse)', () => {
    createProduct('REF-X', 'Table en bois');
    const r = GlobalSearchRepository.search('table en BOIS');
    expect(r.products).toHaveLength(1);
    expect(r.products[0].designation).toBe('Table en bois');
  });

  it('trouve un produit par CODE-BARRES', () => {
    createProduct('REF-BAR', 'Produit code-barres', '6111234567890');
    const r = GlobalSearchRepository.search('6111234567890');
    expect(r.products).toHaveLength(1);
    expect(r.products[0].barcode).toBe('6111234567890');
  });

  it('trouve un client par NOM et expose son nombre de documents', () => {
    ClientRepository.create({ name: 'Épicerie Hassan', credit_limit: 0, category: 'DÉTAIL' });
    ClientRepository.create({ name: 'Quincaillerie Ali', credit_limit: 0, category: 'DÉTAIL' });

    const r = GlobalSearchRepository.search('hassan');
    expect(r.customers).toHaveLength(1);
    expect(r.customers[0].name).toBe('Épicerie Hassan');
    expect(r.customers[0].documentCount).toBe(0);
  });

  it('trouve un client par TÉLÉPHONE', () => {
    ClientRepository.create({ name: 'Client Tel', phone: '0661234567', credit_limit: 0, category: 'DÉTAIL' });
    const r = GlobalSearchRepository.search('0661234567');
    expect(r.customers).toHaveLength(1);
  });

  it('trouve un fournisseur par NOM', () => {
    SupplierRepository.create({ name: 'Grossiste Nord' });
    const r = GlobalSearchRepository.search('grossiste');
    expect(r.suppliers).toHaveLength(1);
    expect(r.suppliers[0].name).toBe('Grossiste Nord');
  });

  it('les groupes sont cloisonnés : un produit ne fuit pas dans les clients', () => {
    createProduct('PARTAGE', 'Produit partagé');
    ClientRepository.create({ name: 'PARTAGE', credit_limit: 0, category: 'DÉTAIL' });

    const r = GlobalSearchRepository.search('PARTAGE');
    expect(r.products).toHaveLength(1);
    expect(r.customers).toHaveLength(1);
    expect(r.suppliers).toHaveLength(0);
    expect(r.documents).toHaveLength(0);
  });

  it('respecte la limite par groupe', () => {
    for (let i = 0; i < 12; i++) {
      createProduct(`LIM-${String(i).padStart(2, '0')}`, `Produit Limite ${i}`);
    }
    const r = GlobalSearchRepository.search('LIM-', 5);
    expect(r.products.length).toBeLessThanOrEqual(5);
    expect(r.products.length).toBe(5);
  });

  it('les résultats préfixés passent en premier (pertinence)', () => {
    createProduct('AAA-XYZ', 'Autre produit');
    createProduct('XYZ-001', 'Produit cible');

    const r = GlobalSearchRepository.search('XYZ');
    expect(r.products.length).toBeGreaterThanOrEqual(1);
    expect(r.products[0].reference).toBe('XYZ-001');
  });

  it('un terme sans correspondance renvoie un total nul', () => {
    createProduct('REF-ONLY', 'Produit unique');
    const r = GlobalSearchRepository.search('introuvable-zzz');
    expect(r.total).toBe(0);
  });

  it('borne la longueur du terme (anti-requête abusive)', () => {
    const longTerm = 'a'.repeat(500);
    const r = GlobalSearchRepository.search(longTerm);
    expect(r.query.length).toBeLessThanOrEqual(100);
  });
});
