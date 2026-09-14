/**
 * E2E Electron RÉEL (Phase 25) + capture d'écran UI (Phase 28) — sans dépendance externe.
 *
 * - Lance l'APPLICATION RÉELLE (electron + dist-electron/main.js, renderer construit)
 *   avec `--remote-debugging-port`, puis pilote le renderer via CDP.
 * - Exécute un WORKFLOW MÉTIER COMPLET dans la page (vraie chaîne
 *   renderer → preload → IPC → service → SQLite) :
 *
 *     produit → client → achat (commande + réception) → stock
 *     → vente avec PAIEMENT MULTI-MODES (§B2) → stock + solde client
 *     → retour / avoir → stock + solde client
 *     → transfert entre dépôts → vérification des DEUX dépôts
 *     → session de caisse (ouverture / vente / dépense / fermeture)
 *     → sauvegarde → MODIFICATION → restauration → vérification (2e démarrage)
 *
 * - Capture des CAPTURES D'ÉCRAN (Page.captureScreenshot) pour inspecter l'UI réelle.
 *
 * La restauration s'applique au DÉMARRAGE suivant : le script lance donc
 * l'application DEUX FOIS sur le même dossier de données.
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

/**
 * Lance l'application sur DATA_DIR, exécute l'expression de workflow, prend une
 * capture, tue l'application, puis renvoie le résultat analysé.
 */
