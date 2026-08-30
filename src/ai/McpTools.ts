import { z } from 'zod';
import { ProductService } from '../services/ProductService';
import { StockLedgerService } from '../services/StockLedgerService';
import { ClientService } from '../services/ClientService';
import { DocumentService } from '../services/DocumentService';
import { ProductRepository } from '../repositories/ProductRepository';
import { ClientRepository } from '../repositories/ClientRepository';
import { DocumentRepository } from '../repositories/DocumentRepository';
import { DashboardRepository } from '../repositories/DashboardRepository';
import { AuditService } from '../services/AuditService';
import { GlobalSettingsService } from '../services/GlobalSettingsService';

/**
 * ─── Registre d'outils MCP ─────────────────────────────────────────────────────
 *
 * Couche TRÈS fine par-dessus les services existants — aucune logique métier
 * dupliquée. Chaque outil valide ses paramètres avec Zod (même rigueur que les
 * handlers IPC), puis délègue au service correspondant.
 *
 * Les outils sont classés par niveau de risque :
 *   - KIND_READ       : lecture pure, exécutée immédiatement
 *   - KIND_WRITE      : écriture non destructive, exécutée après confirmation UI
 *   - KIND_DESTRUCTIVE: suppression/annulation, exécutée après confirmation UI
 *
 * Toute exécution d'outil d'ÉCRITURE/DESTRUCTION est journalisée dans
 * AuditService avec la mention explicite « assistant IA ».
 * ──────────────────────────────────────────────────────────────────────────────
 */

export type ToolKind = 'READ' | 'WRITE' | 'DESTRUCTIVE';

export interface McpToolDef {
  name: string;
  description: string;
  kind: ToolKind;
  inputSchema: z.ZodTypeAny;
  execute: (params: unknown) => unknown | Promise<unknown>;
}

export interface McpToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  kind?: ToolKind;
  /** Outil destructif appelé sans confirmation → le client doit ré-invoquer avec confirmed:true. */
  needsConfirmation?: boolean;
}

// ─── Rate-limit partagé (appels d'outils / minute) ─────────────────────────────
// Un compteur unique en mémoire, utilisé par l'app (chat intégré) ET le serveur
// MCP standalone : impossible de contourner la limite en passant par l'un ou
// l'autre chemin.
const toolCallCounts: Record<string, number> = {};
function minuteKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
}
export function assertWithinRateLimit(limit: number): void {
  const key = minuteKey();
  const count = (toolCallCounts[key] ?? 0) + 1;
  toolCallCounts[key] = count;
  if (count > limit) {
    throw new Error(`Limite de débit atteinte : maximum ${limit} appels d'outils par minute. Patientez une minute.`);
  }
}

/** Réinitialise le compteur de rate-limit (utile pour des tests déterministes). */
export function resetRateLimitCounter(): void {
  for (const key of Object.keys(toolCallCounts)) delete toolCallCounts[key];
}

// ─── Schémas de validation des paramètres d'outils ─────────────────────────────

const ProductCreateToolSchema = z.object({
  reference: z.string().min(1),
  designation: z.string().min(1),
  description: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  unit: z.string().optional(),
  purchase_price: z.number().min(0),
  selling_price: z.number().min(0),
  wholesale_price: z.number().min(0).optional(),
  min_stock: z.number().min(0).optional(),
  vat_rate: z.number().min(0).max(100).optional(),
});

const ProductUpdateToolSchema = z.object({
  id: z.string().min(1),
  reference: z.string().min(1).optional(),
  designation: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  purchase_price: z.number().min(0).optional(),
  selling_price: z.number().min(0).optional(),
  wholesale_price: z.number().min(0).optional(),
  min_stock: z.number().min(0).optional(),
  vat_rate: z.number().min(0).max(100).optional(),
});

const StockMovementToolSchema = z.object({
  product_id: z.string().min(1),
  movement_type: z.enum(['PURCHASE_IN', 'SALE_OUT', 'RETURN_IN', 'RETURN_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE_OUT', 'LOSS_OUT', 'OPENING_BALANCE', 'TRANSFER_IN', 'TRANSFER_OUT']),
  quantity: z.number().positive(),
  unit_price: z.number().min(0).optional(),
  reference_doc: z.string().optional().nullable(),
  document_id: z.string().optional().nullable(),
  supplier_id: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const DocumentCreateToolSchema = z.object({
  type: z.enum(['QUOTE', 'DELIVERY_NOTE', 'INVOICE', 'CREDIT_NOTE']),
  entity_id: z.string().max(64),
  date: z.string().min(1),
  due_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    product_id: z.string().min(1),
    quantity: z.number().positive(),
    unit_price: z.number().min(0),
    discount: z.number().min(0).max(100).optional(),
  })).min(1),
});

