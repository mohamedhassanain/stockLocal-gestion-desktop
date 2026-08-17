"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const path$1 = require("node:path");
const node_url = require("node:url");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
var _documentCurrentScript = typeof document !== "undefined" ? document.currentScript : null;
const isProd = process.env.NODE_ENV === "production";
const userDataPath = electron.app ? electron.app.getPath("userData") : process.cwd();
const dbPath = path.join(userDataPath, "stocklocal.db");
const db = new Database(dbPath, {
  verbose: !isProd ? console.log : void 0
});
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("temp_store = MEMORY");
db.pragma("cache_size = -64000");
db.pragma("foreign_keys = ON");
function resolveSchemaPath() {
  const candidates = [
    path.join(process.cwd(), "src", "database", "schema", "database.sql"),
    path.join(process.cwd(), "database", "schema", "database.sql")
  ];
  if (process.env.APP_ROOT) {
    candidates.push(path.join(process.env.APP_ROOT, "src", "database", "schema", "database.sql"));
  }
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
function applySchema() {
  const schemaPath = resolveSchemaPath();
  if (!schemaPath) {
    console.warn("[DB] Fichier de schéma introuvable.");
    return;
  }
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
  console.log("[DB] Schéma appliqué.");
}
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[DB] Colonne ajoutée : ${table}.${column}`);
  }
}
function migrateColumns() {
  addColumnIfMissing("documents", "due_date", "DATETIME");
  addColumnIfMissing("documents", "notes", "TEXT");
}
function seedDefaultUser() {
  const { count } = db.prepare("SELECT count(*) as count FROM users").get();
  if (count === 0) {
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)`
    ).run("user_1", "admin", "changeme", "ADMIN");
    console.log("[DB] Utilisateur par défaut créé (admin / changeme).");
  }
}
function initDb() {
  applySchema();
  migrateColumns();
  seedDefaultUser();
}
initDb();
function runInTransaction(fn) {
  const transaction = db.transaction(fn);
  return transaction();
}
class ProductRepository {
  static findById(id) {
    return this.stmts.findById.get(id);
  }
  static findByBarcode(barcode) {
    return this.stmts.findByBarcode.get(barcode);
  }
  static search(query, limit = 50, offset = 0) {
    return this.stmts.search.all({ query: `%${query}%`, limit, offset });
  }
  static create(product) {
    this.stmts.insert.run(product);
  }
  static update(product) {
    this.stmts.update.run(product);
  }
  static archive(id) {
    this.stmts.archive.run(id);
  }
}
// Déclaration des requêtes préparées pour garantir une exécution < 100ms
__publicField(ProductRepository, "stmts", {
  findById: db.prepare("SELECT * FROM products WHERE id = ?"),
  findByBarcode: db.prepare("SELECT * FROM products WHERE barcode = ?"),
  search: db.prepare(`
      SELECT * FROM products 
      WHERE designation LIKE @query OR reference LIKE @query OR barcode LIKE @query
      LIMIT @limit OFFSET @offset
    `),
  insert: db.prepare(`
      INSERT INTO products (id, reference, designation, description, category_id, subcategory_id, barcode, image_path, purchase_price, selling_price, wholesale_price, min_stock, status)
      VALUES (@id, @reference, @designation, @description, @category_id, @subcategory_id, @barcode, @image_path, @purchase_price, @selling_price, @wholesale_price, @min_stock, @status)
    `),
  update: db.prepare(`
      UPDATE products 
      SET reference = @reference, designation = @designation, description = @description, category_id = @category_id, subcategory_id = @subcategory_id, barcode = @barcode, image_path = @image_path, purchase_price = @purchase_price, selling_price = @selling_price, wholesale_price = @wholesale_price, min_stock = @min_stock, status = @status, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `),
  archive: db.prepare("UPDATE products SET status = 'ARCHIVED' WHERE id = ?")
});
class ProductService {
  /**
   * Crée un nouveau produit avec validation des règles métier.
   */
  static createProduct(productData) {
    if (productData.selling_price < productData.purchase_price) {
      throw new Error("Le prix de vente ne peut pas être inférieur au prix d'achat.");
    }
    if (productData.barcode) {
      const existing = ProductRepository.findByBarcode(productData.barcode);
      if (existing) {
        throw new Error(`Le code-barres ${productData.barcode} est déjà utilisé.`);
      }
    }
    const newProduct = {
      ...productData,
      id: crypto.randomUUID(),
      status: productData.status || "ACTIVE"
    };
    ProductRepository.create(newProduct);
    return newProduct;
  }
  /**
   * Recherche instantanée de produits
   */
  static searchProducts(query, limit = 50) {
    if (!query || query.trim().length === 0) {
      return [];
    }
    return ProductRepository.search(query, limit);
  }
}
class StockMovementRepository {
  static create(movement) {
    this.stmts.insert.run(movement);
  }
  static getHistory(productId, limit = 50, offset = 0) {
    return this.stmts.findByProduct.all(productId, limit, offset);
  }
  static getStockLevel(productId) {
    const result = this.stmts.getCurrentStock.get(productId);
    return (result == null ? void 0 : result.total_stock) || 0;
  }
}
__publicField(StockMovementRepository, "stmts", {
  insert: db.prepare(`
      INSERT INTO stock_movements (id, product_id, type, quantity, unit_price, reference_doc, supplier_id, user_id, notes)
      VALUES (@id, @product_id, @type, @quantity, @unit_price, @reference_doc, @supplier_id, @user_id, @notes)
    `),
  findByProduct: db.prepare("SELECT * FROM stock_movements WHERE product_id = ? ORDER BY date DESC LIMIT ? OFFSET ?"),
  getCurrentStock: db.prepare(`
      SELECT 
        SUM(CASE WHEN type IN ('IN', 'INVENTORY') THEN quantity ELSE 0 END) - 
        SUM(CASE WHEN type = 'OUT' THEN quantity ELSE 0 END) as total_stock
      FROM stock_movements 
      WHERE product_id = ?
    `)
});
class StockService {
  /**
   * Ajoute une entrée de stock et s'assure que tout est fait dans une transaction
   */
  static addStockEntry(data) {
    return runInTransaction(() => {
      const movement = {
        ...data,
        id: crypto.randomUUID(),
        type: "IN",
        date: (/* @__PURE__ */ new Date()).toISOString()
      };
      StockMovementRepository.create(movement);
      return movement;
    });
  }
  /**
   * Enregistre une sortie de stock (vente, perte)
   */
  static addStockExit(data) {
    return runInTransaction(() => {
      const currentStock = StockMovementRepository.getStockLevel(data.product_id);
      if (currentStock < data.quantity) {
        throw new Error(`Stock insuffisant. Stock actuel : ${currentStock}`);
      }
      const movement = {
        ...data,
        id: crypto.randomUUID(),
        type: "OUT",
        date: (/* @__PURE__ */ new Date()).toISOString()
      };
      StockMovementRepository.create(movement);
      return movement;
    });
  }
}
const stmtSearch$1 = db.prepare(`
  SELECT c.*,
    COALESCE(
      (SELECT SUM(CASE WHEN cc.type='CREDIT' THEN cc.amount ELSE -cc.amount END)
       FROM client_credits cc WHERE cc.customer_id = c.id),
    0) AS balance
  FROM customers c
  WHERE c.name LIKE ? OR c.phone LIKE ?
  ORDER BY c.name ASC
  LIMIT 200
`);
const stmtGetAll$1 = db.prepare(`
  SELECT c.*,
    COALESCE(
      (SELECT SUM(CASE WHEN cc.type='CREDIT' THEN cc.amount ELSE -cc.amount END)
       FROM client_credits cc WHERE cc.customer_id = c.id),
    0) AS balance
  FROM customers c
  ORDER BY c.name ASC
  LIMIT 500
`);
const stmtGetById$1 = db.prepare(`
  SELECT c.*,
    COALESCE(
      (SELECT SUM(CASE WHEN cc.type='CREDIT' THEN cc.amount ELSE -cc.amount END)
       FROM client_credits cc WHERE cc.customer_id = c.id),
    0) AS balance
  FROM customers c
  WHERE c.id = ?
`);
const stmtInsert = db.prepare(`
  INSERT INTO customers (id, name, phone, address, ice, payment_conditions, credit_limit)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const stmtUpdate = db.prepare(`
  UPDATE customers SET name=?, phone=?, address=?, ice=?, payment_conditions=?, credit_limit=?, updated_at=CURRENT_TIMESTAMP
  WHERE id=?
`);
const stmtGetHistory = db.prepare(`
  SELECT * FROM client_credits WHERE customer_id = ? ORDER BY date DESC LIMIT 200
`);
const stmtAddCredit = db.prepare(`
  INSERT INTO client_credits (id, customer_id, type, amount, description, user_id)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const stmtGetBalance = db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN type='CREDIT' THEN amount ELSE -amount END), 0) AS balance
  FROM client_credits
  WHERE customer_id = ?
