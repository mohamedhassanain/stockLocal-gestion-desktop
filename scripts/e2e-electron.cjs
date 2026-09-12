/**
 * E2E Electron RÉEL (Phase 25) + capture d'écran UI (Phase 28) — sans dépendance externe.
 *
 * - Lance l'APPLICATION RÉELLE (electron + dist-electron/main.js, renderer construit)
 *   avec `--remote-debugging-port`, puis pilote le renderer via CDP.
 * - Exécute un WORKFLOW MÉTIER dans la page (vraie chaîne
 *   renderer → preload → IPC → service → SQLite).
 * - Capture des CAPTURES D'ÉCRAN (Page.captureScreenshot) pour inspecter l'UI réelle.
 *
 * Échec du workflow ⇒ code de sortie 1. Usage : node scripts/e2e-electron.cjs
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(os.tmpdir(), 'stocklocal-e2e-' + Date.now());
const PORT = 9222;

function log(...a) { console.log('[E2E]', ...a); }
function fail(msg) { console.error('[E2E] ÉCHEC :', msg); process.exitCode = 1; }

async function waitForTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const targets = await res.json();
      const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* pas encore prêt */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

/** Envoie une commande CDP et renvoie son résultat. */
let msgId = 0;
function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const onMsg = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      resolve(msg.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function evaluate(ws, expression) {
  return cdp(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    .then(r => {
      if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'exception renderer');
      return r && r.result ? r.result.value : undefined;
    });
}

async function screenshot(ws, file) {
  const res = await cdp(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  log('capture :', file);
}

const WORKFLOW = `(async () => {
  const api = window.api;
  const unwrap = (r) => (r && typeof r === 'object' && 'success' in r && 'data' in r) ? r.data : r;
  const out = {};
  try {
    try { await api.storage.completeFirstRun(); } catch (e) {}
    const ref = 'E2E-' + Date.now();
    const created = unwrap(await api.products.create({
      reference: ref, designation: 'Produit E2E', purchase_price: 10,
      selling_price: 20, wholesale_price: 15, min_stock: 0, unit: 'PIECE',
      vat_rate: 20, status: 'ACTIVE'
    }));
    const pid = created && created.id;
    out.createdId = pid || null;
    unwrap(await api.stock.addEntry({ product_id: pid, quantity: 100, unit_price: 10 }));
    out.level = await api.stock.getLevel(pid);
    const found = await api.products.search(ref);
    const list = Array.isArray(found) ? found : (found && found.items) || [];
    out.foundCount = list.length;
    const audit = unwrap(await api.stock.auditBalances());
    out.discrepancy = audit ? audit.discrepancyCount : 'n/a';
    out.ok = true;
  } catch (e) { out.ok = false; out.error = String((e && e.message) || e); }
  return JSON.stringify(out);
})()`;

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const electronPath = require('electron');
  const shotOnboarding = path.join(ROOT, 'e2e-shot-1-onboarding.png');
  const shotApp = path.join(ROOT, 'e2e-shot-2-app.png');
  log('dossier données :', DATA_DIR);

  const child = spawn(electronPath, [`--remote-debugging-port=${PORT}`, '.'], {
    cwd: ROOT,
    env: { ...process.env, STOCKLOCAL_USER_DATA_DIR: DATA_DIR, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => process.stdout.write('[app] ' + d));
  child.stderr.on('data', d => process.stderr.write('[app:err] ' + d));

  let killed = false;
  const stop = () => { if (!killed) { killed = true; try { child.kill(); } catch {} } };
  process.on('exit', stop);

  let ws;
  try {
    const page = await waitForTarget(40000);
    if (!page) { fail('renderer introuvable après 40s'); return; }
    log('renderer ciblé :', page.url);
    await new Promise(r => setTimeout(r, 3500));

    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('WS error')), { once: true });
      setTimeout(() => rej(new Error('WS timeout')), 10000);
    });
    await cdp(ws, 'Page.enable');

    // Capture #1 : écran initial (onboarding au 1er lancement)
    await screenshot(ws, shotOnboarding);

    // Workflow réel
    const raw = await evaluate(ws, WORKFLOW);
    let result;
    try { result = JSON.parse(raw); } catch { result = { ok: false, error: 'réponse non-JSON: ' + raw }; }
    log('workflow =', JSON.stringify(result));
    if (!result.ok) return fail('workflow renderer: ' + result.error);

    // Recharger pour afficher l'app (dashboard) puis capturer
    await evaluate(ws, 'location.reload(); "ok"').catch(() => {});
    await new Promise(r => setTimeout(r, 5000));
    await screenshot(ws, shotApp);

    const checks = [
      ['produit créé', !!result.createdId],
      ['stock = 100', result.level === 100],
      ['produit trouvé par recherche', result.foundCount >= 1],
      ['audit stock sans écart', result.discrepancy === 0],
    ];
    let ok = true;
    for (const [label, pass] of checks) { log((pass ? '  ✔ ' : '  ✘ ') + label); if (!pass) ok = false; }
    if (!ok) return fail('assertions E2E non satisfaites');
    log('SUCCÈS — workflow réel renderer→preload→IPC→SQLite validé.');
  } catch (e) {
    fail(e.message);
  } finally {
    try { if (ws && ws.readyState === 1) ws.close(); } catch {}
    stop();
    await new Promise(r => setTimeout(r, 1500));
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
  }
}

main();