const PaymentToolSchema = z.object({
  document_id: z.string().min(1),
  amount: z.number().positive(),
  payment_method: z.enum(['CASH', 'CHECK', 'TRANSFER']),
  reference: z.string().optional().nullable(),
});

const ClientDebtToolSchema = z.object({
  customer_id: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional().nullable(),
});

const ClientPaymentToolSchema = z.object({
  customer_id: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional().nullable(),
});

const IdOnlyToolSchema = z.object({ id: z.string().min(1) });

// ─── Outils ────────────────────────────────────────────────────────────────────

export const MCP_TOOLS: Record<string, McpToolDef> = {
  // ═══ Lecture ═══
  list_products: {
    name: 'list_products',
    description: 'Liste les produits (référence, désignation, prix, stock). Paramètre optionnel : query (recherche).',
    kind: 'READ',
    inputSchema: z.object({ query: z.string().max(200).optional(), limit: z.number().min(1).max(500).optional() }).default({}),
    execute: (params) => {
      const p = params as { query?: string; limit?: number };
      return ProductService.searchProducts(p.query ?? '', p.limit ?? 50).map((prod) => ({
        id: prod.id,
        reference: prod.reference,
        designation: prod.designation,
        selling_price: prod.selling_price,
        purchase_price: prod.purchase_price,
        stock: StockLedgerService.getStockLevel(prod.id),
        status: prod.status,
      }));
    },
  },

  get_stock: {
    name: 'get_stock',
    description: 'Consulte le stock d\'un produit : niveau actuel, coût moyen, historique récent.',
    kind: 'READ',
    inputSchema: z.object({ product_id: z.string().min(1) }),
    execute: (params) => {
      const p = params as { product_id: string };
      return {
        product_id: p.product_id,
        level: StockLedgerService.getStockLevel(p.product_id),
        average_cost: StockLedgerService.getAverageCost(p.product_id),
        recent_movements: StockLedgerService.getHistory(p.product_id, 10),
      };
    },
  },

  list_clients: {
    name: 'list_clients',
    description: 'Liste les clients (nom, téléphone, solde de crédit, plafond). Paramètre optionnel : query.',
    kind: 'READ',
    inputSchema: z.object({ query: z.string().max(200).optional() }).default({}),
    execute: (params) => {
      const p = params as { query?: string };
      return ClientService.searchClients(p.query ?? '');
    },
  },

  get_client_credit: {
    name: 'get_client_credit',
    description: 'Consulte le solde de crédit d\'un client et son historique.',
    kind: 'READ',
    inputSchema: z.object({ customer_id: z.string().min(1) }),
    execute: (params) => {
      const p = params as { customer_id: string };
      const balance = ClientRepository.getBalance(p.customer_id);
      return {
        customer_id: p.customer_id,
        balance,
        history: ClientService.getClientHistory(p.customer_id).slice(0, 20),
      };
    },
  },

  list_recent_documents: {
    name: 'list_recent_documents',
    description: 'Liste les factures/devis/BL récents. Paramètre : type (INVOICE, QUOTE, DELIVERY_NOTE, CREDIT_NOTE) et limit.',
    kind: 'READ',
    inputSchema: z.object({
      type: z.enum(['INVOICE', 'QUOTE', 'DELIVERY_NOTE', 'CREDIT_NOTE']),
      limit: z.number().min(1).max(100).optional(),
    }).default({ type: 'INVOICE' }),
    execute: (params) => {
      const p = params as { type: 'INVOICE' | 'QUOTE' | 'DELIVERY_NOTE' | 'CREDIT_NOTE'; limit?: number };
      return DocumentRepository.getAll(p.type, p.limit ?? 20, 0);
    },
  },

  get_dashboard: {
    name: 'get_dashboard',
    description: 'Retourne les indicateurs clés du tableau de bord : CA, marge, valeur stock, impayés, alertes.',
    kind: 'READ',
    inputSchema: z.object({}).default({}),
    execute: () => {
      const stats = DashboardRepository.getStats();
      const alerts = DashboardRepository.getAlertSummary();
      return { stats, alerts };
    },
  },

  // ═══ Écriture ═══
  create_product: {
    name: 'create_product',
    description: 'Crée un produit. Nécessite confirmation utilisateur (écriture).',
    kind: 'WRITE',
    inputSchema: ProductCreateToolSchema,
    execute: (params) => {
      const p = params as z.infer<typeof ProductCreateToolSchema>;
      return ProductService.createProduct({
        reference: p.reference,
        designation: p.designation,
        description: p.description ?? undefined,
        barcode: p.barcode ?? undefined,
        unit: p.unit ?? 'PIÈCE',
        purchase_price: p.purchase_price,
        selling_price: p.selling_price,
        wholesale_price: p.wholesale_price ?? 0,
        min_stock: p.min_stock ?? 0,
        vat_rate: p.vat_rate ?? 20,
        status: 'ACTIVE',
      });
    },
  },

  update_product: {
    name: 'update_product',
    description: 'Modifie un produit (prix, désignation, stock min...). Nécessite confirmation.',
    kind: 'WRITE',
    inputSchema: ProductUpdateToolSchema,
    execute: (params) => {
      const p = params as z.infer<typeof ProductUpdateToolSchema>;
      const existing = ProductRepository.findById(p.id);
      if (!existing) throw new Error('Produit introuvable.');
      return ProductService.updateProduct(p.id, {
        reference: p.reference ?? existing.reference,
        designation: p.designation ?? existing.designation,
        description: p.description ?? existing.description ?? undefined,
        purchase_price: p.purchase_price ?? existing.purchase_price,
        selling_price: p.selling_price ?? existing.selling_price,
        wholesale_price: p.wholesale_price ?? existing.wholesale_price,
        min_stock: p.min_stock ?? existing.min_stock,
        vat_rate: p.vat_rate ?? existing.vat_rate,
        status: existing.status,
      });
    },
  },

  create_stock_movement: {
    name: 'create_stock_movement',
    description: 'Crée un mouvement de stock (entrée/sortie/ajustement) via StockLedgerService. Nécessite confirmation.',
    kind: 'WRITE',
    inputSchema: StockMovementToolSchema,
    execute: (params) => {
      const p = params as z.infer<typeof StockMovementToolSchema>;
      return StockLedgerService.recordMovement({
        product_id: p.product_id,
        movement_type: p.movement_type,
        quantity: p.quantity,
        unit_price: p.unit_price,
        reference_doc: p.reference_doc ?? undefined,
        document_id: p.document_id ?? undefined,
        supplier_id: p.supplier_id ?? undefined,
        notes: p.notes ?? undefined,
      });
    },
  },

  create_document: {
    name: 'create_document',
    description: 'Crée une facture/devis/BL/avoir. Nécessite confirmation. Le stock est géré automatiquement pour INVOICE/DELIVERY_NOTE.',
    kind: 'WRITE',
    inputSchema: DocumentCreateToolSchema,
    execute: (params) => {
      const p = params as z.infer<typeof DocumentCreateToolSchema>;
      return DocumentService.createDocument({
        type: p.type,
        entity_id: p.entity_id,
        date: p.date,
        due_date: p.due_date ?? undefined,
        notes: p.notes ?? undefined,
        items: p.items.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount: item.discount ?? 0,
        })),
      });
    },
  },

  add_payment: {
    name: 'add_payment',
    description: 'Ajoute un paiement à un document. Nécessite confirmation.',
    kind: 'WRITE',
    inputSchema: PaymentToolSchema,
    execute: (params) => {
      const p = params as z.infer<typeof PaymentToolSchema>;
      DocumentService.addPayment({
        document_id: p.document_id,
        amount: p.amount,
        payment_method: p.payment_method,
        reference: p.reference ?? undefined,
      });
      return { success: true };
    },
  },

  add_client_debt: {
    name: 'add_client_debt',
    description: 'Ajoute une dette (vente à crédit) à un client. Nécessite confirmation.',
    kind: 'WRITE',
    inputSchema: ClientDebtToolSchema,
    execute: (params) => {
      const p = params as z.infer<typeof ClientDebtToolSchema>;
      return ClientService.addDebt(p.customer_id, p.amount, p.description ?? 'Vente à crédit (assistant IA)');
    },
  },

  add_client_payment: {
    name: 'add_client_payment',
    description: 'Enregistre un paiement client. Nécessite confirmation.',
    kind: 'WRITE',
    inputSchema: ClientPaymentToolSchema,
    execute: (params) => {
      const p = params as z.infer<typeof ClientPaymentToolSchema>;
      return ClientService.recordPayment(p.customer_id, p.amount, p.description ?? 'Paiement (assistant IA)');
    },
  },

  // ═══ Destructif ═══
  archive_product: {
    name: 'archive_product',
    description: 'Archive un produit (le masque de la vente, conserve l\'historique). Action destructive — confirmation requise.',
    kind: 'DESTRUCTIVE',
    inputSchema: IdOnlyToolSchema,
    execute: (params) => {
      const p = params as { id: string };
      ProductService.archiveProduct(p.id);
      return { success: true };
    },
  },

  delete_product: {
    name: 'delete_product',
    description: 'Supprime définitivement un produit SI aucun historique. Bloqué par EntityCannotBeDeletedError sinon. Action destructive — confirmation requise.',
    kind: 'DESTRUCTIVE',
    inputSchema: IdOnlyToolSchema,
    execute: (params) => {
      const p = params as { id: string };
      ProductService.deleteProduct(p.id);
      return { success: true };
    },
  },
};