`);
const ClientRepository = {
  getAll() {
    return stmtGetAll$1.all();
  },
  search(query) {
    const q = `%${query}%`;
    return stmtSearch$1.all(q, q);
  },
  getById(id) {
    return stmtGetById$1.get(id);
  },
  create(data) {
    const id = crypto.randomUUID();
    stmtInsert.run(
      id,
      data.name,
      data.phone ?? null,
      data.address ?? null,
      data.ice ?? null,
      data.payment_conditions ?? null,
      data.credit_limit ?? 0
    );
    return this.getById(id);
  },
  update(id, data) {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Client introuvable : ${id}`);
    stmtUpdate.run(
      data.name ?? existing.name,
      data.phone ?? existing.phone ?? null,
      data.address ?? existing.address ?? null,
      data.ice ?? existing.ice ?? null,
      data.payment_conditions ?? existing.payment_conditions ?? null,
      data.credit_limit ?? existing.credit_limit ?? 0,
      id
    );
    return this.getById(id);
  },
  getHistory(customerId) {
    return stmtGetHistory.all(customerId);
  },
  getBalance(customerId) {
    const result = stmtGetBalance.get(customerId);
    return result.balance;
  },
  addCredit(data) {
    const id = crypto.randomUUID();
    stmtAddCredit.run(id, data.customer_id, data.type, data.amount, data.description ?? null, data.user_id);
    return { id, ...data, date: (/* @__PURE__ */ new Date()).toISOString() };
  }
};
const ClientService = {
  createClient(data) {
    if (!data.name || data.name.trim() === "") {
      throw new Error("Le nom du client est obligatoire.");
    }
    if (data.credit_limit < 0) {
      throw new Error("Le plafond de crédit ne peut pas être négatif.");
    }
    return ClientRepository.create(data);
  },
  updateClient(id, data) {
    return ClientRepository.update(id, data);
  },
  // Ajouter une dette (vente à crédit - نسيئة)
  addDebt(customerId, amount, description, userId) {
    if (amount <= 0) throw new Error("Le montant doit être supérieur à 0.");
    const customer = ClientRepository.getById(customerId);
    if (!customer) throw new Error("Client introuvable.");
    if (customer.credit_limit > 0) {
      const currentBalance = ClientRepository.getBalance(customerId);
      if (currentBalance + amount > customer.credit_limit) {
        throw new Error(`Plafond de crédit dépassé. Plafond : ${customer.credit_limit} MAD, Solde actuel : ${currentBalance.toFixed(2)} MAD.`);
      }
    }
    return db.transaction(() => {
      return ClientRepository.addCredit({
        customer_id: customerId,
        type: "CREDIT",
        amount,
        description,
        user_id: userId
      });
    })();
  },
  // Encaisser un paiement
  recordPayment(customerId, amount, description, userId) {
    if (amount <= 0) throw new Error("Le montant doit être supérieur à 0.");
    const currentBalance = ClientRepository.getBalance(customerId);
    if (amount > currentBalance) {
      throw new Error(`Le paiement (${amount} MAD) dépasse la dette actuelle (${currentBalance.toFixed(2)} MAD).`);
    }
    return db.transaction(() => {
      return ClientRepository.addCredit({
        customer_id: customerId,
        type: "PAYMENT",
        amount,
        description: description || "Paiement reçu",
        user_id: userId
      });
    })();
  },
  getAllClients() {
    return ClientRepository.getAll();
  },
  searchClients(query) {
    if (!query || query.trim() === "") return ClientRepository.getAll();
    return ClientRepository.search(query.trim());
  },
  getClientHistory(customerId) {
    return ClientRepository.getHistory(customerId);
  }
};
const stmtGetAll = db.prepare(`
  SELECT d.*, c.name AS customer_name,
    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.document_id = d.id), 0) AS amount_paid
  FROM documents d
  LEFT JOIN customers c ON c.id = d.entity_id
  WHERE d.type = ?
  ORDER BY d.date DESC
  LIMIT 500
`);
const stmtSearch = db.prepare(`
  SELECT d.*, c.name AS customer_name,
    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.document_id = d.id), 0) AS amount_paid
  FROM documents d
  LEFT JOIN customers c ON c.id = d.entity_id
  WHERE d.type = ? AND (c.name LIKE ? OR d.document_number LIKE ?)
  ORDER BY d.date DESC
  LIMIT 200
`);
const stmtGetById = db.prepare(`
  SELECT d.*, c.name AS customer_name,
    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.document_id = d.id), 0) AS amount_paid
  FROM documents d
  LEFT JOIN customers c ON c.id = d.entity_id
  WHERE d.id = ?
`);
const stmtGetItems = db.prepare(`
  SELECT di.*, p.reference AS product_ref, p.designation AS product_name
  FROM document_items di
  LEFT JOIN products p ON p.id = di.product_id
  WHERE di.document_id = ?
`);
const stmtGetPayments = db.prepare(`
  SELECT * FROM payments WHERE document_id = ? ORDER BY date DESC
`);
const stmtInsertDoc = db.prepare(`
  INSERT INTO documents (id, type, document_number, entity_id, date, due_date, total_excl_tax, total_incl_tax, status, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtInsertItem = db.prepare(`
  INSERT INTO document_items (id, document_id, product_id, quantity, unit_price, discount, total)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const stmtUpdateStatus = db.prepare(`
  UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);
const stmtInsertPayment = db.prepare(`
  INSERT INTO payments (id, document_id, amount, payment_method, date, reference)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const stmtGetNextNumber = db.prepare(`
  SELECT COUNT(*) as cnt FROM documents WHERE type = ? AND strftime('%Y', date) = ?
`);
const DocumentRepository = {
  generateNumber(type) {
    const year = (/* @__PURE__ */ new Date()).getFullYear().toString();
    const prefixes = {
      QUOTE: "DEV",
      DELIVERY_NOTE: "BL",
      INVOICE: "FAC",
      CREDIT_NOTE: "AV"
    };
    const result = stmtGetNextNumber.get(type, year);
    const seq = String(result.cnt + 1).padStart(5, "0");
    return `${prefixes[type]}-${year}-${seq}`;
  },
  getAll(type) {
    return stmtGetAll.all(type);
  },
  search(type, query) {
    const q = `%${query}%`;
    return stmtSearch.all(type, q, q);
  },
  getById(id) {
    const doc = stmtGetById.get(id);
    if (doc) {
      doc.items = stmtGetItems.all(id);
    }
    return doc;
  },
  create(data) {
    const id = crypto.randomUUID();
    const document_number = this.generateNumber(data.type);
    let total_excl_tax = 0;
    for (const item of data.items) {
      const lineTotal = item.quantity * item.unit_price * (1 - item.discount / 100);
      total_excl_tax += lineTotal;
    }
    const total_incl_tax = total_excl_tax;
    const insertAll = db.transaction(() => {
      stmtInsertDoc.run(
        id,
        data.type,
        document_number,
        data.entity_id,
        data.date,
        data.due_date ?? null,
        total_excl_tax,
        total_incl_tax,
        "UNPAID",
        data.notes ?? null
      );
      for (const item of data.items) {
        const lineTotal = item.quantity * item.unit_price * (1 - item.discount / 100);
        stmtInsertItem.run(
          crypto.randomUUID(),
          id,
          item.product_id,
          item.quantity,
          item.unit_price,
          item.discount,
          lineTotal
        );
      }
    });
    insertAll();
    return this.getById(id);
  },
  addPayment(data) {
    const payId = crypto.randomUUID();
    stmtInsertPayment.run(payId, data.document_id, data.amount, data.payment_method, (/* @__PURE__ */ new Date()).toISOString(), data.reference ?? null);
    const doc = stmtGetById.get(data.document_id);
    const paidResult = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE document_id = ?`).get(data.document_id);
    const paid = paidResult.total;
    let newStatus = "UNPAID";
    if (paid >= doc.total_incl_tax) newStatus = "PAID";
    else if (paid > 0) newStatus = "PARTIAL";
    stmtUpdateStatus.run(newStatus, data.document_id);
  },
  getPayments(documentId) {
    return stmtGetPayments.all(documentId);
  },
  // Conversion BL → Facture
  convertToInvoice(deliveryNoteId) {
    const bl = this.getById(deliveryNoteId);
    if (!bl) throw new Error("Bon de livraison introuvable.");
    if (bl.type !== "DELIVERY_NOTE") throw new Error("Ce document n'est pas un bon de livraison.");
    return this.create({
      type: "INVOICE",
      entity_id: bl.entity_id,
      date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      items: (bl.items ?? []).map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        discount: i.discount
      })),
      notes: `Converti depuis ${bl.document_number}`
    });
  }
};
const DocumentService = {
  createDocument(data) {
    if (!data.entity_id) throw new Error("Veuillez sélectionner un client.");
    if (!data.items || data.items.length === 0) throw new Error("Le document doit contenir au moins une ligne de produit.");
    for (const item of data.items) {
      if (item.quantity <= 0) throw new Error("La quantité doit être supérieure à 0.");
      if (item.unit_price < 0) throw new Error("Le prix unitaire ne peut pas être négatif.");
      if (item.discount < 0 || item.discount > 100) throw new Error("La remise doit être comprise entre 0 et 100%.");
    }
    return DocumentRepository.create(data);
  },
  getDocuments(type, query = "") {
    if (query.trim() === "") return DocumentRepository.getAll(type);
    return DocumentRepository.search(type, query.trim());
  },
  getDocument(id) {
    return DocumentRepository.getById(id);
  },
  addPayment(data) {
    if (data.amount <= 0) throw new Error("Le montant du paiement doit être supérieur à 0.");
    const doc = DocumentRepository.getById(data.document_id);
    if (!doc) throw new Error("Document introuvable.");
    if (doc.status === "PAID") throw new Error("Ce document est déjà intégralement payé.");
    const remaining = doc.total_incl_tax - (doc.amount_paid ?? 0);
    if (data.amount > remaining + 0.01) {
      throw new Error(`Le paiement (${data.amount} MAD) dépasse le reste dû (${remaining.toFixed(2)} MAD).`);
    }
    DocumentRepository.addPayment(data);
  },
  convertBLToInvoice(deliveryNoteId) {
    return DocumentRepository.convertToInvoice(deliveryNoteId);
  },
  getPayments(documentId) {
    return DocumentRepository.getPayments(documentId);
  }
};
const stmtRevenue = db.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN date(d.date) = date('now') THEN d.total_incl_tax ELSE 0 END), 0) AS revenue_today,
    COALESCE(SUM(CASE WHEN d.date >= date('now', '-7 days') THEN d.total_incl_tax ELSE 0 END), 0) AS revenue_week,
    COALESCE(SUM(CASE WHEN strftime('%Y-%m', d.date) = strftime('%Y-%m', 'now') THEN d.total_incl_tax ELSE 0 END), 0) AS revenue_month,
    COUNT(CASE WHEN date(d.date) = date('now') THEN 1 END) AS sales_count_today,
    COUNT(CASE WHEN strftime('%Y-%m', d.date) = strftime('%Y-%m', 'now') THEN 1 END) AS sales_count_month
  FROM documents d
  WHERE d.type = 'INVOICE' AND d.status != 'CANCELLED'
`);
const stmtMargin = db.prepare(`
  SELECT COALESCE(SUM((di.unit_price - p.purchase_price) * di.quantity * (1 - di.discount/100.0)), 0) AS gross_margin_month
  FROM document_items di
  JOIN documents d ON d.id = di.document_id
  JOIN products p ON p.id = di.product_id
  WHERE d.type = 'INVOICE'
    AND d.status != 'CANCELLED'
    AND strftime('%Y-%m', d.date) = strftime('%Y-%m', 'now')
`);
const stmtStockValue = db.prepare(`
  SELECT COALESCE(SUM(
    (SELECT COALESCE(SUM(CASE WHEN sm.type='IN' THEN sm.quantity ELSE -sm.quantity END), 0) FROM stock_movements sm WHERE sm.product_id = p.id) * p.purchase_price
  ), 0) AS total_stock_value
  FROM products p WHERE p.status = 'ACTIVE'
`);
const stmtUnpaid = db.prepare(`
  SELECT COALESCE(SUM(d.total_incl_tax - COALESCE(
    (SELECT SUM(pay.amount) FROM payments pay WHERE pay.document_id = d.id), 0
  )), 0) AS unpaid_total
  FROM documents d
  WHERE d.type = 'INVOICE' AND d.status IN ('UNPAID', 'PARTIAL')
`);
const stmtTopProducts = db.prepare(`
  SELECT di.product_id, p.designation, p.reference,
    SUM(di.quantity) AS total_qty,
    SUM(di.total) AS total_revenue
  FROM document_items di
  JOIN documents d ON d.id = di.document_id
  JOIN products p ON p.id = di.product_id
  WHERE d.type = 'INVOICE'
    AND d.status != 'CANCELLED'
    AND strftime('%Y-%m', d.date) = strftime('%Y-%m', 'now')
  GROUP BY di.product_id
  ORDER BY total_qty DESC
  LIMIT 5
`);
const stmtTopClients = db.prepare(`
  SELECT d.entity_id AS customer_id, c.name,
    SUM(d.total_incl_tax) AS total_revenue,
    COUNT(*) AS invoice_count
  FROM documents d
  JOIN customers c ON c.id = d.entity_id
  WHERE d.type = 'INVOICE'
    AND d.status != 'CANCELLED'
    AND strftime('%Y-%m', d.date) = strftime('%Y-%m', 'now')
  GROUP BY d.entity_id
  ORDER BY total_revenue DESC
  LIMIT 5
`);
const stmtLowStock = db.prepare(`
  SELECT p.id, p.reference, p.designation, p.min_stock,
    COALESCE(SUM(CASE WHEN sm.type='IN' THEN sm.quantity ELSE -sm.quantity END), 0) AS current_stock
  FROM products p
  LEFT JOIN stock_movements sm ON sm.product_id = p.id
  WHERE p.status = 'ACTIVE'
  GROUP BY p.id
  HAVING current_stock <= p.min_stock
  ORDER BY current_stock ASC
  LIMIT 20
`);
const stmtUpcomingDue = db.prepare(`
  SELECT d.id, d.document_number, c.name AS customer_name, d.due_date,
    (d.total_incl_tax - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.document_id = d.id), 0)) AS remaining,
    CAST(julianday(d.due_date) - julianday('now') AS INTEGER) AS days_left
  FROM documents d
  JOIN customers c ON c.id = d.entity_id
  WHERE d.type = 'INVOICE'
    AND d.status IN ('UNPAID', 'PARTIAL')
    AND d.due_date IS NOT NULL
    AND julianday(d.due_date) - julianday('now') <= ?
  ORDER BY d.due_date ASC
  LIMIT 10
`);
const DashboardRepository = {
  getStats() {
    const revenue = stmtRevenue.get();
    const margin = stmtMargin.get();
    const stockVal = stmtStockValue.get();
    const unpaid = stmtUnpaid.get();
    return {
      revenue_today: revenue.revenue_today,
      revenue_week: revenue.revenue_week,
      revenue_month: revenue.revenue_month,
      sales_count_today: revenue.sales_count_today,
      sales_count_month: revenue.sales_count_month,
      gross_margin_month: margin.gross_margin_month,
      total_stock_value: stockVal.total_stock_value,
      unpaid_total: unpaid.unpaid_total
    };
  },
  getTopProducts() {
    return stmtTopProducts.all();
  },
  getTopClients() {
    return stmtTopClients.all();
  },
  getLowStockAlerts() {
    return stmtLowStock.all();
  },
  getUpcomingDues(daysAhead = 30) {
    return stmtUpcomingDue.all(daysAhead);
  }
};
const BackupService = {
  /**
   * Copie le fichier .db SQLite vers un dossier de destination.
   * SQLite en mode WAL permet de copier à chaud (pas besoin d'arrêter la DB).
   */
  async backup(destinationDir) {
    const userDataPath2 = electron.app.getPath("userData");
    const dbPath2 = path.join(userDataPath2, "stocklocal.db");
    const backupDir = destinationDir ?? path.join(userDataPath2, "backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupName = `stocklocal-backup-${timestamp}.db`;
    const backupPath = path.join(backupDir, backupName);
    fs.copyFileSync(dbPath2, backupPath);
    const backups = fs.readdirSync(backupDir).filter((f) => f.startsWith("stocklocal-backup-") && f.endsWith(".db")).sort().reverse();
    if (backups.length > 10) {
      for (const old of backups.slice(10)) {
        fs.unlinkSync(path.join(backupDir, old));
      }
    }
    console.log(`[Backup] Sauvegarde créée : ${backupPath}`);
    return backupPath;
  },
  /**
   * Planifie une sauvegarde automatique quotidienne.
   * Doit être appelé une seule fois au démarrage.
   */
  scheduleAutoBackup() {
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1e3;
    setTimeout(async () => {
      await this.backup();
      setInterval(() => this.backup(), TWENTY_FOUR_HOURS);
    }, 60 * 1e3);
    console.log("[Backup] Sauvegarde automatique planifiée (toutes les 24h).");
  },
  /**
   * Retourne la liste des sauvegardes disponibles.
   */
  listBackups() {
    const userDataPath2 = electron.app.getPath("userData");
    const backupDir = path.join(userDataPath2, "backups");
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir).filter((f) => f.startsWith("stocklocal-backup-") && f.endsWith(".db")).map((f) => {
      const fullPath = path.join(backupDir, f);
      const stats = fs.statSync(fullPath);
      return {
        name: f,
        path: fullPath,
        date: stats.mtime.toLocaleString("fr-MA"),
        sizeKB: Math.round(stats.size / 1024)
      };
    }).sort((a, b) => b.date.localeCompare(a.date));
  }
};
const __dirname$1 = path$1.dirname(node_url.fileURLToPath(typeof document === "undefined" ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === "SCRIPT" && _documentCurrentScript.src || new URL("main.js", document.baseURI).href));
process.env.APP_ROOT = path$1.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path$1.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path$1.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path$1.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function createWindow() {
  win = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    icon: path$1.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path$1.join(__dirname$1, "preload.mjs"),
      // Vite compile preload.ts en preload.mjs
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path$1.join(RENDERER_DIST, "index.html"));
  }
}
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
    win = null;
  }
});
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
electron.app.whenReady().then(() => {
  createWindow();
  BackupService.scheduleAutoBackup();
  electron.ipcMain.handle("products:search", async (_, query) => {
    return ProductService.searchProducts(query);
  });
  electron.ipcMain.handle("products:create", async (_, productData) => {
    try {
      return { success: true, data: ProductService.createProduct(productData) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("stock:getHistory", async (_, productId) => {
    return StockMovementRepository.getHistory(productId);
  });
  electron.ipcMain.handle("stock:getLevel", async (_, productId) => {
    return StockMovementRepository.getStockLevel(productId);
  });
  electron.ipcMain.handle("stock:addEntry", async (_, data) => {
    try {
      return { success: true, data: StockService.addStockEntry(data) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("stock:addExit", async (_, data) => {
    try {
      return { success: true, data: StockService.addStockExit(data) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("clients:search", async (_, query) => {
    return ClientService.searchClients(query);
  });
  electron.ipcMain.handle("clients:create", async (_, data) => {
    try {
      return { success: true, data: ClientService.createClient(data) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("clients:update", async (_, { id, data }) => {
    try {
      return { success: true, data: ClientService.updateClient(id, data) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("clients:getHistory", async (_, customerId) => {
    return ClientService.getClientHistory(customerId);
  });
  electron.ipcMain.handle("clients:addDebt", async (_, { customerId, amount, description, userId }) => {
    try {
      return { success: true, data: ClientService.addDebt(customerId, amount, description, userId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("clients:addPayment", async (_, { customerId, amount, description, userId }) => {
    try {
      return { success: true, data: ClientService.recordPayment(customerId, amount, description, userId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("documents:getAll", async (_, type) => {
    return DocumentService.getDocuments(type);
  });
  electron.ipcMain.handle("documents:search", async (_, { type, query }) => {
    return DocumentService.getDocuments(type, query);
  });
  electron.ipcMain.handle("documents:getById", async (_, id) => {
    return DocumentService.getDocument(id);
  });
  electron.ipcMain.handle("documents:create", async (_, data) => {
    try {
      return { success: true, data: DocumentService.createDocument(data) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("documents:addPayment", async (_, data) => {
    try {
      DocumentService.addPayment(data);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("documents:convertBL", async (_, deliveryNoteId) => {
    try {
      return { success: true, data: DocumentService.convertBLToInvoice(deliveryNoteId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("documents:getPayments", async (_, documentId) => {
    return DocumentService.getPayments(documentId);
  });
  electron.ipcMain.handle("dashboard:getStats", async () => {
    return DashboardRepository.getStats();
  });
  electron.ipcMain.handle("dashboard:getTopProducts", async () => {
    return DashboardRepository.getTopProducts();
  });
  electron.ipcMain.handle("dashboard:getTopClients", async () => {
    return DashboardRepository.getTopClients();
  });
  electron.ipcMain.handle("dashboard:getLowStock", async () => {
    return DashboardRepository.getLowStockAlerts();
  });
  electron.ipcMain.handle("dashboard:getUpcomingDues", async (_, days) => {
    return DashboardRepository.getUpcomingDues(days);
  });
  electron.ipcMain.handle("backup:now", async (_, destinationDir) => {
    try {
      const filePath = await BackupService.backup(destinationDir);
      return { success: true, path: filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("backup:list", async () => {
    return BackupService.listBackups();
  });
});
exports.MAIN_DIST = MAIN_DIST;
exports.RENDERER_DIST = RENDERER_DIST;
exports.VITE_DEV_SERVER_URL = VITE_DEV_SERVER_URL;
