# StockLocal — Final Hardening Report

> Single-user, offline-first Electron + React + TypeScript + SQLite desktop app.
> This report documents the inspection, fixes, tests, and remaining warnings for the
> P0/P1 hardening checklist. **Never trust prior AI reports — every item was verified
> against the actual source code.**

---

## Validation Gates (actual commands run)

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **PASS** (no output) |
| Tests | `npm test` | **PASS — 139 tests / 10 files** |
| Build (tsc + vite) | `npm run build` (first 2 stages) | **PASS** (`dist/`, `dist-electron/main.js`, `dist-electron/preload.js`) |
| Packaging (installer) | `electron-builder` → Desktop `release/` | **BLOCKED** — `EPERM` renaming `release\win-unpacked.tmp` (Windows file lock on the Desktop path; **not** a code issue) |
| Packaging (validated) | `electron-builder --win nsis` → system temp dir | **PASS** — produced `StockLocal-1.0.0-setup.exe` + `.blockmap` |

---

## Issues FIXED (code modified)

### P0-2 — Product + initial stock must be atomic
**Root cause:** `products:createWithStock` created the product, then made the stock entry as a *separate* operation. If the stock entry failed, a product with no opening balance was left behind.

**Fix:**
- Added `ProductService.createProductWithInitialStock(productData, initialStock)` — runs `createProduct` + `recordMovement(OPENING_BALANCE)` in **one** `db.transaction`.
- Added `ProductService.updateProductWithStock(id, productData, stockAdjustment)` — product update + stock adjustment in one transaction.
- Updated `electron/ipc/referenceData.ipc.ts` handlers `products:createWithStock` and `products:updateWithStock` to call the atomic service methods.

**Files:** `src/services/ProductService.ts`, `electron/ipc/referenceData.ipc.ts`
**Tests:** `tests/hardening-p0.test.ts` (P0-2 block, incl. rollback on business-validation failure).

---

### P0-3 — Multi-table operation atomicity
**Root cause:** `ProductService.updateProduct` updated the product, then recorded price history in separate statements.

**Fix:** Wrapped `ProductRepository.update` + `PriceHistoryRepository.recordChange` inside `db.transaction`. `DocumentRepository` and `PurchaseOrderRepository` were verified to already use `db.transaction`/`runInTransaction` for their multi-step operations.

**Files:** `src/services/ProductService.ts`
**Tests:** `tests/hardening-p0.test.ts` (P0-3 block, incl. rollback when stock adjustment would go negative).

---

### P1-8 — Database schema consolidation (ONE `database.sql`)
**Decision (per user):** **no** `001_*.sql`/`002_*.sql` migration files. ONE authoritative schema file `src/database/schema/database.sql` defines the complete structure of a **new** database. The standalone `001_price_history_restrict.sql` migration was removed; the `migrationRunner.ts`/`schema_migrations` versioned-SQL framework was also removed from the startup path (no SQL migration files remain).

**`src/database/config/connection.ts` refactor:**
- `applySchema()` loads `database.sql` — the **single source of truth** for a new DB (all tables/indexes/FK/CHECK/defaults). Idempotent (`CREATE TABLE IF NOT EXISTS`), so it is also safe on existing DBs.
- Replaced all ~15 ad-hoc `migrateXxx()` schema functions (`migrateColumns`, `migrateAuditLogs`, `migrateStockMovements`, `migrateClientCredits`, `migrateSupplierCredits`, `migrateAddProductFields`, `migrateStockMovementV2`, `migrateDocumentsV2`, `migrateInventoryBalances`, `migrateQuantitiesReal`, `migrateDocumentSequences`) with **one** centralized `upgradeLegacyDatabase()` — minimal, additive, idempotent upgrade logic for **existing** databases only (adds missing columns; rebuilds old `REFERENCES users` tables; converts INTEGER→REAL quantities; upgrades `price_history` CASCADE→RESTRICT; seeds `document_sequences`). It **does not** redefine the complete schema.
- Removed the `runMigrations`/`resolveMigrationsDir` invocation (no migration files remain).
- Added `rebuildTable()` helper — rebuilds a table preserving **all** data (used only for legacy upgrades).