/**
 * Résumé lisible d'une action pour l'audit (jamais de valeurs sensibles).
 */
function describeParams(toolName: string, params: Record<string, unknown>): string {
  if (toolName === 'delete_product' || toolName === 'archive_product') return `${toolName} — id=${String(params.id ?? '')}`;
  if (toolName === 'create_product') return `Création produit : ${String(params.designation ?? params.reference ?? '')}`;
  if (toolName === 'update_product') return `Modification produit id=${String(params.id ?? '')}`;
  if (toolName === 'create_document') return `Création document ${String(params.type ?? '')}`;
  if (toolName === 'create_stock_movement') return `Mouvement de stock ${String(params.movement_type ?? '')} (qty ${String(params.quantity ?? '')})`;
  if (toolName === 'add_payment') return `Paiement sur document ${String(params.document_id ?? '')}`;
  if (toolName === 'add_client_debt') return `Dette client ${String(params.customer_id ?? '')}`;
  if (toolName === 'add_client_payment') return `Paiement client ${String(params.customer_id ?? '')}`;
  return toolName;
}

/**
 * Exécute un outil MCP après validation Zod.
 *
 * GARDE-FOUS INTÉGRÉS (quel que soit l'appelant — chat intégré OU serveur MCP
 * externe) :
 *   - Rate-limit : chaque appel d'outil est compté (limite lue depuis la config).
 *   - WRITE / DESTRUCTIVE : exigent `confirmed: true`. Sinon, renvoient
 *     `needsConfirmation: true` (le client externe doit ré-invoquer avec
 *     confirmed:true). Les outils READ s'exécutent immédiatement.
 *   - Audit : toute exécution WRITE/DESTRUCTIVE confirmée est journalisée dans
 *     AuditService avec mention de la provenance (assistant IA, interne/externe).
 */
