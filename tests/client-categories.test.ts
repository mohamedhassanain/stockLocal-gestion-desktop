import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { GlobalSettingsService } from '../src/services/GlobalSettingsService';
import { ClientRepository } from '../src/repositories/ClientRepository';
import {
  DEFAULT_CLIENT_CATEGORIES,
  parseClientCategories,
  normalizeClientCategories,
} from '../src/domain/clients/clientCategories';

/**
 * Catégories de clients définies par l'utilisateur (Paramètres → Catégories clients).
 *
 * L'utilisateur crée ses propres catégories (ex : « Revendeur »), persistées dans
 * `global_settings.client_categories` et proposées dans
 * « Clients → Nouveau Client → Catégorie ».
 */

function reset(): void {
  db.prepare('DELETE FROM global_settings WHERE key = ?').run('client_categories');
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('DELETE FROM client_credits; DELETE FROM customers;');
  db.exec('PRAGMA foreign_keys = ON;');
}

describe('Catégories de clients (définies par l\'utilisateur)', () => {
  beforeEach(() => { reset(); });

  it('propose les catégories par défaut quand rien n\'est enregistré', () => {
    const categories = GlobalSettingsService.getAll().client_categories;
    expect(categories).toEqual([...DEFAULT_CLIENT_CATEGORIES]);
    expect(categories).toContain('DÉTAIL');
    expect(categories).toContain('GROSSISTE');
    expect(categories).toContain('VIP');
  });

  it('un utilisateur peut définir ses catégories (ex : Revendeur, Dépanneur)', () => {
    GlobalSettingsService.save({ client_categories: ['Revendeur', 'Dépanneur'] });
    expect(GlobalSettingsService.getAll().client_categories).toEqual(['Revendeur', 'Dépanneur']);
  });

  it('persiste la liste dans global_settings et la relit', () => {
    const categories = ['DÉTAIL', 'GROSSISTE', 'Revendeur'];
    GlobalSettingsService.save({ client_categories: categories });
    expect(GlobalSettingsService.getAll().client_categories).toEqual(categories);
  });

  it('normalise : nettoie les espaces, retire doublons et entrées vides/non-texte', () => {
    expect(normalizeClientCategories(['  VIP ', 'vip', '', 42, 'Revendeur'])).toEqual(['VIP', 'Revendeur']);
  });

  it('retombe sur les catégories par défaut si la valeur est vide ou illisible', () => {
    expect(parseClientCategories(null)).toEqual([...DEFAULT_CLIENT_CATEGORIES]);
    expect(parseClientCategories('[]')).toEqual([...DEFAULT_CLIENT_CATEGORIES]);
    expect(parseClientCategories('pas du json')).toEqual([...DEFAULT_CLIENT_CATEGORIES]);
  });

  it('un client accepte une catégorie personnalisée et la restitue', () => {
    GlobalSettingsService.save({ client_categories: ['Revendeur'] });
    const client = ClientRepository.create({ name: 'Client Test', credit_limit: 0, category: 'Revendeur' });
    expect(client.category).toBe('Revendeur');
    expect(ClientRepository.getById(client.id)?.category).toBe('Revendeur');
  });

  it('un client sans catégorie explicite retombe sur le défaut historique (DÉTAIL)', () => {
    const client = ClientRepository.create({
      name: 'Client Sans Catégorie',
      credit_limit: 0,
    } as unknown as Parameters<typeof ClientRepository.create>[0]);
    expect(client.category).toBe('DÉTAIL');
  });
});
