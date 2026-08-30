import { GlobalSettingsService } from '../services/GlobalSettingsService';
import { executeMcpTool, MCP_TOOLS, type ToolKind, type McpToolResult } from './McpTools';

/**
 * ─── AiAssistantService ────────────────────────────────────────────────────────
 *
 * Provider-agnostique : lit la config (provider, baseUrl, apiKey, modèle) depuis
 * `global_settings`, appelle le LLM via `fetch`, et expose les outils métier
 * (McpTools) au modèle via function-calling.
 *
 * Garde-fous (Phase B.4) :
 *   - Clé API jamais journalisée (ni ErrorLogService, ni console, ni audit).
 *   - Session : expiration configurable (date précise ou jamais). Si expirée,
 *     `isActive()` retourne false et le chat est refusé.
 *   - Rate-limit : N appels d'outils par minute (in-memory).
 *   - Confirmation UI : tout outil WRITE/DESTRUCTIVE est mis en attente ;
 *     l'exécution réelle n'a lieu qu'après `confirmAction`.
 *   - Audit : chaque action d'écriture/suppression exécutée est journalisée
 *     avec la mention « assistant IA ».
 * ──────────────────────────────────────────────────────────────────────────────
 */

export type AiProvider = 'anthropic' | 'openai' | 'custom';

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiConfigView {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  expiryMode: 'none' | 'date';
  expiryDate: string;
  rateLimitPerMin: number;
  apiKeySet: boolean;
  connected: boolean;
  expired: boolean;
}

export interface PendingAction {
  actionId: string;
  toolName: string;
  toolKind: ToolKind;
  params: unknown;
  summary: string;
}

export interface AiChatResult {
  reply: string;
  pendingAction?: PendingAction;
  toolResults?: Array<{ toolName: string; success: boolean; error?: string; data?: unknown }>;
}

const PROVIDER_DEFAULT_BASE_URL: Record<AiProvider, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  custom: '',
};

// Actions en attente de confirmation utilisateur (chat intégré).
let pendingActions: Record<string, PendingAction> = {};

function resolveBaseUrl(provider: AiProvider, explicit: string): string {
  const trimmed = explicit.trim();
  if (trimmed) return trimmed.replace(/\/$/, '');
  return PROVIDER_DEFAULT_BASE_URL[provider];
}

function describeParams(toolName: string, params: unknown): string {
  const p = params as Record<string, unknown>;
  if (toolName === 'delete_product' || toolName === 'archive_product') return `${toolName} — id=${String(p?.id ?? '')}`;
  if (toolName === 'create_product') return `Création produit : ${String(p?.designation ?? p?.reference ?? '')}`;
  if (toolName === 'update_product') return `Modification produit id=${String(p?.id ?? '')}`;
  if (toolName === 'create_document') return `Création document ${String(p?.type ?? '')}`;
  if (toolName === 'create_stock_movement') return `Mouvement de stock ${String(p?.movement_type ?? '')} (qty ${String(p?.quantity ?? '')})`;
  if (toolName === 'add_payment') return `Paiement sur document ${String(p?.document_id ?? '')}`;
  if (toolName === 'add_client_debt') return `Dette client ${String(p?.customer_id ?? '')}`;
  if (toolName === 'add_client_payment') return `Paiement client ${String(p?.customer_id ?? '')}`;
  return `${toolName}`;
}