async function runPhase(label, workflow, shotFile) {
  log(`── ${label} ──`);
  const electronPath = require('electron');
  const child = spawn(electronPath, [`--remote-debugging-port=${PORT}`, '.'], {
    cwd: ROOT,
    env: { ...process.env, STOCKLOCAL_USER_DATA_DIR: DATA_DIR, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => process.stdout.write('[app] ' + d));
  child.stderr.on('data', d => process.stderr.write('[app:err] ' + d));

  let killed = false;
  const stop = () => { if (!killed) { killed = true; try { child.kill(); } catch {} } };

  let ws;
  try {
    const page = await waitForTarget(40000);
    if (!page) throw new Error('renderer introuvable après 40s');
    log('renderer ciblé :', page.url);
    await new Promise(r => setTimeout(r, 3500));

    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('WS error')), { once: true });
      setTimeout(() => rej(new Error('WS timeout')), 10000);
    });
    await cdp(ws, 'Page.enable');
    await screenshot(ws, shotFile);

    const raw = await evaluate(ws, workflow);
    let result;
    try { result = JSON.parse(raw); } catch { result = { ok: false, error: 'réponse non-JSON: ' + raw }; }
    log('résultat =', JSON.stringify(result));
    return result;
  } finally {
    try { if (ws && ws.readyState === 1) ws.close(); } catch {}
    stop();
    await new Promise(r => setTimeout(r, 2500));
  }
}
/** Phase 1 — workflow métier complet, jusqu'à la demande de restauration. */
const PHASE1 = `(async () => {
  const api = window.api;
  const unwrap = (r) => (r && typeof r === 'object' && 'success' in r && 'data' in r) ? r.data : r;
  const arr = (r) => Array.isArray(r) ? r : ((r && (r.items || r.data)) || []);
  const out = {};
  try {
    try { await api.storage.completeFirstRun(); } catch (e) {}
    const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); })();

    // 1. Produit
    const ref = 'E2E-' + Date.now();
    const product = unwrap(await api.products.create({
      reference: ref, designation: 'Produit E2E', purchase_price: 10,
      selling_price: 20, wholesale_price: 15, min_stock: 0, unit: 'PIECE',
      vat_rate: 20, status: 'ACTIVE'
    }));
    const pid = product.id;
    out.pid = pid;

    // 2. Client
    const client = unwrap(await api.clients.create({ name: 'Client E2E' }));
    const cid = client.id;
    out.cid = cid;

    // 3. Entrée de stock initiale : 100
    unwrap(await api.stock.addEntry({ product_id: pid, quantity: 100, unit_price: 10 }));
    out.stockAfterEntry = await api.stock.getLevel(pid);

    // 4. Achat fournisseur : commande 20 @ 8, confirmation, réception totale
    const supplier = unwrap(await api.suppliers.create({ name: 'Fournisseur E2E' }));
    const po = unwrap(await api.purchases.create({
      supplier_id: supplier.id, items: [{ product_id: pid, quantity: 20, unit_price: 8 }]
    }));
    unwrap(await api.purchases.confirm(po.id));
    const poFull = unwrap(await api.purchases.getById(po.id));
    const itemId = (poFull.items && poFull.items[0] && poFull.items[0].id) || null;
    unwrap(await api.purchases.receive(po.id, [{ item_id: itemId, received_qty: 20 }]));
    out.stockAfterPurchase = await api.stock.getLevel(pid);

    // 5. Vente (facture) NON payée : 5 x 20 (TVA 20% => 120 TTC)
    const invoice = unwrap(await api.documents.create({
      type: 'INVOICE', entity_id: cid, date: today,
      items: [{ product_id: pid, quantity: 5, unit_price: 20, discount: 0 }]
    }));
    const invId = invoice.id;
    out.invId = invId;
    const invBefore = await api.documents.getById(invId);
    out.invoiceTotal = invBefore.total_incl_tax;
    out.stockAfterSale = await api.stock.getLevel(pid);
    out.balanceAfterInvoice = unwrap(await api.clients.getStatement(cid)).balance;

    // 6. §B2 — paiement RÉPARTI sur 3 modes, en UNE opération
    const third = Math.round((invBefore.total_incl_tax - 90) * 100) / 100;
    await api.documents.addPayments({
      document_id: invId,
      payments: [
        { amount: 50, payment_method: 'CASH' },
        { amount: 40, payment_method: 'CHECK', reference: 'CHQ-E2E' },
        { amount: third, payment_method: 'TRANSFER' }
      ]
    });
    const invAfter = await api.documents.getById(invId);
    out.invoiceStatusAfterPayment = invAfter.status;
    out.paymentsCount = arr(await api.documents.getPayments(invId)).length;
    out.balanceAfterPayment = unwrap(await api.clients.getStatement(cid)).balance;

    // 7. Retour / avoir : 2 unités
    const cn = await api.documents.createCreditNote(invId, [{ product_id: pid, quantity: 2 }], 'Retour E2E');
    out.creditNoteOk = !!(cn && cn.success);
    out.stockAfterReturn = await api.stock.getLevel(pid);
    out.balanceAfterReturn = unwrap(await api.clients.getStatement(cid)).balance;

    // 8. Transfert entre dépôts : 10 vers un 2e dépôt
    const w2 = unwrap(await api.warehouses.create({ name: 'Dépôt E2E 2' }));
    const whs = arr(await api.warehouses.getAll());
    out.warehousesCount = whs.length;
    const w1 = whs.find((w) => w.is_default === 1) || whs.find((w) => w.id !== w2.id);
    await api.transfers.create({
      product_id: pid, from_warehouse_id: w1.id, to_warehouse_id: w2.id,
      quantity: 10, notes: 'Transfert E2E'
    });
    const bd = arr(await api.stock.getWarehouseBreakdown(pid));
    out.transferToW2 = (bd.find((r) => r.warehouse_id === w2.id) || {}).quantity;
    out.transferFromW1 = (bd.find((r) => r.warehouse_id === w1.id) || {}).quantity;

    // 9. Session de caisse : ouverture → vente espèces → dépense → fermeture
    const session = unwrap(await api.cash.open(200, 'Session E2E'));
    const sid = session.id;
    out.sessionId = sid;
    unwrap(await api.cash.addMovement({
      sessionId: sid, movementType: 'SALE_CASH', direction: 'IN',
      amount: 50, paymentMethod: 'CASH', description: 'Vente E2E'
    }));
    unwrap(await api.expenses.create({
      category: 'Transport', amount: 30, description: 'Dépense E2E', paymentMethod: 'CASH'
    }));
    const closed = unwrap(await api.cash.close(sid, 220, 'E2E'));
    out.sessionStatus = (closed && closed.status) || 'unknown';

    // 10. Sauvegarde, PUIS modification (le marqueur doit disparaître après restauration)
    const backup = unwrap(await api.backup.now());
    out.backupPath = (backup && (backup.filePath || backup.path || backup.file)) || (typeof backup === 'string' ? backup : null);
    const marker = unwrap(await api.products.create({
      reference: 'E2E-MARKER-' + Date.now(), designation: 'Marqueur post-backup',
      purchase_price: 1, selling_price: 2, wholesale_price: 1, min_stock: 0,
      unit: 'PIECE', vat_rate: 20, status: 'ACTIVE'
    }));
    out.markerRef = marker.reference;

    // 11. Demande de restauration (appliquée au PROCHAIN démarrage)
    const rest = await api.backup.restore(out.backupPath);
    out.restoreRequested = !!(rest && rest.success);

    out.ok = true;
  } catch (e) { out.ok = false; out.error = String((e && e.message) || e); }
  return JSON.stringify(out);
})()`;

