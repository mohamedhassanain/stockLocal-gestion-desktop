import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { GlobalSettingsService } from '../src/services/GlobalSettingsService';
import { CashSessionRepository } from '../src/repositories/CashSessionRepository';
import {
  DEFAULT_CASH_MOVEMENT_TYPES,
  parseCashMovementTypes,
  normalizeCashMovementTypes,
  cashMovementDirection,
  cashMovementTypeLabel,
} from '../src/domain/cash/cashMovementTypes';

/**
 * Types de mouvement de caisse définis par l'utilisateur (Paramètres → Caisse).
 *
 * L'utilisateur crée ses propres types (libellé + sens), ils sont persistés dans
 * `global_settings.cash_movement_types` et proposés dans « Caisse → Nouveau mouvement → Type ».
 */

function resetCashData(): void {
  db.prepare('DELETE FROM global_settings WHERE key = ?').run('cash_movement_types');
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('DELETE FROM cash_movements; DELETE FROM cash_sessions;');
  db.exec('PRAGMA foreign_keys = ON;');
}

describe('Types de mouvement de caisse (définis par l\'utilisateur)', () => {
  beforeEach(() => { resetCashData(); });

  it('retombe sur les types par défaut quand aucun n\'est enregistré', () => {
    expect(parseCashMovementTypes(null)).toEqual([...DEFAULT_CASH_MOVEMENT_TYPES]);

    const settings = GlobalSettingsService.getAll();
    expect(settings.cash_movement_types.length).toBe(DEFAULT_CASH_MOVEMENT_TYPES.length);
    expect(settings.cash_movement_types.map(t => t.label)).toContain('Vente espèces');
  });

  it('persiste et relit les types personnalisés (libellé + sens)', () => {
    const custom = [
      { label: 'Vente espèces', direction: 'IN' as const },
      { label: 'Mobile Money', direction: 'IN' as const },
      { label: 'Pourboire', direction: 'OUT' as const },
    ];
    GlobalSettingsService.save({ cash_movement_types: custom });

    const saved = GlobalSettingsService.getAll().cash_movement_types;
    expect(saved).toEqual(custom);
  });

  it('normalise : nettoie les espaces, retire les doublons (casse ignorée) et les entrées vides', () => {
    const raw = [
      { label: '  Vente  ', direction: 'IN' },
      { label: 'VENTE', direction: 'OUT' },
      { label: '', direction: 'IN' },
      'Ancien format',
      { label: 'Don', direction: 'IN' },
    ];

    const result = normalizeCashMovementTypes(raw);
    expect(result.map(t => t.label)).toEqual(['Vente', 'Ancien format', 'Don']);
    // Le premier sens rencontré est conservé pour un libellé dupliqué.
    expect(result[0].direction).toBe('IN');
  });

  it('gère les valeurs stockées illisibles ou vides', () => {
    expect(parseCashMovementTypes('pas du json')).toEqual([...DEFAULT_CASH_MOVEMENT_TYPES]);
    expect(parseCashMovementTypes('[]')).toEqual([...DEFAULT_CASH_MOVEMENT_TYPES]);
  });

  it('un mouvement de caisse accepte un libellé personnalisé et l\'enregistre tel quel', () => {
    const session = CashSessionRepository.openSession(0);
    const movement = CashSessionRepository.addMovement({
      movementType: 'Mobile Money', direction: 'IN', amount: 250,
    });
    expect(movement.movement_type).toBe('Mobile Money');

    const detail = CashSessionRepository.getSessionDetail(session.id);
    expect(detail.movements).toHaveLength(1);
    expect(detail.movements[0].movement_type).toBe('Mobile Money');
    expect(detail.totalCashIn).toBe(250);
  });

  it('direction() et label() gèrent types personnalisés et codes hérités', () => {
    const types = [{ label: 'Sortie caisse', direction: 'OUT' as const }];
    expect(cashMovementDirection(types, 'Sortie caisse')).toBe('OUT');
    expect(cashMovementDirection(types, 'MANUAL_OUT')).toBe('OUT');
    expect(cashMovementDirection(types, 'SALE_CASH')).toBe('IN');

    expect(cashMovementTypeLabel('MANUAL_IN')).toBe('Entrée manuelle');
    expect(cashMovementTypeLabel('Mobile Money')).toBe('Mobile Money');
  });
});