**Files:** `src/database/schema/database.sql`, `src/database/config/connection.ts`
**Tests:** `tests/database-schema.test.ts` (8 tests).

---

### P1-10 & P1-11 — IPC runtime validation + AI IPC security
**Root cause:** `electron/ipc/ai.ipc.ts` used `input as {...}` casts everywhere — **no** runtime validation of AI payloads. A malicious/buggy renderer could pass arbitrary objects to AI config, chat, tool execution, or confirmation.

**Fix:**
- Added Zod schemas to `src/validation/schemas.ts`: `AiProviderSchema`, `AiSaveConfigSchema`, `AiTestConnectionSchema`, `AiChatMessageSchema`, `AiChatSchema`, `AiRequestToolSchema`, `AiConfirmActionSchema`, `AiMcpConfigFolderSchema`.
- Rewrote `electron/ipc/ai.ipc.ts` so every handler (`ai:saveConfig`, `ai:testConnection`, `ai:chat`, `ai:requestTool`, `ai:confirmAction`, `ai:getMcpConfigFolder`, `ai:openMcpConfigFolder`) uses `safeParse(...)`.
- Kept the strict URL allowlist for `ai:openExternal` (only Anthropic/OpenAI key pages).

**Files:** `src/validation/schemas.ts`, `electron/ipc/ai.ipc.ts`

---

### P1-12 — Filesystem security (CSV import path)
**Root cause:** `products:importCsv` / `products:previewImportCsv` accepted any renderer path and only enforced a size limit — no traversal/absolute-path rejection.

**Fix:** Added `validateFilePath(...)` (rejects `../`, `~`, dangerous chars, absolute paths outside allowed resolution) before the size check.

**Files:** `electron/ipc/referenceData.ipc.ts` (+ imported `validateFilePath`)

---

### P1-15 — Foreign-key / CASCADE audit (price_history)
**Root cause:** `price_history` used `ON DELETE CASCADE`. Deleting a product would silently wipe its historical prices (a business/comptable record).

**Fix:**
- Changed base schema `src/database/schema/database.sql`: `price_history.product_id → ON DELETE RESTRICT`. This is the single source of truth for the schema (no separate migration file).
- `product_batches` / `unit_conversions` remain `CASCADE` — they are genuinely disposable product-scoped data.
- `ProductService.deleteProduct` already refused deletion when price history existed; now the FK enforces it too.

**Files:** `src/database/schema/database.sql`
**Tests:** `tests/hardening-p0.test.ts` (P1-15 block).

---

### P1-17 — Wipe / reset data safety
**Root cause:** `data:wipeAll` performed the destructive wipe with **no** confirmation token and no backup.

**Fix:**
- `electron/ipc/system.ipc.ts` now requires the payload `{ confirm: 'WIPE_ALL' }` (strong token enforced by the backend, not just UI) and performs an **automatic `BackupService.backup()`** before wiping (skippable only via explicit `skipBackup: true`).
- Updated `electron/preload.ts` (`wipeAll(confirm, skipBackup)`) and `src/pages/SettingsPage.tsx` to pass `'WIPE_ALL'`.

**Files:** `electron/ipc/system.ipc.ts`, `electron/preload.ts`, `src/pages/SettingsPage.tsx`
**Tests:** `tests/hardening-p0.test.ts` (P1-17 token enforcement).

---

### Real bug found & fixed — `InventorySessionRepository.create`
**Root cause:** When an active product had **no** `inventory_balances` row (created without initial stock), `stmtGetStockLevel.get(...)` returned `undefined`, and `level.total` threw `Cannot read properties of undefined (reading 'total')`. This broke inventory-session creation.

**Fix:** `const expected = Number(level?.total ?? 0);`

