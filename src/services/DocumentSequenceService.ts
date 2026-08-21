import { db } from '../database/config/connection';

/**
 * §20 — Allocation transactionnelle des numéros de documents.
 *
 * Remplace le fragile `COUNT(*) + 1` : la génération passe par la table
 * `document_sequences` avec un upsert atomique (INSERT ... ON CONFLICT DO
 * UPDATE ... RETURNING). SQLite garantit l'atomicité de cette opération :
 *   - aucun chevauchement de numéros après rollback, suppression ou import ;
 *   - aucune collision entre types/années (PK composite type + year) ;
 *   - le format des numéros existants est conservé (PREFIXE-AAAA-#####).
 *
 * La table est semée au démarrage (migration `migrateDocumentSequences`) avec
 * les valeurs maximales déjà utilisées par les bases existantes, ce qui évite
 * toute collision avec les documents déjà enregistrés.
 */
const stmtNext = db.prepare(`
  INSERT INTO document_sequences (type, year, last_number)
  VALUES (?, ?, 1)
  ON CONFLICT(type, year) DO UPDATE SET
    last_number = last_number + 1,
    updated_at = CURRENT_TIMESTAMP
  RETURNING last_number
`);

/** Retourne le prochain numéro (≥ 1) pour un type et une année donnés. */
export function nextSequence(type: string, year: number): number {
  const row = stmtNext.get(type, year) as { last_number: number } | undefined;
  if (!row || !Number.isFinite(row.last_number)) {
    throw new Error(`Impossible de générer le numéro de document (type ${type}, année ${year}).`);
  }
  return row.last_number;
}
