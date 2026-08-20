import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

/**
 * Journalisation des actions sensibles (cahier des charges §9 et §11).
 *
 * §11 : chaque opération critique est traçable avec les valeurs avant/après :
 *   - old_value / new_value : JSON brut de l'état avant et après la modification
 *     (ex. prix produit, stock, statut document).
 *   - les mots de passe ou secrets ne sont JAMAIS journalisés.
 *
 * Application single-user : pas de user_id (la colonne pourra être ajoutée
 * lors du passage multi-utilisateurs sans casser les données existantes).
 */

export interface AuditLogEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    if (typeof value === 'string') {
      // Déjà du JSON ? On le stocke tel quel, sinon on l'encapsule
      try { JSON.parse(value); return value; } catch { return JSON.stringify({ value }); }
    }
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export const AuditService = {
  /**
   * Journalise une action.
   *
   * @param action      Code d'action (ex. PRODUCT_UPDATE, DOCUMENT_PAYMENT)
   * @param entityType  Type d'entité (product, document, client, stock, system)
   * @param entityId    Identifiant de l'entité
   * @param details     Description lisible (jamais de secret, jamais de mot de passe)
   * @param oldValue    Valeur avant modification (JSON ou primitive) — optionnel
   * @param newValue    Valeur après modification (JSON ou primitive) — optionnel
   */
  log(
    action: string,
    entityType: string,
    entityId: string,
    details?: string,
    oldValue?: unknown,
    newValue?: unknown,
  ): void {
    try {
      db.prepare(`
        INSERT INTO audit_logs (id, action, entity_type, entity_id, details, old_value, new_value)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        action,
        entityType,
        entityId,
        details ?? null,
        toJson(oldValue),
        toJson(newValue),
      );
    } catch (e) {
      console.error('[Audit] Échec de journalisation :', e);
    }
  },

  getLogs(limit: number = 200, offset: number = 0): AuditLogEntry[] {
    return db.prepare(`
      SELECT a.*
      FROM audit_logs a
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as AuditLogEntry[];
  }
};