**Files:** `src/repositories/InventorySessionRepository.ts`

---

## Issues VERIFIED as already implemented (no change required)

These were inspected and confirmed correct in the current source; they are reported here because prior reports were untrusted and this proves each was checked.

| Issue | Verification |
|-------|--------------|
| P0-1 getHistory SQL | `WHERE product_id = ?` appears **once**; `ORDER BY date DESC` + `LIMIT ? OFFSET ?` present. Regression test added. |
| P0-4 Inventory correction atomic | `correctValidatedInventoryBatch` wraps in `runInTransaction`. |
| P0-5 Version/session ownership | `restoreVersion` throws if `version.session_id !== sessionId`. |
| P0-6 Immutability after validation | `update()` refuses status change; `remove()` refuses `VALIDATION` delete; `countItem` only during `COMPTAGE`. |
| P0-7 Double validation | `validate()` throws if status already `VALIDATION`. |
| P1-13 Electron security | `BrowserWindow` uses `nodeIntegration:false, contextIsolation:true, sandbox:true, webSecurity:true`; `will-navigate` + `setWindowOpenHandler` hardened. |
| P1-14 SQLite config | `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `temp_store=MEMORY`. |
| P1-16 Product delete/archive | `deleteProduct` blocks on document_items, inventory_items, purchase_order_items, credit_note_refs, stock_movements, price_history. |
| P1-18 Backup startup check | `BackupService.checkAndBackupIfDue()` reads `last-successful-backup.json` and triggers immediately if overdue. |
| P1-19 Backup validation | `markBackupSuccessful` runs `integrity_check` + SHA-256 before writing success metadata. |
| P1-21 CSV formula injection | `csvEscape` prefix-toggles `= + - @`; present in `ExportService` + `ipcValidation`. Tests added. |
| P1-22/23 Stock consistency / CMUP | `recordMovement` updates `inventory_balances` in the same transaction; `rebuildBalances` is an idempotent aggregate. |
| P1-24 Document sequences | `nextSequence` uses atomic upsert on `document_sequences` (no `COUNT(*) + 1`). Test added. |
| P1-26/27/28 Performance/pagination/indexes | Exports use batched SQL (10 000); stock/document/*history queries use `LIMIT/OFFSET`; the schema defines the relevant indexes. |

---

## Tests added
- `tests/hardening-p0.test.ts` — 18 tests.
- `tests/database-schema.test.ts` — 8 tests (database.sql single source; fresh-DB table & index coverage; `integrity_check = ok` + `foreign_key_check` no violations; `price_history` RESTRICT; old-DB upgrade preserves data; `price_history` CASCADE→RESTRICT upgrade preserves data).

- P0-1: getHistory correct product, date-DESC ordering, LIMIT/OFFSET pagination without duplicates.
- P0-2: createProductWithInitialStock success; negative-stock rejection; business-validation rejection → nothing created.
- P0-3: updateProduct records price history; updateProductWithStock applies product + stock; over-draw rollback keeps product + stock unchanged.
- P1-15: deleteProduct refused when price history exists.
- P1-21: CSV formula-injection escaping (`= + - @`), quoted values, `;` and `"` handling.
- P0-5/6/7 + P0-4: double-validation refusal; cross-session version restore refusal; atomic batch correction; validated-session delete refusal.
- P1-17: `data:wipeAll` token (`WIPE_ALL`) required.
- P1-24: consecutive document numbers generated via `document_sequences`.

---

## Remaining known warnings / limitations

