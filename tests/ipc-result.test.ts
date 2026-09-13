import { describe, it, expect } from 'vitest';
import { toIpcResult } from '../src/utils/ipcResult';

/**
 * Tests du normalisateur d'enveloppe IPC.
 *
 * `toIpcResult` est la frontière unique entre `ipcRenderer.invoke` (typé `any`)
 * et les composants React : il doit préserver EXACTEMENT le comportement
 * historique tout en fournissant un type au call site.
 */
describe('toIpcResult — normalisation de l’enveloppe IPC', () => {
  it('extrait `data` d’une réponse { success: true, data }', () => {
    const result = toIpcResult<{ id: string; total: number }>({
      success: true,
      data: { id: 'abc', total: 42 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: 'abc', total: 42 });
    }
  });

  it('signale un échec avec le message d’erreur du handler', () => {
    const result = toIpcResult<number>({ success: false, error: 'Accès refusé.' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Accès refusé.');
    }
  });

  it('tolère un échec sans message (error absent)', () => {
    const result = toIpcResult<number>({ success: false });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeUndefined();
    }
  });

  it('ignore un `error` non textuel plutôt que de propager une valeur non sûre', () => {
    const result = toIpcResult<number>({ success: false, error: { code: 500 } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeUndefined();
    }
  });

  it('accepte une réponse DIRECTE (objet métier sans enveloppe) — rétro-compatibilité', () => {
    const direct = { entityId: 'c1', balance: 120 };
    const result = toIpcResult<typeof direct>(direct);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(direct);
    }
  });

  it('accepte un tableau direct (listes renvoyées telles quelles)', () => {
    const rows = [{ id: '1' }, { id: '2' }];
    const result = toIpcResult<typeof rows>(rows);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
    }
  });

  it('traite `null` comme une donnée directe (pas de crash)', () => {
    const result = toIpcResult<null>(null);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('traite `undefined` comme une donnée directe (pas de crash)', () => {
    const result = toIpcResult<undefined>(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeUndefined();
    }
  });

  it('un objet `{ success: true }` SANS clé `data` est traité comme donnée directe', () => {
    const raw = { success: true };
    const result = toIpcResult<typeof raw>(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(raw);
    }
  });

  it('ne confond pas un objet métier possédant un champ `success` numérique', () => {
    const row = { success: 1, label: 'ok' };
    const result = toIpcResult<typeof row>(row);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(row);
    }
  });
});