export function executeMcpTool(
  name: string,
  params: unknown,
  source: 'integrated' | 'external' = 'external',
): McpToolResult {
  const tool = MCP_TOOLS[name];
  if (!tool) {
    return { success: false, error: `Outil inconnu : ${name}` };
  }

  try {
    // Rate-limit : tous les appels d'outils passent par le même compteur.
    assertWithinRateLimit(GlobalSettingsService.getAll().ai_rate_limit_per_min);

    const parsed = tool.inputSchema.parse(params ?? {}) as Record<string, unknown>;

    if (tool.kind === 'READ') {
      const data = tool.execute(parsed);
      return { success: true, data, kind: tool.kind };
    }

    // WRITE / DESTRUCTIVE : confirmation explicite requise.
    // `confirmed` est lu depuis les paramètres bruts (le schéma Zod le strippe).
    const raw = (params ?? {}) as Record<string, unknown>;
    const confirmed = raw['confirmed'] === true;
    if (!confirmed) {
      return {
        success: false,
        needsConfirmation: true,
        kind: tool.kind,
        error: `Action ${tool.kind === 'DESTRUCTIVE' ? 'destructive' : "d'écriture"} : confirmation requise. Ré-invoquez avec confirmed:true.`,
        data: { confirmationRequired: true, toolName: name, params: parsed },
      };
    }

    // Confirmée : exécuter puis journaliser dans l'audit.
    const data = tool.execute(parsed);
    const origin = source === 'external' ? ' — connexion externe (client MCP)' : '';
    AuditService.log(
      `AI_${name.toUpperCase()}`,
      'system',
      'ai-assistant',
      `Action « ${describeParams(name, parsed)} » exécutée par l'assistant IA${origin}.`,
      undefined,
      data,
    );
    return { success: true, data, kind: tool.kind };
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      const first = error.errors[0];
      return { success: false, error: `${first?.path.join('.') ?? 'paramètre'} : ${first?.message}` };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/** Retourne la liste des définitions d'outils pour le prompt LLM (function calling). */
export function getToolDefinitions(): Array<{ name: string; description: string; input_schema: unknown }> {
  return Object.values(MCP_TOOLS).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}