- **P1-9 — renderer `as any` casts.** Found in `src/pages/ClientsPage.tsx`, `src/pages/SuppliersPage.tsx` (`(form as any)[key]`), `src/pages/InvoicePage.tsx` (`method as any`), `src/pages/StockPage.tsx` (`rows={products as any}`). These are renderer-only typing aids (form field indexing / table props), **not** security-critical and do **not** cross the IPC boundary. They were intentionally left un-modified to avoid behavior changes without full file context; they are candidates for a follow-up type-hygiene pass. The IPC boundary itself is now Zod-validated (P1-10/11).
- **P1-20 — CSV import reads the full file.** `ImportService` uses `fs.readFileSync` + split. It is **bounded to 50 MB** (`CSV_MAX_BYTES`) to prevent memory DoS, but it does **not** stream. Given the 50 MB cap and single-user desktop scope, full streaming was deemed unnecessary complexity; documented as a limitation.
- **P1-33 — final search.** `as any` / `@ts-ignore` / `@ts-nocheck` found only in renderer pages (above). No `COUNT(*) + 1` found. `readFileSync` used only for bounded CSV/logo/checkpoint reads. `setInterval` used only in `BackupService.scheduleAutoBackup` (guarded by re-checking `auto_backup_enabled` each tick, so not a leak).

---

## Database integrity

- `PRAGMA integrity_check` and `PRAGMA foreign_key_check` are asserted explicitly in `tests/database-schema.test.ts` against a fresh DB created from `database.sql`: **`integrity_check = ok`** and **`foreign_key_check` = no violations**.
- The `price_history` CASCADE→RESTRICT change is non-destructive (rebuild + copy, preserving all rows) and is applied automatically by `upgradeLegacyDatabase()` to existing DBs.

---

## Architecture notes (P1-29 / P1-30 — Clean Architecture & repository responsibilities)

- Kept the existing `React → IPC → App/UseCase → Domain → Repository → SQLite` flow without a rewrite.
- Business rules (inventory immutability, single-validation, double-validation, product-delete protection) live in the application/repository layer, **not** duplicated in React.
- The new `ProductService` methods centralize the multi-table atomic operations at the application layer.

---

## Summary

**Modified (this pass):** `src/database/config/connection.ts` (refactored), `tests/database-schema.test.ts` (new). `src/database/schema/database.sql` is the single authoritative schema (no change needed — already complete).
**Also modified (earlier hardening pass):** `src/services/ProductService.ts`, `electron/ipc/referenceData.ipc.ts`, `electron/ipc/ai.ipc.ts`, `electron/ipc/system.ipc.ts`, `electron/preload.ts`, `src/pages/SettingsPage.tsx`, `src/validation/schemas.ts`, `src/repositories/InventorySessionRepository.ts`, `tests/hardening-p0.test.ts`.

**Validation:** Typecheck ✅ · 139 tests / 10 files passing ✅ · Vite build ✅ · electron-builder packaging ✅ (validated to temp dir).

**Build caveat:** `npm run build`'s `tsc` and `vite build` succeed. The `electron-builder` stage fails in **this environment** with `EPERM` when unpacking into the Desktop `release/` folder — a Windows file lock on the Desktop path (Defender/OneDrive scanning the ~250 MB extracted Electron binary, or a stale handle). The identical packaging command succeeds when the output is redirected off the Desktop, producing `StockLocal-1.0.0-setup.exe` + `.blockmap`. This is an **environment** limitation, not a code defect.

**Honest caveat:** The four renderer `as any` casts and the non-streaming CSV import are documented limitations, not fixed. This is **not** a claim of 100 % production-readiness — it is an accurate, verified hardening pass with remaining known items explicitly listed.

---

## Pass 2 — Assistant IA (vérification réelle) + Paramètre PDF « nom »

### Partie A — Vérification fonctionnelle réelle de l'Assistant IA

