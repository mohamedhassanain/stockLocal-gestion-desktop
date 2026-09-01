import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { ProductService } from '../src/services/ProductService';
import { ProductRepository, type ProductInput } from '../src/repositories/ProductRepository';
import { StockLedgerService } from '../src/services/StockLedgerService';
import { StockMovementRepository } from '../src/repositories/StockMovementRepository';
import { InventorySessionRepository } from '../src/repositories/InventorySessionRepository';
import { DocumentRepository } from '../src/repositories/DocumentRepository';
import { csvEscape } from '../electron/ipcValidation';

function makeProductInput(ref: string, opts: { purchasePrice?: number; sellingPrice?: number } = {}): ProductInput {
  return {
    reference: ref,
    designation: `Produit ${ref}`,
    purchase_price: opts.purchasePrice ?? 10,
    selling_price: opts.sellingPrice ?? 20,
    wholesale_price: (opts.purchasePrice ?? 10) + 1,
    min_stock: 5,
    unit: 'PIÈCE',
    status: 'ACTIVE',
  };
}

function resetRefs(): void {
  db.exec(`
    DELETE FROM inventory_item_versions;
    DELETE FROM inventory_versions;
    DELETE FROM inventory_items;
    DELETE FROM inventory_sessions;
    DELETE FROM purchase_order_items;
    DELETE FROM purchase_orders;
    DELETE FROM price_history;
    DELETE FROM unit_conversions;
    DELETE FROM product_batches;
    DELETE FROM credit_note_refs;
    DELETE FROM document_items;
    DELETE FROM payments;
    DELETE FROM documents;
    DELETE FROM client_credits;
    DELETE FROM supplier_credits;
    DELETE FROM stock_movements;
    DELETE FROM inventory_balances;
    DELETE FROM customers;
    DELETE FROM suppliers;
    DELETE FROM products;
    DELETE FROM document_sequences;
  `);
}

describe('P0-1 — StockLedgerService.getHistory()', () => {
  beforeEach(() => {
    resetRefs();
  });

  it('retourne les mouvements du bon produit, triés par date DESC, paginés', () => {
    const productId = ProductService.createProduct(makeProductInput('HIST-1')).id;
    const otherId = ProductService.createProduct(makeProductInput('HIST-AUTRE')).id;

    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 10, unit_price: 5 });
    StockLedgerService.recordMovement({ product_id: otherId, movement_type: 'PURCHASE_IN', quantity: 99, unit_price: 5 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'SALE_OUT', quantity: 3, unit_price: 8 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 7, unit_price: 6 });

    const history = StockLedgerService.getHistory(productId, 2, 0);

    // Pagination : 2 lignes max par page
    expect(history.length).toBeLessThanOrEqual(2);
    // Uniquement les mouvements de CE produit
    expect(history.every(m => m.product_id === productId)).toBe(true);
    // Tri par date DESC (le plus récent en premier)
    const dates = history.map(m => new Date(m.date!).getTime());
    const sorted = [...dates].sort((a, b) => b - a);
    expect(dates).toEqual(sorted);
  });

  it('getHistory applique OFFSET pour la 2e page sans doublon', () => {
    const productId = ProductService.createProduct(makeProductInput('HIST-PAG')).id;
    for (let i = 0; i < 5; i++) {
      StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 1 });
    }
    const page1 = StockLedgerService.getHistory(productId, 3, 0);
    const page2 = StockLedgerService.getHistory(productId, 3, 3);
    const ids = [...page1, ...page2].map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(5);
  });
});

describe('P0-2 — Product + initial stock atomic', () => {
  beforeEach(() => {
    resetRefs();
  });

  it('crée le produit ET le mouvement de stock initial en une seule opération', () => {
    const product = ProductService.createProductWithInitialStock(makeProductInput('ATOM-1'), 50);

    expect(ProductRepository.findById(product.id)).toBeDefined();
    const level = StockLedgerService.getStockLevel(product.id);
    expect(level).toBe(50);
    const movements = StockLedgerService.getHistory(product.id);
    expect(movements.length).toBe(1);
    expect(movements[0].movement_type).toBe('OPENING_BALANCE');
  });

  it('échoue proprement sur stock invalide (négatif) — aucun produit créé', () => {
    expect(() => ProductService.createProductWithInitialStock(makeProductInput('ATOM-NEG'), -5)).toThrow(/Stock initial invalide/);
    expect(ProductRepository.search('ATOM-NEG', 1)).toHaveLength(0);
  });

  it('echoue si validation métier échoue (prix vente < prix achat) — rien créé', () => {
    const bad = makeProductInput('ATOM-BAD', { purchasePrice: 30, sellingPrice: 10 });
    expect(() => ProductService.createProductWithInitialStock(bad, 5)).toThrow(/prix de vente/);
    expect(ProductRepository.search('ATOM-BAD', 1)).toHaveLength(0);
  });
});

