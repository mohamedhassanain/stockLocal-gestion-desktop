import { db } from '../database/config/connection';

export interface CompanySettings {
  name: string;
  tagline: string;
  ice: string;
  rc: string;
  if_: string;
  address: string;
  phone: string;
  email: string;
}

const DEFAULTS: CompanySettings = {
  name: 'StockLocal',
  tagline: 'Gestion commerciale - Grossiste',
  ice: '000000000000000',
  rc: '00000',
  if_: '00000000',
  address: '',
  phone: '',
  email: '',
};

const stmtGet = db.prepare('SELECT key, value FROM company_settings');
const stmtSet = db.prepare('INSERT OR REPLACE INTO company_settings (key, value) VALUES (?, ?)');

export const CompanySettingsService = {
  /** Retourne tous les paramètres avec les valeurs par défaut. */
  getAll(): CompanySettings {
    const rows = stmtGet.all() as Array<{ key: string; value: string }>;
    const map: Record<string, string> = {};
    for (const row of rows) map[row.key] = row.value;

    return {
      name: map.name ?? DEFAULTS.name,
      tagline: map.tagline ?? DEFAULTS.tagline,
      ice: map.ice ?? DEFAULTS.ice,
      rc: map.rc ?? DEFAULTS.rc,
      if_: map.if_ ?? DEFAULTS.if_,
      address: map.address ?? DEFAULTS.address,
      phone: map.phone ?? DEFAULTS.phone,
      email: map.email ?? DEFAULTS.email,
    };
  },

  /** Enregistre les paramètres (mise à jour partielle acceptée). */
  save(settings: Partial<CompanySettings>): CompanySettings {
    const entries: Array<[string, string]> = [
      ['name', settings.name ?? ''],
      ['tagline', settings.tagline ?? ''],
      ['ice', settings.ice ?? ''],
      ['rc', settings.rc ?? ''],
      ['if_', settings.if_ ?? ''],
      ['address', settings.address ?? ''],
      ['phone', settings.phone ?? ''],
      ['email', settings.email ?? ''],
    ];
    const txn = db.transaction(() => {
      for (const [key, value] of entries) {
        if (value !== '') stmtSet.run(key, value);
      }
    });
    txn();
    return this.getAll();
  },

  /** Nom simple pour l'affichage. */
  getCompanyName(): string {
    return this.getAll().name || DEFAULTS.name;
  }
};