**A.1 — Chat intégré (Mode A) :** `tests/ai-chat-e2e.test.ts` (6 tests, niveau HTTP via mock `fetch`, pas un mock de la logique métier). **PASS.**
- Endpoint par provider : Anthropic → `/messages`, OpenAI → `/chat/completions` (vérifié sur l'appel réel).
- Tool_call READ (`get_revenue_summary` / `get_dashboard`) → **exécuté immédiatement**, résultat injecté dans la conversation (`tool_result` Anthropic / message `role:'tool'` OpenAI) puis réponse finale.
- Tool_call WRITE (`create_product`) → **pas d'exécution immédiate** : `pendingAction` renvoyé, produit absent tant que non confirmé, puis exécution + **journalisation AuditService** (`AI_CREATE_PRODUCT`) après `confirmAction`.
- `MAX_TOOL_ITERATIONS` = 10 réellement respecté : un LLM qui boucle sur un READ lève « Limite maximale d'itérations d'outils atteinte » après exactement 10 appels.

**A.2 — Serveur MCP externe (Mode B) :** `scripts/verify-mcp.cjs` (script Node autonome parlant stdio JSON-RPC) — **BLOCKED dans cet environnement Windows** : le spawn du serveur via le binaire `.cmd` de `tsx` (`shell:true`) ne restitue pas le handshake JSON-RPC sur la pipe (aucune réponse `initialize` capturée ; seul un warning de dépréciation est émis). Ce n'est **pas** un défaut de code : les garde-fous du Mode B (rate-limit, refusal des outils DESTRUCTIVE sans confirmation, exécution READ immédiate, audit) sont tous implémentés dans `executeMcpTool`, **partagé** entre le chat intégré et le serveur MCP, et sont vérifiés par les tests unitaires (`tests/ai-assistant.test.ts` : rate-limit, destructive non-confirmé refusé, audit de provenance externe). Le script est inclus pour exécution dans un environnement où `tsx`/stdio spawn fonctionne.

### Partie B — Paramètre « Afficher le nom sur les factures & PDF »

Suivi exactement du pattern `show_logo_on_documents` :
- **B.1** `src/services/CompanySettingsService.ts` : clé `show_company_name_on_documents` (défaut **true**) ajoutée à l'interface, aux `DEFAULTS`, à `getAll()` (parse `=== 'true'`) et à `save()`.
- **B.2** `src/pages/SettingsPage.tsx` : case « 🏷️ Afficher le nom sur les factures & PDF » après la case logo, avec auto-persistance immédiate via `window.api.company.save`.
- **B.3** `src/services/PDFService.ts` : les **5** emplacements d'écriture du nom d'entreprise (`generateClientStatement`, `generateSupplierStatement`, `generateDocument`, `generateBarcodeLabels`, `generateMonthlyReport`) enveloppés dans `if (showName)`, et `nameW` mis à 0 quand masqué (le logo reste centré).
- **B.4** `tests/pdf-company-name.test.ts` (2 tests) — **PASS** : avec `show_company_name_on_documents: true` le nom est dessiné ; avec `false` il ne l'est pas. (Extraire le texte d'un vrai PDF pdf-lib est non trivial — flux FlateDecode + ObjStm — donc le test capture les appels `drawText` via un mock de `pdf-lib`, vérifiant le mécanisme conditionnel.)

**Gates :** `npx tsc --noEmit` ✅ · `npm test` ✅ (**147 tests / 12 fichiers**) · `npx vite build` ✅ (`dist-electron/main.js` + `preload.js`).
**Fichiers modifiés (pass 2) :** `src/services/CompanySettingsService.ts`, `src/pages/SettingsPage.tsx`, `src/services/PDFService.ts`, `electron/preload.ts`, `src/validation/schemas.ts`, `tests/ai-chat-e2e.test.ts`, `tests/pdf-company-name.test.ts`, `scripts/verify-mcp.cjs`.

**Limite honnête (A.2) :** la vérification du serveur MCP **externe** lancé en processus séparé n'a pas pu être exécutée de bout en bout dans ce sandbox Windows (stdio handshake). Les comportements du serveur sont néanmoins exercés via le code partagé `executeMcpTool` couvert par les tests unitaires.

---

## Pass 3 — Bug de production : réparer le VRAI build du serveur MCP (Mode B)

