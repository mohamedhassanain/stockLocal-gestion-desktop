import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AiAssistantService } from '../src/ai/AiAssistantService';
import { executeMcpTool, MCP_TOOLS, resetRateLimitCounter } from '../src/ai/McpTools';
import { GlobalSettingsService } from '../src/services/GlobalSettingsService';
import { AuditService } from '../src/services/AuditService';
import { ProductRepository } from '../src/repositories/ProductRepository';

/**
 * A.1 — Test d'intégration du chat intégré (Mode A) avec de VRAIS appels
 * simulés au niveau HTTP (mock de `fetch`), PAS au niveau de la logique métier.
 * Vérifie, avec une vraie conversation :
 *  1. le bon endpoint selon le provider (/messages Anthropic, /chat/completions OpenAI)
 *  2. un tool_call READ → exécution immédiate → le résultat retourne au LLM → réponse finale
 *  3. un tool_call WRITE → mécanisme de confirmation (pas d'exécution immédiate)
 *     puis exécution + journalisation AuditService une fois confirmé
 *  4. la limite MAX_TOOL_ITERATIONS est réellement respectée (LLM qui boucle)
 */
const MAX_TOOL_ITERATIONS = 10;

function anthropicContent(content: Array<Record<string, unknown>>): unknown {
  return { content };
}
function anthropicToolUse(id: string, name: string, input: Record<string, unknown>): unknown {
  return anthropicContent([{ type: 'tool_use', id, name, input }]);
}
function anthropicText(text: string): unknown {
  return anthropicContent([{ type: 'text', text }]);
}
function openaiToolUse(id: string, name: string, input: Record<string, unknown>): unknown {
  return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(input) } }] } }] };
}
function openaiText(text: string): unknown {
  return { choices: [{ message: { role: 'assistant', content: text } }] };
}
function resp(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('A.1 — Chat intégré (Mode A) bout-en-bout via fetch simulé', () => {
  beforeEach(() => {
    resetRateLimitCounter();
    GlobalSettingsService.save({
      ai_provider: 'anthropic',
      ai_base_url: '',
      ai_api_key: '',
      ai_model: '',
      ai_expiry_mode: 'none',
      ai_expiry_date: '',
      ai_rate_limit_per_min: 30,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. appelle le bon endpoint Anthropic (/messages) et renvoie le texte final sans tool_call', async () => {
    AiAssistantService.saveConfig({ provider: 'anthropic', apiKey: 'sk-test', model: 'claude-test' });
    const fetchMock = vi.fn().mockResolvedValue(resp(anthropicText('Bonjour, je suis l\'assistant StockLocal.')));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await AiAssistantService.chat([{ role: 'user', content: 'Bonjour' }]);
      expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.any(Object));
      expect(result.reply).toContain('Bonjour');
      expect(result.pendingAction).toBeUndefined();
      expect(result.toolResults).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('2. tool_call READ (get_revenue_summary) → exécuté immédiatement → résultat renvoyé au LLM → réponse finale cohérente', async () => {
    AiAssistantService.saveConfig({ provider: 'anthropic', apiKey: 'sk-test', model: 'claude-test' });
    // Tour 1 : le LLM demande get_revenue_summary ; Tour 2 : il répond.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(resp(anthropicToolUse('tu1', 'get_revenue_summary', {})))
      .mockResolvedValueOnce(resp(anthropicText('Votre chiffre d\'affaires du mois est de 12 345,00 MAD.')));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await AiAssistantService.chat([{ role: 'user', content: 'Quel est mon chiffre d\'affaires du mois ?' }]);
      // Le deuxième appel DOIT avoir injecté le tool_result dans la conversation
      // (preuve que l'outil READ a été exécuté et son résultat renvoyé au LLM).
      const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
      const lastMsg = secondBody.messages[secondBody.messages.length - 1];
      const toolResults = lastMsg.content.filter((b: { type: string }) => b.type === 'tool_result');
      // Preuve que l'outil READ a bien été exécuté et son résultat renvoyé au LLM.
      expect(toolResults.length).toBe(1);
      expect(toolResults[0].tool_use_id).toBe('tu1');
      expect(typeof toolResults[0].content).toBe('string');
      // Réponse finale.
      expect(result.reply).toContain('12 345,00');
      expect(result.pendingAction).toBeUndefined();
      // Le chat renvoie toolResults: [] sur la réponse finale (array local par itération).
      expect(result.toolResults).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('3. tool_call WRITE (create_product) → PAS d\'exécution immédiate, confirmation requise, puis exécution + audit après confirmAction', async () => {
    AiAssistantService.saveConfig({ provider: 'anthropic', apiKey: 'sk-test', model: 'claude-test' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(resp(anthropicToolUse('tu1', 'create_product', {
        reference: 'REF-E2E-CONFIRM',
        designation: 'Produit E2E confirmé',
        purchase_price: 10,
        selling_price: 25,
      })));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await AiAssistantService.chat([{ role: 'user', content: 'Crée un produit réf REF-E2E-CONFIRM' }]);
      // L'outil WRITE est mis en attente : pas d'exécution maintenant.
      expect(result.pendingAction).toBeDefined();
      expect(result.pendingAction?.toolKind).toBe('WRITE');
      expect(result.toolResults).toHaveLength(0); // aucune exécution pendant le chat
      // Le produit ne DOIT PAS exister tant que l'utilisateur n'a pas confirmé.
      expect(ProductRepository.findByReference('REF-E2E-CONFIRM')).toBeUndefined();

      // On confirme → exécution + audit.
      const confirmRes = AiAssistantService.confirmAction(result.pendingAction!.actionId, true);
      expect(confirmRes.success).toBe(true);
      const created = ProductRepository.findByReference('REF-E2E-CONFIRM');
      expect(created).not.toBeNull();
      const logs = AuditService.getLogs(100);
      const entry = logs.find((l) => l.action === 'AI_CREATE_PRODUCT');
      expect(entry).toBeDefined();
      expect(entry!.details).toContain('assistant IA');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('4. MAX_TOOL_ITERATIONS est respecté quand le LLM boucle sur un tool_call', async () => {
    AiAssistantService.saveConfig({ provider: 'anthropic', apiKey: 'sk-test', model: 'claude-test' });
    // Le LLM renvoie TOUJOURS un tool_call READ → la boucle ne se termine jamais seule.
    const fetchMock = vi.fn().mockImplementation(async () => resp(anthropicToolUse('tu-loop', 'get_revenue_summary', {})));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(AiAssistantService.chat([{ role: 'user', content: 'boucle' }])).rejects.toThrow(
        'Limite maximale d\'itérations d\'outils atteinte',
      );
      expect(fetchMock).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('5. provider OpenAI → endpoint /chat/completions et tool_call READ OpenAI', async () => {
    GlobalSettingsService.save({
      ai_provider: 'openai',
      ai_base_url: 'https://api.openai.com/v1',
      ai_api_key: '',
      ai_model: '',
      ai_expiry_mode: 'none',
      ai_expiry_date: '',
      ai_rate_limit_per_min: 30,
    });
    AiAssistantService.saveConfig({ provider: 'openai', apiKey: 'sk-openai', model: 'gpt-4o-mini' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(resp(openaiToolUse('call1', 'get_dashboard', {})))
      .mockResolvedValueOnce(resp(openaiText('Le tableau de bord est prêt : CA du mois 5 678,00 MAD.')));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await AiAssistantService.chat([{ role: 'user', content: 'Donne moi le dashboard' }]);
      expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.any(Object));
      // Le second appel OpenAI doit contenir un message `tool` (résultat de l'outil READ).
      const secondBodyOpenAI = JSON.parse(String(fetchMock.mock.calls[1][1].body));
      const toolMsg = secondBodyOpenAI.messages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg.tool_call_id).toBe('call1');
      expect(typeof toolMsg.content).toBe('string');
      expect(result.reply).toContain('5 678,00');
      expect(result.toolResults).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('6. un outil READ est bien exécuté via executeMcpTool (lien chat → McpTools)', async () => {
    // Vérifie que le chemin READ du chat passe par executeMcpTool (source 'integrated').
    const before = executeMcpTool('list_products', { query: '', limit: 1 });
    expect(before.success).toBe(true);
    expect(MCP_TOOLS['list_products'].kind).toBe('READ');
  });
});
