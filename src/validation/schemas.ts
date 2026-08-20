import { z } from 'zod';

/**
 * Schémas Zod pour la validation des entrées (§12).
 *
 * Règle : on ne fait JAMAIS confiance aux données venant du renderer.
 * Chaque payload IPC critique passe par un schéma avant d'atteindre le service.
 */

// ─── Produits ────────────────────────────────────────────────────────────────

export const ProductCreateSchema = z.object({
  reference: z.string().min(1, 'La référence est obligatoire.').max(50),
  designation: z.string().min(1, 'La désignation est obligatoire.').max(200),
  description: z.string().max(1000).optional().nullable(),
  category_id: z.string().max(64).optional().nullable(),
  subcategory_id: z.string().max(64).optional().nullable(),
  barcode: z.string().max(64).optional().nullable(),
  image_path: z.string().max(500).optional().nullable(),
  unit: z.string().max(20).optional(),
  purchase_price: z.number().min(0, 'Le prix d\'achat ne peut pas être négatif.'),
  selling_price: z.number().min(0, 'Le prix de vente ne peut pas être négatif.'),
  wholesale_price: z.number().min(0, 'Le prix de gros ne peut pas être négatif.'),
  min_stock: z.number().min(0),
  max_stock: z.number().min(0).optional(),
  vat_rate: z.number().min(0).max(100).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'DISABLED']).default('ACTIVE'),
});

export const ProductUpdateSchema = ProductCreateSchema.partial();

// ─── Clients ─────────────────────────────────────────────────────────────────

export const ClientCreateSchema = z.object({
  name: z.string().min(1, 'Le nom du client est obligatoire.').max(200),
  phone: z.string().max(30).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  ice: z.string().max(30).optional().nullable(),
  payment_conditions: z.string().max(200).optional().nullable(),
  credit_limit: z.number().min(0, 'Le plafond de crédit ne peut pas être négatif.').optional(),
  category: z.enum(['DÉTAIL', 'GROSSISTE', 'VIP']).optional(),
});

export const ClientUpdateSchema = ClientCreateSchema.partial();

// ─── Fournisseurs ────────────────────────────────────────────────────────────

export const SupplierCreateSchema = z.object({
  name: z.string().min(1, 'Le nom du fournisseur est obligatoire.').max(200),
  phone: z.string().max(30).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  ice: z.string().max(30).optional().nullable(),
});

export const SupplierUpdateSchema = SupplierCreateSchema.partial();

// ─── Document / Vente ────────────────────────────────────────────────────────

export const SaleItemSchema = z.object({
  product_id: z.string().min(1).max(64),
  quantity: z.number().positive('La quantité doit être supérieure à 0.'),
  unit_price: z.number().min(0, 'Le prix unitaire ne peut pas être négatif.'),
  discount: z.number().min(0).max(100, 'La remise doit être entre 0 et 100%.').optional().default(0),
});

export const SaleSchema = z.object({
  type: z.enum(['QUOTE', 'DELIVERY_NOTE', 'INVOICE']),
  entity_id: z.string().min(1).max(64),
  date: z.string().min(1),
  due_date: z.string().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  items: z.array(SaleItemSchema).min(1, 'Le document doit contenir au moins une ligne.'),
});

export const PaymentSchema = z.object({
  document_id: z.string().min(1).max(64),
  amount: z.number().positive('Le montant du paiement doit être supérieur à 0.'),
  payment_method: z.enum(['CASH', 'CHECK', 'TRANSFER']),
  reference: z.string().max(100).optional().nullable(),
});

// ─── Stock ───────────────────────────────────────────────────────────────────

export const StockEntrySchema = z.object({
  product_id: z.string().min(1).max(64),
  quantity: z.number().positive('La quantité doit être supérieure à 0.'),
  unit_price: z.number().min(0).optional(),
  reference_doc: z.string().max(100).optional().nullable(),
  supplier_id: z.string().max(64).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const StockExitSchema = z.object({
  product_id: z.string().min(1).max(64),
  quantity: z.number().positive('La quantité doit être supérieure à 0.'),
  unit_price: z.number().min(0).optional(),
  exitType: z.enum(['VENTE', 'CASSE', 'PERTE', 'RETOUR']),
  notes: z.string().max(500).optional().nullable(),
});

export const InventorySchema = z.object({
  product_id: z.string().min(1).max(64),
  unit_price: z.number().min(0).optional(),
  notes: z.string().max(500).optional().nullable(),
});

// ─── Achats / Commandes fournisseur ──────────────────────────────────────────

export const PurchaseOrderItemSchema = z.object({
  product_id: z.string().min(1).max(64),
  quantity: z.number().positive(),
  unit_price: z.number().min(0),
});

export const PurchaseSchema = z.object({
  supplier_id: z.string().min(1).max(64),
  expected_date: z.string().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  items: z.array(PurchaseOrderItemSchema).min(1, 'La commande doit contenir au moins une ligne.'),
});

// ─── IDs ─────────────────────────────────────────────────────────────────────

export const IdSchema = z.string().min(1).max(64);

/** Parse et renvoie les données nettoyées, ou lève une erreur lisible en français. */
export function safeParse<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const firstError = result.error.errors[0];
    const message = firstError
      ? `${label} : ${firstError.message}`
      : `${label} : données invalides.`;
    throw new Error(message);
  }
  return result.data;
}