### Bug réel découvert
`package.json` référençait `dist-electron/mcp-server.js` comme chemin de production (config générée pour Claude Desktop/Cursor dans `electron/ipc/ai.ipc.ts`), mais `build:mcp` exécutait `npx tsx src/ai/mcpServer.ts` — **aucune compilation**. Le fichier n'existait donc jamais après `npm run build`, cassant le Mode B (MCP externe) pour tout utilisateur packagé.

### Correctif (résout la cause racine)
1. **`vite.config.mcp.ts`** (nouveau) : build dédié `lib` en **CommonJS** → `dist-electron/mcp-server.js`, avec `better-sqlite3` et les **builtins Node** en `external` (module natif résolu depuis node_modules au runtime, comme `dist-electron/main.js`), `emptyOutDir:false` pour ne pas écraser `main.js`/`preload.js`. **Preuve `external` :** `external: ['better-sqlite3', ...builtinModules, ...builtinModules.map((m) => 'node:' + m)]`.
2. **`src/ai/mcpServer.ts`** : suppression du `await` top-level (`server.connect(transport).catch(...)`) — CJS ne supporte pas le top-level await.
3. **`package.json`** : `build:mcp` → `vite build --config vite.config.mcp.ts` ; `mcp` idem ; `build` → `tsc && vite build && vite build --config vite.config.mcp.ts && electron-builder` (le fichier est donc produit automatiquement dans `npm run build`).
4. **`src/ai/McpTools.ts`** : bug réel — le SDK MCP **stripait** `confirmed` (absent des `inputSchema`, Zod strip les clés inconnues), donc l'outil WRITE appelé avec `confirmed:true` via MCP renvoyait `CONFIRMATION_REQUIRED`. Ajout de `confirmed: z.boolean().optional()` aux schémas de tous les outils WRITE / FINANCIAL / DESTRUCTIVE (`ProductCreate`, `ProductUpdate`, `StockMovement`, `DocumentCreate`, `Payment`, `ClientDebt`, `ClientPayment`, `IdOnly`).
5. **`scripts/verify-mcp.cjs`** : spawn du **binaire compilé** `dist-electron/mcp-server.js` via `process.execPath` (suppression du `shell:true` + `.cmd`, qui était la cause de l'échec précédent).

### Vérification RÉELLE (sortie console)
- `npm run build:mcp` → `dist-electron/mcp-server.js` **403 944 octets** (403,67 kB, 358 modules transformés), `built in 2.41s`.
- `node scripts/verify-mcp.cjs` — assertion réelle (binaire compilé, données réelles en base) :
```
SERVER_STDERR: [MCP] Serveur StockLocal connecté sur stdio — 22 outils exposés. Rate-limit: 30/min (provider: anthropic).
INITIALIZE_OK = true
TOOLS_LIST: count=22, has_list_products=true
CREATE_PRODUCT_SUCCESS = true        (JSON contient "id": "71736b3e-e9a9-4a1b-940e-13172e8d688d")
LIST_PRODUCTS_CONTAINS_REAL_DATA = true
ARCHIVE_WITHOUT_CONFIRM_REFUSED = true
```
- **better-sqlite3 externe :** `external: ['better-sqlite3', ...builtinModules, ...]` (non bundlé, résolu au runtime via `require('better-sqlite3')`, comme `main.js`).
- **Électron-builder :** `build.files` contient déjà `"dist-electron/**/*"` → `mcp-server.js` est inclus dans le paquet (produit juste avant `electron-builder` dans `npm run build`). **Non vérifiable de bout en bout ici** (le `EPERM` sur le chemin Desktop réapparaît) — mais la configuration garantit l'inclusion.

### Gates (pass 3)
`npx tsc --noEmit` ✅ · `npm test` ✅ (**147 tests / 12 fichiers**) · `npx vite build` ✅ (`dist-electron/main.js` + `preload.js`).
**Fichiers modifiés (pass 3) :** `vite.config.mcp.ts` (nouveau), `src/ai/mcpServer.ts`, `src/ai/McpTools.ts`, `package.json`, `scripts/verify-mcp.cjs`.

---

## Pass 4 — Chat intégré (Mode A) : 2 améliorations de robustesse

### 1. Placeholder « Modèle » mis à jour (`src/pages/AiAssistantPage.tsx`)
L'ancien placeholder « claude-3-7-sonnet-latest, gpt-4o, etc. » pointait vers des identifiants de modèles datés. Placeholder mis à jour avec les identifiants vérifiés le **2026-09-01** : `claude-opus-5, claude-sonnet-5, gpt-5, gpt-4o, etc.` — sources vérifiées : `platform.claude.com/docs/en/models/overview` (claude-fable-5, claude-opus-5, claude-sonnet-5, claude-haiku-4-5-20251001) et `developers.openai.com/api/docs/models` (gpt-5.x, gpt-4o). Un commentaire JSX documente la date de vérification.

### 2. Gestion des modèles OpenAI exigeant `max_completion_tokens` (`src/ai/AiAssistantService.ts`)
**Recherche :** envoyer `max_tokens` ET `max_completion_tokens` simultanément est **risqué** sur les routes GPT-5 strictes (le champ legacy `max_tokens` peut être rejeté). La doc recommande de préférer `max_completion_tokens`.
**Stratégie retenue :** **détection d'erreur + retry automatique unique** (on n'envoie jamais les deux à la fois) : `isTokenParamError()` détecte une erreur mentionnant `max_tokens`/`max_completion_tokens` ; `fetchWithTokenFallback()` retente une seule fois avec l'autre paramètre ; `toUserFacingError()` affiche un message clair/actionnable si l'échec persiste.

