import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * §P0 — Garde-fou d'architecture : le RENDERER ne doit JAMAIS importer, par
 * valeur, un module du process principal.
 *
 * POURQUOI : `src/main.tsx` importe `App`, qui importe TOUTES les pages. Si une
 * seule page fait un import PAR VALEUR vers un module qui finit par toucher
 * `database/config/connection` (better-sqlite3 + `electron`), ce code est
 * embarqué dans le bundle du navigateur, son évaluation échoue à l'import, et
 * toute l'application reste sur une FENÊTRE ENTIÈREMENT BLANCHE.
 *
 * `tsc --noEmit` ne détecte PAS ce bug, et les tests Node ne le détectent pas
 * non plus (les imports y fonctionnent). Ce test le détecte statiquement.
 *
 * Règle : depuis `src/pages`, `src/components` et `src/stores`, tout import
 * d'un module `services/`, `repositories/`, `usecases/`, `database/` ou `ai/`
 * doit être `import type { ... }` (effacé à la compilation) ou n'importer que
 * des symboles préfixés par `type `.
 */

const RENDERER_DIRS = ['src/pages', 'src/components', 'src/stores'];

/** Un spécifieur relatif qui cible une couche du process principal. */
const MAIN_PROCESS_SPECIFIER = /^\.\.?(?:\/\.\.)*\/(?:services|repositories|usecases|database|ai)\//;

/** Un import complet : clause … from 'specifier'. */
const IMPORT_STATEMENT = /^import\s+([\s\S]*?)\s+from\s+'([^']+)'/gm;

interface Violation {
  file: string;
  line: number;
  specifier: string;
  clause: string;
}

function collectTsFiles(dir: string, acc: string[]): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Vrai si la clause d'import ne contient que du type (donc effaçable). */
function isTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim();

  // `import type { A, B } from '...'`
  if (/^type\s/.test(trimmed)) return true;

  // `import { A, type B } from '...'` → OK seulement si TOUS sont `type`.
  const braced = trimmed.match(/^\{([\s\S]*)\}$/);
  if (!braced) return false; // import par défaut / espace de noms → par valeur

  const entries = braced[1]
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  return entries.length > 0 && entries.every((e) => /^type\s/.test(e));
}

describe('§P0 — sécurité des imports du renderer', () => {
  it('aucune page/composant/store n’importe par valeur un module du process principal', () => {
    const violations: Violation[] = [];

    for (const dir of RENDERER_DIRS) {
      for (const file of collectTsFiles(dir, [])) {
        const content = fs.readFileSync(file, 'utf-8');
        for (const match of content.matchAll(IMPORT_STATEMENT)) {
          const clause = match[1];
          const specifier = match[2];
          if (!MAIN_PROCESS_SPECIFIER.test(specifier)) continue;
          if (isTypeOnlyClause(clause)) continue;

          const line = content.slice(0, match.index ?? 0).split('\n').length;
          violations.push({ file, line, specifier, clause: clause.replace(/\s+/g, ' ').trim() });
        }
      }
    }

    const report = violations
      .map((v) => `${v.file}:${v.line} -> import { ${v.clause} } from '${v.specifier}'`)
      .join('\n');

    expect(
      violations,
      `Import(s) PAR VALEUR d'un module du process principal depuis le renderer.\n` +
        `Cela embarque better-sqlite3/electron dans le bundle navigateur et provoque\n` +
        `une fenetre entierement blanche (echec d'evaluation du module).\n` +
        `Solution : deplacer les constantes/types purs dans src/domain/ et les importer de la.\n` +
        report,
    ).toEqual([]);
  });
});