/** Phase 2 — après redémarrage : la restauration a-t-elle ramené l'état sauvegardé ? */
const PHASE2 = `(async () => {
  const api = window.api;
  const arr = (r) => Array.isArray(r) ? r : ((r && (r.items || r.data)) || []);
  const out = {};
  try {
    const all = arr(await api.products.getAll());
    out.totalProducts = all.length;
    out.markerCount = all.filter((p) => String(p.reference || '').startsWith('E2E-MARKER-')).length;
    out.ok = true;
  } catch (e) { out.ok = false; out.error = String((e && e.message) || e); }
  return JSON.stringify(out);
})()`;
async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  log('dossier données :', DATA_DIR);

  const shot1 = path.join(ROOT, 'e2e-shot-1-phase1.png');
  const shot2 = path.join(ROOT, 'e2e-shot-2-phase2.png');

  // ─── Phase 1 ───────────────────────────────────────────────────────────────
  let p1;
  try {
    p1 = await runPhase('Phase 1 — workflow métier complet', PHASE1, shot1);
  } catch (e) { return fail(e.message); }

  if (!p1 || !p1.ok) return fail('phase 1 : ' + (p1 && p1.error));
  if (!p1.backupPath) return fail('phase 1 : chemin de sauvegarde introuvable (' + JSON.stringify(p1.backupPath) + ')');
  if (!p1.restoreRequested) return fail('phase 1 : la restauration n\'a pas été demandée');

  const checks1 = [
    ['stock initial = 100', p1.stockAfterEntry === 100],
    ['achat reçu (20) → stock = 120', p1.stockAfterPurchase === 120],
    ['vente (5) → stock = 115', p1.stockAfterSale === 115],
    ['facture TTC = 120', p1.invoiceTotal === 120],
    ['solde client après facture impayée = 120', p1.balanceAfterInvoice === 120],
    ['paiement MULTI-MODES → facture PAYÉE', p1.invoiceStatusAfterPayment === 'PAID'],
    ['3 lignes de paiement enregistrées', p1.paymentsCount === 3],
    ['solde client après paiement = 0', p1.balanceAfterPayment === 0],
    ['avoir créé', p1.creditNoteOk === true],
    ['retour (2) → stock = 117', p1.stockAfterReturn === 117],
    ['solde client après avoir = -48', p1.balanceAfterReturn === -48],
    ['2 dépôts présents', p1.warehousesCount >= 2],
    ['transfert → 10 unités dans le dépôt 2', p1.transferToW2 === 10],
    ['transfert → 107 unités dans le dépôt 1', p1.transferFromW1 === 107],
    ['session de caisse fermée', p1.sessionStatus === 'CLOSED'],
  ];
  let ok = true;
  for (const [label, pass] of checks1) { log((pass ? '  ✔ ' : '  ✘ ') + label); if (!pass) ok = false; }
  if (!ok) return fail('assertions de la phase 1 non satisfaites');

  // ─── Phase 2 — redémarrage : la restauration s'applique au démarrage ───────
  let p2;
  try {
    p2 = await runPhase('Phase 2 — après redémarrage (restauration appliquée)', PHASE2, shot2);
  } catch (e) { return fail(e.message); }

  if (!p2 || !p2.ok) return fail('phase 2 : ' + (p2 && p2.error));

  const checks2 = [
    ['le produit créé APRÈS la sauvegarde a disparu (restauration appliquée)', p2.markerCount === 0],
    ['des produits existent toujours après restauration', p2.totalProducts >= 1],
  ];
  for (const [label, pass] of checks2) { log((pass ? '  ✔ ' : '  ✘ ') + label); if (!pass) ok = false; }
  if (!ok) return fail('assertions de la phase 2 non satisfaites');

  log('SUCCÈS — workflow réel complet validé : produit, client, achat, vente multi-modes (B2),');
  log('         avoir, transfert inter-dépôts, session de caisse, sauvegarde + restauration.');
}

main().finally(() => {
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* Windows peut verrouiller */ }
});
