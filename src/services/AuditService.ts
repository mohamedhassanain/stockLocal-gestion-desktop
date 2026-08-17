import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

/**
 * Journalisation des actions sensibles (cahier des charges §9) :
 * création/modification/suppression, annulation, inventaires, paiements.
 */
export const AuditService = {
  log(action: string, entityType: string, entityId: string, details?: string, userId: string = 'user_1'): void {
    try {
      db.prepare(`
        INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), userId, action, entityType, entityId, details ?? null);
    } catch (e) {
      console.error('[Audit] Échec de journalisation :', e);
    }
  },

  getLogs(limit: number = 200, offset: number = 0): Array<{
    id: string;
    user_id: string;
    username: string;
    action: string;
    entity_type: string;
    entity_id: string;
    details: string | null;
    created_at: string;
  }> {
    return db.prepare(`
      SELECT a.*, COALESCE(u.username, 'inconnu') AS username
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as any;
  }
};