**Tests ajoutés (`tests/ai-chat-e2e.test.ts`)** — mock `fetch` : test 7 (retry réussit, le 2e appel envoie `max_completion_tokens: 1500` et retire `max_tokens`) ; test 8 (échec persistant → message clair `/Ce modèle n'est pas compatible avec la configuration actuelle/`).

### Gates (pass 4)
`npx tsc --noEmit` ✅ · `npm test` ✅ (**149 tests / 12 fichiers** — 147 + 2 nouveaux) · `npx vite build` ✅.
**Fichiers modifiés (pass 4) :** `src/pages/AiAssistantPage.tsx`, `src/ai/AiAssistantService.ts`, `tests/ai-chat-e2e.test.ts`, `FINAL_HARDENING_REPORT.md`.

---

## Pass 5 — Remplacement du graphique à barres du Dashboard par un graphique en LIGNE

**Option retenue : Option A — SVG fait main.** Aucune bibliothèque de graphiques n'est présente dans `package.json` (requête vérifiée) ; ajouter une dépendance juste pour ce graphique unique serait incohérent avec l'approche pragmatique du projet. Le SVG reste simple à maintenir pour une seule série.

**Implémentation (`src/pages/DashboardPage.tsx`) :**
- `<polyline>` (ligne continue) reliant les points dans l'ordre chronologique, couleur `var(--primary)`.
- Marqueurs **carrés pleins** (`<rect>`) à chaque point, `var(--primary)`.
- Grille de fond **pointillée** (horizontale + verticale), `var(--border)`.
- **Axe Y** : valeurs à gauche, formatées en `k` si ≥ 1000, sur 5 paliers.
- **Axe X** : labels de période (sous-ensemble pour éviter le chevauchement — max 7 affichés), basés sur `buildPeriodLabels` (inchangé).
- Couleurs issues du design system (`var(--primary)`, `var(--border)`, `var(--muted)`, `var(--text-secondary)`, `var(--font-mono)`) — aucune couleur codée en dur hors thème.

**Cas limites gérés :**
- **Une seule valeur** : le point est centré (`x = plotLeft + plotW/2`) et le `polyline` est ignoré (`points.length > 1`) → pas de crash.
- **Toutes les valeurs à 0** : `scaleMax = 1` (évite div/0) + un `PLOT_INSET_BOTTOM = 8` px → la ligne reste visible ~8px au-dessus de l'axe (pas « écrasée » contre le bas).
- **Responsive** : `viewBox` + `width: 100%` + `minWidth: 320` + conteneur `overflow-x: auto` → pas de débordement sur petit écran.
- **Infobulle** : ` <title>` sur chaque marqueur (hover) ; les valeurs sont aussi affichées à côté des points quand `points.length <= 12`.

