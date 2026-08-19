import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

/**
 * Journalisation des actions sensibles (cahier des charges §9) :
 * création/modification/suppression, annulation, inventaires, paiements.
 * 
 * Application single-user : pas de user_id, l'audit est traçable mais sans compte.
 */
export const AuditService = {
  log(action: string, entityType: string, entityId: string, details?: string): void {
    try {
      db.prepare(`
        INSERT INTO audit_logs (id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), action, entityType, entityId, details ?? null);
    } catch (e) {
      console.error('[Audit] Échec de journalisation :', e);
    }
  },

  getLogs(limit: number = 200, offset: number = 0): Array<{
    id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    details: string | null;
    created_at: string;
  }> {
    return db.prepare(`
      SELECT a.*
      FROM audit_logs a
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as any;
  }
};
