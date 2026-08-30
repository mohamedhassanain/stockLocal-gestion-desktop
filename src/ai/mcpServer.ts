import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import os from 'node:os';
import path from 'node:path';
import { MCP_TOOLS, executeMcpTool } from './McpTools';
// Initialise la base de données (lit storage-config.json depuis userData)
import '../database/config/connection';

/**
 * ─── Serveur MCP StockLocal (standalone, stdio) ───────────────────────────────
 *
 * Expose les outils métier de StockLocal (McpTools) comme un serveur MCP
 * conforme au protocole Model Context Protocol, via le transport stdio.
 *
 * → À connecter à une app LLM desktop (Claude Desktop, etc.) en ajoutant ceci
 *   dans `claude_desktop_config.json` :
 *
 *   {
 *     "mcpServers": {
 *       "stocklocal": {
 *         "command": "node",
 *         "args": ["<chemin-vers>/dist-electron/mcp-server.js"]
 *       }
 *     }
 *   }
 *
 *   (après `npm run build:mcp`). Le serveur ouvre la MÊME base que l'app :
 *   il pointe par défaut sur le userData réel de l'application, surchargeable
 *   via STOCKLOCAL_USER_DATA_DIR.
 */

// ─── Résolution du userData réel de l'app (si non surchargé) ────────────────
function computeDefaultUserDataDir(): string {
  if (process.env.STOCKLOCAL_USER_DATA_DIR) return process.env.STOCKLOCAL_USER_DATA_DIR;
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'StockLocal');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'StockLocal');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'StockLocal');
}

process.env.STOCKLOCAL_USER_DATA_DIR = computeDefaultUserDataDir();

const server = new McpServer({ name: 'stocklocal', version: '1.0.0' });

// Enregistre chaque outil du registre MCP_TOOLS.
for (const [name, tool] of Object.entries(MCP_TOOLS)) {
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    async (args: Record<string, unknown>) => {
      const result = executeMcpTool(name, args ?? {});
      if (!result.success) {
        throw new Error(result.error ?? 'Erreur inconnue.');
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      };
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
// eslint-disable-next-line no-console
console.error('[MCP] Serveur StockLocal connecté sur stdio —', Object.keys(MCP_TOOLS).length, 'outils exposés.');