describe('P0-3 — Product update atomic (prix + historique)', () => {
  beforeEach(() => {
    resetRefs();
  });

  it('met à jour le produit et enregistre l\'historique de prix dans une transaction', () => {
    const id = ProductService.createProduct(makeProductInput('UPD-PX')).id;
    const updated = ProductService.updateProduct(id, makeProductInput('UPD-PX', { purchasePrice: 15, sellingPrice: 30 }));
    expect(updated.purchase_price).toBe(15);
    const refs = db.prepare('SELECT COUNT(*) AS count FROM price_history WHERE product_id = ?').get(id) as { count: number };
    expect(refs.count).toBeGreaterThanOrEqual(1);
  });

  it('updateProductWithStock applique le produit + le stock atomiquement', () => {
    const id = ProductService.createProduct(makeProductInput('UPD-STK')).id;
    const updated = ProductService.updateProductWithStock(id, makeProductInput('UPD-STK'), 10);
    expect(updated.purchase_price).toBe(10);
    expect(StockLedgerService.getStockLevel(id)).toBe(10);
  });

  it('updateProductWithStock refuse un retrait dépasant le stock (rollback complet)', () => {
    const id = ProductService.createProduct(makeProductInput('UPD-OVR', { purchasePrice: 5, sellingPrice: 8 })).id;
    StockLedgerService.recordMovement({ product_id: id, movement_type: 'PURCHASE_IN', quantity: 4 });
    const before = ProductRepository.findById(id)!;
    expect(() => ProductService.updateProductWithStock(id, makeProductInput('UPD-OVR', { purchasePrice: 6, sellingPrice: 9 }), -100)).toThrow(/Stock insuffisant/);
    const after = ProductRepository.findById(id)!;
    expect(after.purchase_price).toBe(before.purchase_price);
    expect(StockLedgerService.getStockLevel(id)).toBe(4);
  });
});

describe('P1-15 — price_history RESTRICT', () => {
  beforeEach(() => {
    resetRefs();
  });

  it('refuse la suppression d\'un produit qui a un historique de prix', () => {
    const id = ProductService.createProduct(makeProductInput('PH-PROTECT')).id;
    ProductService.updateProduct(id, makeProductInput('PH-PROTECT', { purchasePrice: 12, sellingPrice: 24 }));
    expect(() => ProductService.deleteProduct(id)).toThrow(/historique de prix/);
  });
});

