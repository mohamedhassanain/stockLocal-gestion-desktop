import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

/**
 * Phase 5 — Dépôts (`warehouses`).
 *
 * PORTÉE VOLONTAIREMENT RÉDUITE (cf. docs/PHASE5_MULTI_DEPOTS.md) :
 * la table `warehouses` sert de référentiel (nom, adresse, dépôt par défaut).
 * Le stock reste comptabilisé GLOBALEMENT par produit dans `inventory_balances`
 * (aucune ventilation par dépôt), et la table `stock_transfers` N'EXISTE PAS
 * dans le schéma : aucun transfert inter-dépôts n'est implémenté à ce stade.
 */

export interface Warehouse {
  id: string;
  name: string;
  address: string | null;
  is_default: number;
  created_at?: string;
  updated_at?: string;
}

const stmtAll = db.prepare('SELECT * FROM warehouses ORDER BY is_default DESC, name ASC');
const stmtGetById = db.prepare('SELECT * FROM warehouses WHERE id = ?');
const stmtGetDefault = db.prepare('SELECT * FROM warehouses WHERE is_default = 1 LIMIT 1');
const stmtInsert = db.prepare(`
  INSERT INTO warehouses (id, name, address, is_default)
  VALUES (?, ?, ?, ?)
`);
const stmtUpdate = db.prepare(`
  UPDATE warehouses SET name = ?, address = ?, is_default = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);
const stmtClearDefault = db.prepare('UPDATE warehouses SET is_default = 0');
const stmtDelete = db.prepare('DELETE FROM warehouses WHERE id = ?');

function normalizeDefault(warehouseId: string | null, isDefault: boolean): void {
  if (isDefault) {
    // Un seul dépôt par défaut : on nettoie avant de marquer.
    stmtClearDefault.run();
    if (warehouseId) db.prepare('UPDATE warehouses SET is_default = 1 WHERE id = ?').run(warehouseId);
  }
}

export const WarehouseRepository = {
  getAll(): Warehouse[] {
    return stmtAll.all() as Warehouse[];
  },

  getById(id: string): Warehouse | undefined {
    return stmtGetById.get(id) as Warehouse | undefined;
  },

  getDefault(): Warehouse | undefined {
    return stmtGetDefault.get() as Warehouse | undefined;
  },

  create(data: { name: string; address?: string | null; is_default?: boolean }): Warehouse {
    const name = data.name.trim();
    if (!name) throw new Error('Le nom du dépôt est obligatoire.');

    const id = randomUUID();
    const isDefault = data.is_default ? 1 : 0;
    db.transaction(() => {
      if (isDefault) stmtClearDefault.run();
      stmtInsert.run(id, name, data.address ?? null, isDefault);
    })();
    return this.getById(id)!;
  },

  update(id: string, data: { name: string; address?: string | null; is_default?: boolean }): Warehouse {
    const existing = this.getById(id);
    if (!existing) throw new Error('Dépôt introuvable.');
    const name = data.name.trim();
    if (!name) throw new Error('Le nom du dépôt est obligatoire.');

    const isDefault = data.is_default ? 1 : 0;
    db.transaction(() => {
      if (isDefault) stmtClearDefault.run();
      stmtUpdate.run(name, data.address ?? null, isDefault, id);
    })();
    return this.getById(id)!;
  },

  remove(id: string): void {
    stmtDelete.run(id);
    // S'il n'existe plus de dépôt par défaut, promouvoir le premier restant.
    if (!this.getDefault()) {
      const first = this.getAll()[0];
      if (first) normalizeDefault(first.id, true);
    }
  },

  setDefault(id: string): void {
    if (!this.getById(id)) throw new Error('Dépôt introuvable.');
    normalizeDefault(id, true);
  },
};
