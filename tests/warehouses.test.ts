import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { WarehouseRepository } from '../src/repositories/WarehouseRepository';

/**
 * Phase 5 — Dépôts (`warehouses`). Portée réduite (cf. docs/PHASE5_MULTI_DEPOTS.md) :
 * référentiel CRUD + unicité du dépôt par défaut. Pas de ventilation du stock.
 */

function cleanup(): void {
  db.prepare('DELETE FROM warehouses').run();
}

describe('Phase 5 — Dépôts (référentiel)', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('crée, liste et met à jour un dépôt', () => {
    const w = WarehouseRepository.create({ name: 'Dépôt principal', address: 'Casablanca' });
    expect(w.name).toBe('Dépôt principal');
    expect(w.address).toBe('Casablanca');
    expect(w.is_default).toBe(0);

    const updated = WarehouseRepository.update(w.id, { name: 'Dépôt central', address: 'Rabat', is_default: false });
    expect(updated.name).toBe('Dépôt central');
    expect(WarehouseRepository.getAll()).toHaveLength(1);
  });

  it('refuse un nom vide', () => {
    expect(() => WarehouseRepository.create({ name: '   ' })).toThrow(/nom du dépôt/i);
  });

  it('garantit UN SEUL dépôt par défaut', () => {
    const a = WarehouseRepository.create({ name: 'A', is_default: true });
    const b = WarehouseRepository.create({ name: 'B', is_default: true });

    // Le dernier marqué par défaut est le seul par défaut.
    expect(WarehouseRepository.getDefault()?.id).toBe(b.id);
    expect(WarehouseRepository.getById(a.id)?.is_default).toBe(0);

    WarehouseRepository.setDefault(a.id);
    expect(WarehouseRepository.getDefault()?.id).toBe(a.id);
    expect(WarehouseRepository.getById(b.id)?.is_default).toBe(0);
  });

  it('promeut un dépôt par défaut après suppression du dépôt par défaut', () => {
    const def = WarehouseRepository.create({ name: 'Principal', is_default: true });
    WarehouseRepository.create({ name: 'Secondaire' });

    WarehouseRepository.remove(def.id);
    const remaining = WarehouseRepository.getAll();
    expect(remaining).toHaveLength(1);
    expect(WarehouseRepository.getDefault()?.id).toBe(remaining[0].id);
  });
});