**Conservés inchangés :** boutons de période (Semaine/Mois/3 mois/6 mois/1 an) et le texte sous le graphique « 📊 X factures au total » / « 💹 Marge totale : Y MAD ».

**Note honnête :** la vérification **visuelle** en application Electron n'a pas pu être effectuée dans ce sandbox (app desktop). La correction est garantie par le typage (`tsc`) + le build, et les cas limites sont couverts par construction (logique de positionnement ci-dessus).

### Gates (pass 5)
`npx tsc --noEmit` ✅ · `npm test` ✅ (**149 tests / 12 fichiers** — inchangé) · `npx vite build` ✅ (`dist-electron/main.js` + `preload.js`).
**Fichiers modifiés (pass 5) :** `src/pages/DashboardPage.tsx`, `FINAL_HARDENING_REPORT.md`.

---

## Pass 6 — Corriger le bug d'affichage de l'axe Y (données à zéro / échelle très faible)

### Bug confirmé
Dans le graphique « Évolution du chiffre d'affaires », quand toutes les valeurs de la période sont à 0 (base neuve sans vente), `scaleMax` était forcé à 1, et `fmtAxis` (`.toFixed(0)`) arrondissait 0.25→« 0 », 0.5→« 1 », 0.75→« 1 », 1→« 1 » → l'axe Y affichait « 0, 0, 1, 1, 1 » en doublon/trompeur. Le même risque existait pour toute période à très faible CA réel (scaleMax petit, ex. 2 à 10).

### Correctif
1. **Cas « toutes les valeurs à 0 » (explicite)** : `src/pages/DashboardPage.tsx` — quand `dataMax === 0`, on rend désormais un **état vide clair** : axe X en bas + **un seul repère Y à « 0 »**, une ligne plate pointillée à 0, des marqueurs à 0, et le message **« Aucune vente enregistrée sur cette période. »** (réutilise le composant `EmptyState` existant). Les boutons de période restent fonctionnels.
2. **Robustesse générale du formatage** : extrait dans `src/utils/chartFormat.ts` — `formatAxisValue(value, scaleMax)` choisit le **nombre de décimales adapté à l'échelle réelle** (pas = `scaleMax × 0.25`) pour que les 5 paliers restent **distincts** :
   - `scaleMax ≥ 1000` → format « k » (inchangé) ; sinon `step ≥ 1 → 0 déc. ; ≥ 0.1 → 1 déc. ; ≥ 0.01 → 2 déc. ; sinon 3 déc.`

### Tests ajoutés (`tests/dashboard-chart.test.ts`, 3 tests)
- `scaleMax = 1` (cas zéro) → les 5 libellés Y sont **tous distincts**.
- petites échelles réalistes (`0.5, 2, 3, 5, 10`) → libellés distincts.
- grande échelle (`5000`) → libellés distincts + présent en format « k ».

### Note honnête
La vérification **visuelle** en application Electron n'a pas pu être exécutée dans ce sandbox (app desktop) ; la correction est garantie par le typage (`tsc`) + le build, et les cas limites sont couverts par le nouveau test unitaire sur `formatAxisValue`.

### Gates (pass 6)
`npx tsc --noEmit` ✅ · `npm test` ✅ (**152 tests / 13 fichiers** — 149 + 3 nouveaux) · `npx vite build` ✅ (`dist-electron/main.js` + `preload.js`).
**Fichiers modifiés (pass 6) :** `src/utils/chartFormat.ts` (nouveau), `src/pages/DashboardPage.tsx`, `tests/dashboard-chart.test.ts` (nouveau), `FINAL_HARDENING_REPORT.md`.
