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

// ─── System Prompt StockLocal (zone 15) ──────────────────────────────────────
const AI_SYSTEM_PROMPT = `Tu es StockLocal AI, un assistant spécialisé dans la gestion de stock, le commerce, les ventes, les clients et l'analyse commerciale pour un grossiste/détaillant (devise : MAD).

Règles :
1. N'invente JAMAIS de données. Utilise les outils uniquement quand une donnée réelle est nécessaire.
2. Explique clairement les résultats en langage simple adapté à un commerçant.
3. Demande confirmation pour toute action d'écriture/suppression (WRITE, FINANCIAL, DESTRUCTIVE).
4. Ne prétends jamais avoir exécuté une action sans résultat réel.
5. Si une information manque, indique-le clairement.
6. Ne contourne jamais les permissions.
7. Quand tu utilises un outil, attends son résultat avant de répondre définitivement.`;

// ─── Helpers VRAIE Tool-Calling Loop (Anthropic + OpenAI-compatible) ─────────
const MAX_TOOL_ITERATIONS = 10;

interface ExtractedToolUse { id: string; name: string; input: Record<string, unknown>; }
type ToolExecResult = { toolName: string; success: boolean; error?: string; data?: unknown };

function safeParseJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return (typeof v === 'object' && v !== null) ? v as Record<string, unknown> : {};
  } catch { return {}; }
}

function extractToolUses(data: Record<string, unknown>, provider: AiProvider): ExtractedToolUse[] {
  if (provider === 'anthropic') {
    const content = data.content as Array<Record<string, unknown>> | undefined;
    return (content ?? [])
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: String(b.id ?? ''), name: String(b.name ?? ''), input: (b.input ?? {}) as Record<string, unknown> }));
  }
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
  const calls = msg?.tool_calls as Array<Record<string, unknown>> | undefined;
  return (calls ?? []).map((c) => {
    const fn = c.function as Record<string, unknown> | undefined;
    return { id: String(c.id ?? ''), name: String(fn?.name ?? ''), input: safeParseJson(String(fn?.arguments ?? '{}')) };
  });
}

function extractText(data: Record<string, unknown>, provider: AiProvider): string {
  if (provider === 'anthropic') {
    const content = data.content as Array<Record<string, unknown>> | undefined;
    return (content ?? []).filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('\n').trim();
  }
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
  return String(msg?.content ?? '').trim();
}

function appendToolResults(
  convo: Array<Record<string, unknown>>,
  toolUses: ExtractedToolUse[],
  results: ToolExecResult[],
  provider: AiProvider,
): Array<Record<string, unknown>> {
  if (provider === 'anthropic') {
    const assistantContent = toolUses.map((tu) => ({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input }));
    const userContent = results.map((r, i) => ({
      type: 'tool_result',
      tool_use_id: toolUses[i]?.id ?? '',
      content: r.success ? JSON.stringify(r.data) : JSON.stringify({ error: r.error }),
    }));
    return [...convo, { role: 'assistant', content: assistantContent }, { role: 'user', content: userContent }];
  }
  const assistantMsg: Record<string, unknown> = {
    role: 'assistant',
    content: null,
    tool_calls: toolUses.map((tu) => ({ id: tu.id, type: 'function', function: { name: tu.name, arguments: JSON.stringify(tu.input) } })),
  };
  const toolMsgs = results.map((r, i) => ({ role: 'tool', tool_call_id: toolUses[i]?.id ?? '', content: r.success ? JSON.stringify(r.data) : JSON.stringify({ error: r.error }) }));
  return [...convo, assistantMsg, ...toolMsgs];
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

    const tools = Object.entries(MCP_TOOLS).map(([name, tool]) => ({
      name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));

    // Conversation : system en champ séparé (Anthropic) ou message role system (OpenAI).
    const baseMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    let convo: Array<Record<string, unknown>> =
      config.provider === 'anthropic' ? [...baseMessages] : [{ role: 'system', content: AI_SYSTEM_PROMPT }, ...baseMessages];

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const body: Record<string, unknown> = { model: config.model, max_tokens: 1500, messages: convo };
      if (config.provider === 'anthropic') body.system = AI_SYSTEM_PROMPT;
      if (tools.length > 0) body.tools = tools;

      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (config.provider === 'anthropic') {
        headers['x-api-key'] = GlobalSettingsService.getAll().ai_api_key;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['authorization'] = `Bearer ${GlobalSettingsService.getAll().ai_api_key}`;
      }

      const res = await fetch(`${config.baseUrl}/messages`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Erreur LLM (${res.status}) : ${text.slice(0, 200)}`);
      }
      const data = await res.json() as Record<string, unknown>;

      // 1) Pas de tool_use → réponse finale.
      const toolUses = extractToolUses(data, config.provider);
      if (toolUses.length === 0) {
        const reply = extractText(data, config.provider) || 'Réponse vide.';
        return { reply, pendingAction: undefined, toolResults: [] };
      }

      // 2) Outils demandés. READ → exécution immédiate ; WRITE/DESTRUCTIVE → confirmer.
      const toolResults: ToolExecResult[] = [];
      let pendingAction: PendingAction | undefined;
      for (const tu of toolUses) {
        const tool = MCP_TOOLS[tu.name];
        if (!tool) {
          toolResults.push({ toolName: tu.name, success: false, error: `Outil inconnu : ${tu.name}` });
          continue;
        }
        if (tool.kind === 'READ') {
          const r = executeMcpTool(tu.name, tu.input, 'integrated');
          toolResults.push(r.success ? { toolName: tu.name, success: true, data: r.data } : { toolName: tu.name, success: false, error: r.error });
        } else {
          // WRITE / FINANCIAL / DESTRUCTIVE → met en attente ; l'utilisateur confirme via confirmAction.
          const req = this.requestTool(tu.name, tu.input);
          if (req.pendingAction) { pendingAction = req.pendingAction; break; }
          toolResults.push({ toolName: tu.name, success: false, error: req.result?.error ?? 'Action refusée (confirmation requise).' });
        }
      }

      // 3) Action en attente → renvoyer à l'UI, on stoppe la boucle.
      if (pendingAction) {
        return { reply: `L'assistant souhaite effectuer une action « ${pendingAction.summary} » — veuillez confirmer.`, pendingAction, toolResults };
      }

      // 4) Injecter les tool_results dans la conversation et reboucler.
      convo = appendToolResults(convo, toolUses, toolResults, config.provider);
    }

    throw new Error('Limite maximale d\'itérations d\'outils atteinte (boucle interrompue).');
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