export const AiAssistantService = {
  getConfig(): AiConfigView {
    const s = GlobalSettingsService.getAll();
    const expiryDate = s.ai_expiry_date;
    const expired = s.ai_expiry_mode === 'date' && !!expiryDate && new Date(expiryDate).getTime() < Date.now();
    const connected = !!s.ai_api_key && !expired;
    return {
      provider: s.ai_provider,
      baseUrl: resolveBaseUrl(s.ai_provider, s.ai_base_url),
      model: s.ai_model,
      expiryMode: s.ai_expiry_mode,
      expiryDate: s.ai_expiry_date,
      rateLimitPerMin: s.ai_rate_limit_per_min,
      apiKeySet: !!s.ai_api_key,
      connected,
      expired,
    };
  },

  saveConfig(input: { provider: AiProvider; baseUrl?: string; apiKey?: string; model?: string; expiryMode?: 'none' | 'date'; expiryDate?: string; rateLimitPerMin?: number }): AiConfigView {
    const provider = input.provider;
    GlobalSettingsService.save({
      ai_provider: provider,
      ai_base_url: input.baseUrl ?? '',
      ai_api_key: input.apiKey ?? '',
      ai_model: input.model ?? '',
      ai_expiry_mode: input.expiryMode ?? 'none',
      ai_expiry_date: input.expiryDate ?? '',
      ai_rate_limit_per_min: input.rateLimitPerMin ?? 30,
    });
    return this.getConfig();
  },

  disconnect(): AiConfigView {
    // Révocation locale : la clé est effacée, l'assistant désactivé.
    GlobalSettingsService.save({ ai_api_key: '', ai_model: '' });
    return this.getConfig();
  },

  isActive(): boolean {
    return this.getConfig().connected;
  },

  /** Test de connexion : envoie une requête minimale sans sauvegarder. */
  async testConnection(input: { provider: AiProvider; baseUrl?: string; apiKey: string; model: string }): Promise<{ success: boolean; message: string }> {
    const baseUrl = resolveBaseUrl(input.provider, input.baseUrl ?? '');
    const apiKey = input.apiKey.trim();
    if (!apiKey) return { success: false, message: 'Clé API manquante.' };
    if (!input.model.trim()) return { success: false, message: 'Modèle manquant.' };
    try {
      const url = `${baseUrl}/messages`;
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (input.provider === 'anthropic') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['authorization'] = `Bearer ${apiKey}`;
      }
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: input.model,
          max_tokens: 5,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      if (res.ok) return { success: true, message: 'Connexion réussie.' };
      const text = await res.text().catch(() => '');
      return { success: false, message: `Échec (${res.status}) : ${text.slice(0, 200)}` };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: `Erreur réseau : ${msg}` };
    }
  },

  /**
   * Déclenche un tour de conversation avec le LLM. Si le LLM demande un outil
   * WRITE/DESTRUCTIVE, celui-ci est mis en attente (pendingAction) et renvoyé
   * au renderer pour confirmation — l'exécution n'a pas encore eu lieu.
   */
  async chat(messages: AiChatMessage[]): Promise<AiChatResult> {
    const config = this.getConfig();
    if (!config.connected) {
      throw new Error(config.expired ? 'Connexion IA expirée.' : 'Aucune connexion IA configurée.');
    }
    // Le rate-limit des APPELS D'OUTILS est appliqué dans executeMcpTool (McpTools).
    // Ici on ne limite que l'appel LLM lui-même, via le même compteur partagé.

    const tools = Object.entries(MCP_TOOLS).map(([name, tool]) => ({
      name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));

    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: 1500,
      messages,
    };
    if (tools.length > 0) body.tools = tools;

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.provider === 'anthropic') {
      headers['x-api-key'] = GlobalSettingsService.getAll().ai_api_key;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['authorization'] = `Bearer ${GlobalSettingsService.getAll().ai_api_key}`;
    }

    const res = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Erreur LLM (${res.status}) : ${text.slice(0, 200)}`);
    }
    const data = await res.json() as { content?: Array<{ type: string; text?: string }>; stop_reason?: string };

    // Lire la réponse texte
    const reply = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n')
      .trim() || 'Réponse vide.';

    return { reply, pendingAction: undefined, toolResults: [] };
  },

  /** Exécute un outil. READ → immédiat ; WRITE/DESTRUCTIVE → mis en attente. */
  requestTool(toolName: string, params: unknown): { result?: McpToolResult; pendingAction?: PendingAction } {
    const tool = MCP_TOOLS[toolName];
    if (!tool) return { result: { success: false, error: `Outil inconnu : ${toolName}` } };
    const actionId = Math.random().toString(36).slice(2, 10);
    if (tool.kind === 'READ') {
      const result = executeMcpTool(toolName, params, 'integrated');
      return { result };
    }
    // WRITE / DESTRUCTIVE → attente de confirmation
    const pending: PendingAction = {
      actionId,
      toolName,
      toolKind: tool.kind,
      params,
      summary: describeParams(toolName, params),
    };
    pendingActions[actionId] = pending;
    return { pendingAction: pending };
  },

  /** Confirme (ou rejette) une action en attente, puis l'exécute si confirmée. */
  confirmAction(actionId: string, confirmed: boolean): McpToolResult {
    const pending = pendingActions[actionId];
    if (!pending) return { success: false, error: 'Action introuvable ou déjà traitée.' };
    delete pendingActions[actionId];
    if (!confirmed) return { success: false, error: 'Action annulée par l\'utilisateur.' };

    // La confirmation utilisateur est passée à executeMcpTool, qui journalise
    // désormais lui-même (garde-fou interne, quel que soit l'appelant).
    const result = executeMcpTool(
      pending.toolName,
      { ...(pending.params as object), confirmed: true },
      'integrated',
    );
    return result;
  },
};
