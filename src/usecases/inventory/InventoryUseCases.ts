/**
 * Use Cases — Inventaire Physique
 *
 * Règle Clean Architecture : ces Use Cases orchestrent le workflow complet
 * de l'inventaire physique (création → comptage → validation → correction).
 * Ils délèguent au InventorySessionRepository et au StockLedgerService.
 *
 * Workflow :
 *   DRAFT → COMPTAGE → CALCUL → VALIDATION
 *
 * Après validation, toute correction génère un mouvement ADJUSTMENT dans
 * le Stock Ledger (jamais de modification directe de l'inventaire validé).
 */

import { InventorySessionRepository } from '../../repositories/InventorySessionRepository';
import { AuditService } from '../../services/AuditService';
import type { InventorySession } from '../../repositories/InventorySessionRepository';

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface CreateInventoryInput {
  name: string;
  notes?: string | null;
}

export interface CountInventoryItemInput {
  itemId: string;
  countedQty: number;
}

export interface RestoreInventoryVersionInput {
  sessionId: string;
  versionId: string;
  note?: string | null;
}

export interface CorrectInventoryInput {
  sessionId: string;
  /** Corrections à appliquer : { itemId → quantité corrigée } */
  corrections: Record<string, number>;
  note?: string | null;
}

// ─── Use Cases ───────────────────────────────────────────────────────────────

/**
 * UC-I01 : Créer une nouvelle session d'inventaire (statut DRAFT).
 */
export function createInventoryUseCase(input: CreateInventoryInput): InventorySession {
  const session = InventorySessionRepository.create({
    name: input.name.trim(),
    notes: input.notes ?? undefined,
  });
  AuditService.log('INVENTORY_CREATE', 'inventory', session.id, `Session "${session.name}" créée`);
  return session;
}

/**
 * UC-I02 : Démarrer le comptage physique d'une session (DRAFT → COMPTAGE).
 * Charge tous les produits actifs comme lignes à compter.
 */
export function startInventoryCountingUseCase(sessionId: string): InventorySession {
  const session = InventorySessionRepository.startCounting(sessionId);
  AuditService.log('INVENTORY_COUNT_START', 'inventory', sessionId, `Comptage démarré "${session.name}"`);
  return session;
}

/**
 * UC-I03 : Enregistrer la quantité comptée pour un article.
 * Crée automatiquement une nouvelle version de l'inventaire pour traçabilité.
 */
export function countInventoryItemUseCase(input: CountInventoryItemInput): void {
  if (!Number.isFinite(input.countedQty) || input.countedQty < 0) {
    throw new Error('La quantité comptée doit être un nombre positif ou nul.');
  }
  InventorySessionRepository.countItem(input.itemId, input.countedQty);
}

/**
 * UC-I04 : Calculer les écarts (COMPTAGE → CALCUL).
 */
export function calculateInventoryGapsUseCase(sessionId: string): InventorySession {
  const session = InventorySessionRepository.calculateGaps(sessionId);
  AuditService.log('INVENTORY_CALCUL', 'inventory', sessionId, `Écarts calculés "${session.name}"`);
  return session;
}

/**
 * UC-I05 : Valider l'inventaire (CALCUL → VALIDATION).
 * Génère les mouvements ADJUSTMENT_IN / ADJUSTMENT_OUT dans le Stock Ledger.
 * L'inventaire validé ne peut plus être modifié directement.
 */
export function finalizeInventoryUseCase(sessionId: string): InventorySession {
  const session = InventorySessionRepository.validate(sessionId);
  AuditService.log('INVENTORY_VALIDATE', 'inventory', sessionId, `Inventaire validé "${session.name}"`);
  return session;
}

/**
 * UC-I06 : Restaurer une version précédente d'une session en cours.
 * NE SUPPRIME PAS les versions existantes — crée une nouvelle version
 * (copie de la version cible) pour conserver l'audit trail complet.
 *
 * Exemple :
 *   V1=95, V2=97, V3=96 → restore V2 → V4=97
 *   V1, V2, V3 restent intacts dans l'historique.
 */
export function restoreInventoryVersionUseCase(input: RestoreInventoryVersionInput): void {
  InventorySessionRepository.restoreVersion(
    input.sessionId,
    input.versionId,
    input.note ?? undefined
  );
  AuditService.log(
    'INVENTORY_RESTORE',
    'inventory',
    input.sessionId,
    `Version ${input.versionId} restaurée${input.note ? ` — ${input.note}` : ''}`
  );
}

/**
 * UC-I07 : Créer une snapshot (version) de l'état actuel d'une session.
 * Utilisé pour sauvegarder l'état avant une modification importante.
 */
export function saveInventoryVersionUseCase(sessionId: string, note?: string): void {
  InventorySessionRepository.createVersion(sessionId, note ?? 'Sauvegarde manuelle');
  AuditService.log('INVENTORY_VERSION', 'inventory', sessionId, `Version sauvegardée — ${note ?? 'manuelle'}`);
}

/**
 * UC-I08 : Corriger un inventaire après validation.
 * Génère des mouvements ADJUSTMENT dans le Stock Ledger.
 * L'inventaire validé lui-même n'est JAMAIS modifié directement.
 */
export function correctValidatedInventoryUseCase(input: CorrectInventoryInput): void {
  // P0-4 : correction en lot ATOMIQUE (une seule transaction).
  InventorySessionRepository.correctValidatedInventoryBatch(input.sessionId, input.corrections);
  const count = Object.keys(input.corrections).length;
  AuditService.log(
    'INVENTORY_CORRECT',
    'inventory',
    input.sessionId,
    `Correction post-validation : ${count} article(s)${input.note ? ` — ${input.note}` : ''}`
  );
}

/**
 * UC-I09 : Supprimer une session d'inventaire (DRAFT uniquement).
 * Refuse la suppression d'une session VALIDATION.
 */
export function deleteInventorySessionUseCase(sessionId: string): void {
  InventorySessionRepository.remove(sessionId);
  AuditService.log('INVENTORY_DELETE', 'inventory', sessionId, 'Session supprimée');
}

/**
 * UC-I10 : Lister toutes les versions d'une session.
 */
export function getInventoryVersionsUseCase(sessionId: string): unknown[] {
  return InventorySessionRepository.getVersions(sessionId);
}