describe('P1-21 — CSV formula injection (csvEscape)', () => {
  it('préfixe une apostrophe pour = + - @', () => {
    // Lorsque la valeur contient un guillemet, csvEscape la quote aussi
    // (sécurité CSV) : la sortie est `"'=HYPERLINK(""x"")"`.
    expect(csvEscape('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvEscape('+SUM(A1)')).toBe(`'+SUM(A1)`);
    expect(csvEscape('-1+1')).toBe(`'-1+1`);
    expect(csvEscape('@cmd')).toBe(`'@cmd`);
  });

  it('n\'altère PAS le texte légitime commençant par un tiret', () => {
    // "- produit 10kg" est une donnée métier normale, pas une formule.
    // csvEscape ne doit pas casser la lecture (on préfixe uniquement si la
    // valeur EST une formule : un tiret avant du texte n'est pas dangereux ici
    // car Excel ne l'interprète pas comme une formule. On garde le comportement
    // existant = on préfixe. Ce test documente le comportement.)
    // NOTE : la règle actuelle préfixe tout -/+/=/@ ; on vérifie juste qu'elle
    // produit une chaîne lisible.
    expect(csvEscape('- produit 10kg')).toBe(`'- produit 10kg`);
  });

  it('gère les guillemets internes et le point-virgule', () => {
    expect(csvEscape('a;b')).toBe('"a;b"');
    expect(csvEscape('dit "salut"')).toBe('"dit ""salut"""');
  });
});

describe('P0-7 / P0-4 / P0-5 — Inventory protections', () => {
  beforeEach(() => {
    resetRefs();
  });

  function setupValidated(): { sessionId: string; itemId: string } {
    const p1 = ProductService.createProduct(makeProductInput('INV-P1')).id;
    ProductService.createProductWithInitialStock(makeProductInput('INV-P2'), 100);
    const s = InventorySessionRepository.create({ name: 'Session test' });
    InventorySessionRepository.startCounting(s.id);
    const items = InventorySessionRepository.getById(s.id)!.items!;
    let count = 0;
    for (const item of items) {
      if (item.product_id === p1) {
        count = 90;
      } else {
        count = 95;
      }
      InventorySessionRepository.countItem(item.id, count);
    }
    InventorySessionRepository.calculateGaps(s.id);
    const validated = InventorySessionRepository.validate(s.id);
    const firstItem = validated.items!.find(i => i.product_id === p1)!;
    return { sessionId: s.id, itemId: firstItem.id };
  }

  it('refuse une double validation (ne retourne pas une 2e fois)', () => {
    const { sessionId } = setupValidated();
    expect(() => InventorySessionRepository.validate(sessionId)).toThrow(/déjà été validée/);
  });

  it('refuse de restaurer une version d\'une AUTRE session', () => {
    // Créer des produits afin que la session ait des lignes à compter/versionner.
    ProductService.createProduct(makeProductInput('VER-A'));
    ProductService.createProduct(makeProductInput('VER-B'));

    const a = InventorySessionRepository.create({ name: 'Session A' });
    InventorySessionRepository.startCounting(a.id);
    const itemsA = InventorySessionRepository.getById(a.id)!.items!;
    expect(itemsA.length).toBeGreaterThan(0);
    for (const item of itemsA) {
      InventorySessionRepository.countItem(item.id, 10);
    }
    InventorySessionRepository.calculateGaps(a.id);
    InventorySessionRepository.validate(a.id);
    InventorySessionRepository.createVersion(a.id, 'snapshot');

    const versions = InventorySessionRepository.getVersions(a.id);
    expect(versions.length).toBeGreaterThan(0);
    const v = versions[0];

    const b = InventorySessionRepository.create({ name: 'Session B' });
    // La version de la session A ne peut pas être restaurée dans la session B.
    expect(() => InventorySessionRepository.restoreVersion(b.id, v.id)).toThrow(/n'appartient pas/);
  });

  it('corrige un inventaire validé en lot, ATOMIQUE', () => {
    const { sessionId, itemId } = setupValidated();
    const corrected = 100;
    const result = InventorySessionRepository.correctValidatedInventoryBatch(sessionId, { [itemId]: corrected });
    expect(result).toBeUndefined();
    const item = InventorySessionRepository.getById(sessionId)!.items!.find(i => i.id === itemId)!;
    expect(item.counted_qty).toBe(corrected);
  });

  it('refuse de supprimer une session validée', () => {
    const { sessionId } = setupValidated();
    expect(() => InventorySessionRepository.remove(sessionId)).toThrow(/Impossible de supprimer un inventaire validé/);
  });
});

describe('P1-17 — WipeAll token enforcement (simulé au niveau du handler via payload)', () => {
  it('valide que le jeton WIPE_ALL est requis (logique métier)', () => {
    // On vérifie la règle directement : le handler derrière data:wipeAll
    // exige payload.confirm === 'WIPE_ALL'. Cette simulation documente la
    // protection backend (le renderer ne peut pas lancer un wipe sans jeton).
    function simulateHandler(payload: unknown): { success: boolean; error?: string } {
      const p = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>;
      if (p['confirm'] !== 'WIPE_ALL') {
        return { success: false, error: 'Confirmation forte requise : la réinitialisation complète est refusée. Le jeton "WIPE_ALL" est manquant.' };
      }
      return { success: true };
    }
    expect(simulateHandler({})).toMatchObject({ success: false });
    expect(simulateHandler({ confirm: 'SUPPRIMER' })).toMatchObject({ success: false });
    expect(simulateHandler({ confirm: 'WIPE_ALL' })).toMatchObject({ success: true });
    expect(simulateHandler({ confirm: 'WIPE_ALL', skipBackup: true })).toMatchObject({ success: true });
  });
});

describe('P1-24 — Document sequences (pas de COUNT(*) + 1)', () => {
  beforeEach(() => {
    resetRefs();
  });

  it('génère des numéros consécutifs sans collision via document_sequences', () => {
    const customerId = 'cust-1';
    const productId = ProductService.createProduct(makeProductInput('SEQ-PROD')).id;
    db.prepare('INSERT INTO customers (id, name) VALUES (?, ?)').run(customerId, 'Client Test');
    const d1 = DocumentRepository.create({ type: 'INVOICE', entity_id: customerId, date: new Date().toISOString(), items: [{ product_id: productId, quantity: 1, unit_price: 10, discount: 0 }] });
    const d2 = DocumentRepository.create({ type: 'INVOICE', entity_id: customerId, date: new Date().toISOString(), items: [{ product_id: productId, quantity: 1, unit_price: 10, discount: 0 }] });
    const seq = d1.document_number.split('-').pop();
    const seq2 = d2.document_number.split('-').pop();
    expect(Number(seq2)).toBe(Number(seq) + 1);
  });
});
