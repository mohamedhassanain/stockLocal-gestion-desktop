import { ipcMain, shell } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { AiAssistantService } from '../../src/ai/AiAssistantService';
import { MCP_TOOLS } from '../../src/ai/McpTools';
import { GlobalSettingsService } from '../../src/services/GlobalSettingsService';
import {
  safeParse,
  AiSaveConfigSchema,
  AiTestConnectionSchema,
  AiChatSchema,
  AiRequestToolSchema,
  AiConfirmActionSchema,
  AiMcpConfigFolderSchema,
} from '../../src/validation/schemas';

function run<T>(action: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(action());
}

/** Calcule le dossier de config du client MCP (Claude Desktop / Cursor / Kimi CLI) selon l'OS. */
function computeMcpConfigFolder(client: 'claude' | 'cursor' | 'kimi'): string {
  const c = client;
  const home = os.homedir();
  // Kimi Code (CLI / Desktop) : fichier ~/.kimi-code/mcp.json — même chemin sur tous les OS.
  if (c === 'kimi') {
    return path.join(home, '.kimi-code');
  }
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const base = isWin
    ? (process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'))
    : isMac
      ? path.join(home, 'Library', 'Application Support')
      : (process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'));
  return path.join(base, c === 'cursor' ? 'Cursor' : 'Claude');
}

export function registerAiHandlers(): void {
  ipcMain.handle('ai:getConfig', async () => run(() => AiAssistantService.getConfig()));

  // P1-11 : validation Zod du payload de configuration (jamais `as`).
  ipcMain.handle('ai:saveConfig', async (_, input: unknown) => {
    return run(() => {
      const config = safeParse(AiSaveConfigSchema, input, 'Configuration IA');
      return AiAssistantService.saveConfig(config);
    });
  });

  ipcMain.handle('ai:testConnection', async (_, input: unknown) => {
    const config = safeParse(AiTestConnectionSchema, input, 'Test de connexion IA');
    return AiAssistantService.testConnection(config);
  });

  ipcMain.handle('ai:disconnect', async () => run(() => AiAssistantService.disconnect()));

  ipcMain.handle('ai:chat', async (_, messages: unknown) => {
    const safe = safeParse(AiChatSchema, messages, 'Messages du chat');
    return run(() => AiAssistantService.chat(safe));
  });

  // Exécution directe d'un outil (READ immédiat ; WRITE/DESTRUCTIVE → confirmation)
  ipcMain.handle('ai:requestTool', async (_, payload: unknown) => {
    return run(() => {
      const p = safeParse(AiRequestToolSchema, payload, 'Demande d\'outil');
      return AiAssistantService.requestTool(p.name, p.params);
    });
  });

  ipcMain.handle('ai:confirmAction', async (_, payload: unknown) => {
    return run(() => {
      const p = safeParse(AiConfirmActionSchema, payload, 'Confirmation d\'action');
      return AiAssistantService.confirmAction(p.actionId, p.confirmed);
    });
  });

  // Liste des outils exposés (pour debug / UI)
  ipcMain.handle('ai:listTools', async () => run(() => Object.keys(MCP_TOOLS)));

  // Chemin absolu du serveur MCP compilé + dossier userData, pour générer
  // automatiquement le bloc `claude_desktop_config.json` dans l'UI (B.1 simplifié).
  ipcMain.handle('ai:getMcpConfig', async () => run(() => {
    const root = process.env.APP_ROOT ?? process.cwd();
    const mcpServerRel = process.env.APP_ROOT ? 'dist-electron/mcp-server.js' : 'src/ai/mcpServer.ts';
    const home = os.homedir();
    const userDataDir =
      process.env.STOCKLOCAL_USER_DATA_DIR ??
      (process.platform === 'win32'
        ? path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'StockLocal')
        : process.platform === 'darwin'
          ? path.join(home, 'Library', 'Application Support', 'StockLocal')
          : path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'StockLocal'));
    const settings = GlobalSettingsService.getAll();
    return {
      mcpServerPath: path.join(root, mcpServerRel),
      userDataDir,
      rateLimitPerMin: settings.ai_rate_limit_per_min,
      provider: settings.ai_provider,
    };
  }));

  // Dossier de configuration du client MCP (Claude Desktop / Cursor) pour
  // « Ouvrir le dossier de configuration ». On recrée le dossier s'il manque
  // pour que `shell.openPath` réussisse toujours.
  ipcMain.handle('ai:getMcpConfigFolder', async (_, client: unknown) => run(() => {
    const safeClient = safeParse(AiMcpConfigFolderSchema, client, 'Client MCP');
    const folder = computeMcpConfigFolder(safeClient);
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch {
      // Dossier déjà présent ou non-créable — on renvoie le chemin.
    }
    return folder;
  }));

  // Ouvre directement le dossier de config du client (Claude/Cursor) via shell.openPath,
  // en le créant au besoin. Renvoie { success, error?, path } pour un feedback UI.
  ipcMain.handle('ai:openMcpConfigFolder', async (_, client: unknown) => {
    try {
      const safeClient = safeParse(AiMcpConfigFolderSchema, client, 'Client MCP');
      const folder = computeMcpConfigFolder(safeClient);
      fs.mkdirSync(folder, { recursive: true });
      const error = await shell.openPath(folder);
      return { success: !error, error: error || null, path: folder };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg, path: '' };
    }
  });

  // Ouvre un lien externe (page d'obtention de clé) via shell.openExternal.
  // Allowlist stricte : uniquement les 2 pages de clés connues, jamais une URL arbitraire.
  const ALLOWED_KEY_URLS = new Set([
    'https://console.anthropic.com/settings/keys',
    'https://platform.openai.com/api-keys',
  ]);
  ipcMain.handle('ai:openExternal', async (_, url: unknown) => {
    if (typeof url !== 'string' || !ALLOWED_KEY_URLS.has(url)) {
      return { success: false, error: 'URL non autorisée.' };
    }
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg };
    }
  });
}
