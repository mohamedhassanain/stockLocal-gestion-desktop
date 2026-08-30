import { ipcMain } from 'electron';
import { AiAssistantService } from '../../src/ai/AiAssistantService';
import { executeMcpTool, MCP_TOOLS } from '../../src/ai/McpTools';

function run<T>(action: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(action());
}

export function registerAiHandlers(): void {
  ipcMain.handle('ai:getConfig', async () => run(() => AiAssistantService.getConfig()));

  ipcMain.handle('ai:saveConfig', async (_, input: unknown) => {
    return run(() => {
      const config = input as { provider: 'anthropic' | 'openai' | 'custom'; baseUrl?: string; apiKey?: string; model?: string; expiryMode?: 'none' | 'date'; expiryDate?: string; rateLimitPerMin?: number };
      if (!config.provider) throw new Error('Provider manquant.');
      return AiAssistantService.saveConfig(config);
    });
  });

  ipcMain.handle('ai:testConnection', async (_, input: unknown) => {
    const config = input as { provider: 'anthropic' | 'openai' | 'custom'; baseUrl?: string; apiKey: string; model: string };
    return AiAssistantService.testConnection(config);
  });

  ipcMain.handle('ai:disconnect', async () => run(() => AiAssistantService.disconnect()));

  ipcMain.handle('ai:chat', async (_, messages: unknown) => {
    return run(() => AiAssistantService.chat(messages as Parameters<typeof AiAssistantService.chat>[0]));
  });

  // Exécution directe d'un outil (READ immédiat ; WRITE/DESTRUCTIVE → confirmation)
  ipcMain.handle('ai:requestTool', async (_, payload: unknown) => {
    return run(() => {
      const p = payload as { name: string; params: unknown };
      if (!p.name) throw new Error('Nom d\'outil manquant.');
      return AiAssistantService.requestTool(p.name, p.params);
    });
  });

  ipcMain.handle('ai:confirmAction', async (_, payload: unknown) => {
    return run(() => {
      const p = payload as { actionId: string; confirmed: boolean };
      if (!p.actionId) throw new Error('Action manquante.');
      return AiAssistantService.confirmAction(p.actionId, p.confirmed);
    });
  });

  // Liste des outils exposés (pour debug / UI)
  ipcMain.handle('ai:listTools', async () => run(() => Object.keys(MCP_TOOLS)));
}
