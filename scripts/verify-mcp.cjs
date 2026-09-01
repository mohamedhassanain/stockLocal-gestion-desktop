// A.2 — Vérification RÉELLE du serveur MCP externe (Mode B) via stdio JSON-RPC.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocklocal-mcp-'));
const dataDir = path.join(tmpRoot, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(tmpRoot, 'storage-config.json'), JSON.stringify({ dataPath: dataDir }));

// On lance le binaire COMPILÉ dist-electron/mcp-server.js via le node en cours.
// (process.execPath = chemin vers node ; pas de .cmd ni de shell:true → la
// cause de l'échec précédent est éliminée.)
const child = spawn(process.execPath, [path.join(process.cwd(), 'dist-electron', 'mcp-server.js')], {
  cwd: process.cwd(),
  env: { ...process.env, STOCKLOCAL_USER_DATA_DIR: tmpRoot },
  stdio: ['pipe', 'pipe', 'pipe'],
});

const rl = readline.createInterface({ input: child.stdout });
const pending = new Map();
let idCounter = 0;
rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  } catch { /* non-JSON */ }
});
child.stderr.on('data', (d) => { const s = d.toString(); if (s.includes('[MCP]')) console.log('SERVER_STDERR:', s.trim()); });

function send(method, params, isNotification = false) {
  const id = isNotification ? undefined : ++idCounter;
  const msg = { jsonrpc: '2.0', method };
  if (id) msg.id = id;
  if (params) msg.params = params;
  child.stdin.write(JSON.stringify(msg) + '\n');
  if (id) return new Promise((resolve) => pending.set(id, resolve));
  return Promise.resolve();
}

async function main() {
  const init = await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify', version: '1.0' } });
  console.log('INITIALIZE_OK =', !!(init.result && init.result.serverInfo));
  await send('notifications/initialized', undefined, true);

  const list = await send('tools/list');
  const names = list.result.tools.map((t) => t.name);
  console.log('TOOLS_LIST: count=' + names.length + ', has_list_products=' + names.includes('list_products'));

  const created = await send('tools/call', { name: 'create_product', arguments: { reference: 'MCP-REF-1', designation: 'Produit MCP', purchase_price: 10, selling_price: 20, confirmed: true } });
  console.log('CREATE_PRODUCT_RAW =', JSON.stringify(created));
  const createdText = (created.result && created.result.content && created.result.content[0] && created.result.content[0].text) || '';
  console.log('CREATE_PRODUCT_SUCCESS =', createdText.includes('"id"'));

  const listprod = await send('tools/call', { name: 'list_products', arguments: { query: 'MCP-REF-1' } });
  console.log('LIST_PRODUCTS_RAW =', JSON.stringify(listprod));
  const listText = (listprod.result && listprod.result.content && listprod.result.content[0] && listprod.result.content[0].text) || '';
  console.log('LIST_PRODUCTS_CONTAINS_REAL_DATA =', listText.includes('MCP-REF-1'));
  console.log('LIST_PRODUCTS_SAMPLE =', listText.slice(0, 140));

  const arch = await send('tools/call', { name: 'archive_product', arguments: { id: 'nope' } });
  const archText = (arch.result && arch.result.content && arch.result.content[0] && arch.result.content[0].text) || '';
  console.log('ARCHIVE_WITHOUT_CONFIRM_REFUSED =', archText.includes('CONFIRMATION_REQUIRED'));

  child.stdin.end();
  process.exit(0);
}
main().catch((e) => { console.error('VERIFY_ERR', e); process.exit(1); });
