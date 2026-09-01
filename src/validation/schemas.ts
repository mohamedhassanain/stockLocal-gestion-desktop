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
  credit_limit: z.number().min(0, 'Le plafond de crédit ne peut pas être négatif.').default(0),
  category: z.enum(['DÉTAIL', 'GROSSISTE', 'VIP']).default('DÉTAIL'),
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

// entity_id peut être vide : les ventes comptoir (POS) n'ont pas de client.
// La validation client est laissée au service (DocumentService l'autorise).
export const SaleSchema = z.object({
  type: z.enum(['QUOTE', 'DELIVERY_NOTE', 'INVOICE', 'CREDIT_NOTE']),
  entity_id: z.string().max(64),
  date: z.string().min(1),
  due_date: z.string().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  items: z.array(SaleItemSchema).min(1, 'Le document doit contenir au moins une ligne.'),
});

/** Schéma de modification d'un document (client, date, lignes, notes). */
export const DocumentUpdateSchema = z.object({
  entity_id: z.string().max(64),
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
  unit_price: z.number().min(0).default(0),
  reference_doc: z.string().max(100).optional().nullable(),
  supplier_id: z.string().max(64).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const StockExitSchema = z.object({
  product_id: z.string().min(1).max(64),
  quantity: z.number().positive('La quantité doit être supérieure à 0.'),
  unit_price: z.number().min(0).default(0),
  // Type de sortie libre : défini par l'utilisateur dans Paramètres (Vente, Casse, Perte, Don…).
  // Restreint à une chaîne courte pour éviter les valeurs aberrantes.
  exitType: z.string().min(1, 'Le type de sortie est obligatoire.').max(50),
  notes: z.string().max(500).optional().nullable(),
});

export const InventorySchema = z.object({
  product_id: z.string().min(1).max(64),
  unit_price: z.number().min(0).optional(),
  notes: z.string().max(500).optional().nullable(),
});

// ─── Inventaire : versioning / correction (P1) ───────────────────────────────

export const InventoryCreateVersionSchema = z.object({
  sessionId: z.string().min(1).max(64),
  note: z.string().max(500).optional().nullable(),
});

export const InventoryGetVersionsSchema = z.object({
  sessionId: z.string().min(1).max(64),
});

export const InventoryRestoreVersionSchema = z.object({
  sessionId: z.string().min(1).max(64),
  versionId: z.string().min(1).max(64),
  note: z.string().max(500).optional().nullable(),
});

export const InventoryCorrectionSchema = z.object({
  sessionId: z.string().min(1).max(64),
  corrections: z.record(z.string().min(1).max(64), z.number().min(0, 'Une quantité corrigée ne peut pas être négative.')),
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

export const PurchaseReceiveSchema = z.object({
  id: z.string().min(1).max(64),
  receivedItems: z.array(z.object({
    item_id: z.string().min(1).max(64),
    received_qty: z.number().min(0, 'La quantité reçue ne peut pas être négative.'),
  })).max(1000).optional(),
});

// ─── Avoir / Retour ──────────────────────────────────────────────────────────

export const CreditNoteCreateSchema = z.object({
  invoiceId: z.string().min(1).max(64),
  returnItems: z.array(z.object({
    product_id: z.string().min(1).max(64),
    quantity: z.number().positive('La quantité retournée doit être supérieure à 0.'),
  })).max(500).optional(),
  reason: z.string().max(500).optional(),
});

// ─── Crédits clients / fournisseurs (نسيئة) ──────────────────────────────────

export const ClientDebtSchema = z.object({
  customerId: z.string().min(1).max(64),
  amount: z.number().positive('Le montant doit être supérieur à 0.'),
  description: z.string().max(500).optional().nullable(),
});

export const SupplierDebtSchema = z.object({
  supplierId: z.string().min(1).max(64),
  amount: z.number().positive('Le montant doit être supérieur à 0.'),
  description: z.string().max(500).optional().nullable(),
});

// ─── Catalogue (catégories, remises, conversions) ────────────────────────────

export const CategorySchema = z.object({
  name: z.string().min(1, 'Le nom de la catégorie est obligatoire.').max(100),
  description: z.string().max(500).optional().nullable(),
});

export const SubcategorySchema = z.object({
  name: z.string().min(1, 'Le nom de la sous-catégorie est obligatoire.').max(100),
  description: z.string().max(500).optional().nullable(),
});

export const VolumeDiscountSchema = z.object({
  name: z.string().min(1, 'Le nom de la règle est obligatoire.').max(100),
  min_qty: z.number().min(0),
  max_qty: z.number().min(0).optional().nullable(),
  discount_pct: z.number().min(0).max(100, 'La remise doit être entre 0 et 100%.'),
});

export const UnitConversionSchema = z.object({
  from_unit: z.string().min(1, "L'unité source est obligatoire.").max(20),
  to_unit: z.string().min(1, "L'unité cible est obligatoire.").max(20),
  factor: z.number().positive('Le facteur doit être supérieur à 0.'),
  product_id: z.string().max(64).optional().nullable(),
});

// ─── Paramètres ──────────────────────────────────────────────────────────────

export const CompanySettingsSchema = z.object({
  name: z.string().max(200).optional(),
  tagline: z.string().max(200).optional(),
  ice: z.string().max(30).optional(),
  rc: z.string().max(30).optional(),
  if_: z.string().max(30).optional(),
  patente: z.string().max(30).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().max(200).optional(),
  logo_path: z.string().max(500).optional(),
  show_logo_on_documents: z.boolean().optional(),
  show_company_name_on_documents: z.boolean().optional(),
});

export const GlobalSettingsSchema = z.object({
  low_stock_threshold_multiplier: z.number().min(0).optional(),
  critical_stock_threshold: z.number().min(0).optional(),
  show_low_stock_alerts: z.boolean().optional(),
  show_overdue_alerts: z.boolean().optional(),
  default_vat_rate: z.number().min(0).max(100).optional(),
  pos_auto_focus_barcode: z.boolean().optional(),
  auto_backup_enabled: z.boolean().optional(),
  auto_backup_frequency: z.enum(['on_close', 'daily', 'weekly', 'monthly']).optional(),
  max_backups: z.number().int().min(1).max(50).optional(),
  inactive_product_days: z.number().min(0).optional(),
  show_inactive_product_alerts: z.boolean().optional(),
  product_units: z.array(z.string().max(20)).optional(),
  stock_exit_types: z.array(z.string().min(1).max(50)).optional(),
});

// ─── Assistant IA (electron/ipc/ai.ipc.ts) ───────────────────────────────────
// P0 — Validation stricte de TOUTE frontière AI. Jamais de `input as ...` :
// le renderer ne fournit qu'un objet brut, validé par Zod avant le service.

export const AiProviderSchema = z.enum(['anthropic', 'openai', 'openai-compatible', 'custom']);

export const AiSaveConfigSchema = z.object({
  provider: AiProviderSchema,
  providerName: z.string().max(100).optional(),
  baseUrl: z.string().url('URL de base invalide.').max(500).optional(),
  apiKey: z.string().max(1000).optional(),
  model: z.string().max(200).optional(),
  expiryMode: z.enum(['none', 'date']).optional(),
  expiryDate: z.string().max(50).optional(),
  rateLimitPerMin: z.number().int().min(1).max(1000).optional(),
});

export const AiTestConnectionSchema = z.object({
  provider: AiProviderSchema,
  baseUrl: z.string().url('URL de base invalide.').max(500).optional(),
  apiKey: z.string().min(1, 'La clé API est obligatoire pour un test de connexion.').max(1000),
  model: z.string().min(1, 'Le modèle est obligatoire pour un test de connexion.').max(200),
});

export const AiChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(100_000, 'Message trop long.'),
});

export const AiChatSchema = z.array(AiChatMessageSchema).min(1, 'Au moins un message est requis.').max(200);

export const AiRequestToolSchema = z.object({
  name: z.string().min(1, 'Le nom de l\'outil est obligatoire.').max(100),
  // Les paramètres d'outil sont un objet arbitraire, mais bornés (anti-doS).
  params: z.record(z.string().max(200), z.unknown()).optional().default({}),
});

export const AiConfirmActionSchema = z.object({
  actionId: z.string().min(1, 'L\'identifiant d\'action est obligatoire.').max(200),
  confirmed: z.boolean(),
});

export const AiMcpConfigFolderSchema = z.enum(['claude', 'cursor', 'kimi']);

// ─── Système / Stockage / Backup / Migration (electron/ipc/system.ipc.ts) ────

/** Chemin de stockage (dataPath) fourni par le renderer. */
export const DataPathSchema = z.string().min(1, 'Le chemin de stockage est obligatoire.').max(500);

/** Chemin de dossier à ouvrir via le shell natif. */
export const FolderPathSchema = z.string().min(1, 'Le chemin du dossier est obligatoire.').max(500);

/** Migration de données : chemins source et destination. */
export const MigrateDataSchema = z.object({
  fromPath: z.string().min(1, 'Le chemin source est obligatoire.').max(500),
  toPath: z.string().min(1, 'Le chemin de destination est obligatoire.').max(500),
});

/** Chemin d'un backup (restore/delete/validate). Le confinement au dossier
 *  backups/ est assuré en aval par validatePathWithinSubDir. */
export const BackupPathSchema = z.string().min(1, 'Le chemin du backup est obligatoire.').max(500);

/** Dossier de destination optionnel pour backup:now. */
export const BackupDestDirSchema = z.string().min(1, 'Le dossier de sauvegarde est obligatoire.').max(500).optional();

/** Chemin d'une ancienne base à migrer. */
export const SourcePathSchema = z.string().min(1, 'Le chemin source est obligatoire.').max(500);

// ─── IDs ─────────────────────────────────────────────────────────────────────

export const IdSchema = z.string().min(1).max(64);

/** Parse et renvoie les données nettoyées, ou lève une erreur lisible en français. */
export function safeParse<S extends z.ZodTypeAny>(schema: S, data: unknown, label: string): z.infer<S> {
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

/** Transforme récursivement `T | null` en `T | undefined` au niveau du type. */
export type NullToUndefined<T> = T extends null
  ? undefined
  : T extends (infer U)[]
    ? NullToUndefined<U>[]
    : T extends object
      ? { [K in keyof T]: NullToUndefined<T[K]> }
      : T;

/** Remplace récursivement `null` par `undefined` (les services exigent `string | undefined`). */
export function nullToUndefined<T>(value: T): NullToUndefined<T> {
  if (value === null) return undefined as unknown as NullToUndefined<T>;
  if (Array.isArray(value)) {
    return value.map(item => nullToUndefined(item)) as unknown as NullToUndefined<T>;
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = nullToUndefined(val);
    }
    return out as unknown as NullToUndefined<T>;
  }
  return value as unknown as NullToUndefined<T>;
}
