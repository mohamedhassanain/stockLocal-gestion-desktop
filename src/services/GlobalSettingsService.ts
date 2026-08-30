import { db } from '../database/config/connection';

export interface GlobalSettings {
  low_stock_threshold_multiplier: number;
  critical_stock_threshold: number;
  show_low_stock_alerts: boolean;
  show_overdue_alerts: boolean;
  default_vat_rate: number;
  pos_auto_focus_barcode: boolean;
  // §11 Backup settings
  auto_backup_enabled: boolean;
  auto_backup_frequency: 'on_close' | 'daily' | 'weekly' | 'monthly';
  max_backups: number;
  // §26 Inactivity alert
  inactive_product_days: number;
  show_inactive_product_alerts: boolean;
  // Unités de mesure définies par l'utilisateur (liste réutilisable produits)
  product_units: string[];
  // ─── Assistant IA (Phase B) ──────────────────────────────────────────────
  ai_provider: 'anthropic' | 'openai' | 'custom';
  ai_base_url: string;
  ai_api_key: string;
  ai_model: string;
  ai_expiry_mode: 'none' | 'date';
  ai_expiry_date: string;
  ai_rate_limit_per_min: number;
}

const DEFAULTS: GlobalSettings = {
  low_stock_threshold_multiplier: 1,
  critical_stock_threshold: 5,
  show_low_stock_alerts: true,
  show_overdue_alerts: true,
  default_vat_rate: 20,
  pos_auto_focus_barcode: true,
  auto_backup_enabled: true,
  auto_backup_frequency: 'daily',
  max_backups: 10,
  inactive_product_days: 30,
  show_inactive_product_alerts: true,
  product_units: ['PIÈCE', 'KG', 'LITRE', 'CARTON', 'PALETTE'],
  ai_provider: 'anthropic',
  ai_base_url: '',
  ai_api_key: '',
  ai_model: '',
  ai_expiry_mode: 'none',
  ai_expiry_date: '',
  ai_rate_limit_per_min: 30,
};

const stmtGetAll = db.prepare('SELECT key, value FROM global_settings');
const stmtSet = db.prepare('INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)');
const stmtGet = db.prepare('SELECT value FROM global_settings WHERE key = ?');

export const GlobalSettingsService = {
  getAll(): GlobalSettings {
    const rows = stmtGetAll.all() as Array<{ key: string; value: string }>;
    const map: Record<string, string> = {};
    for (const row of rows) map[row.key] = row.value;

    return {
      low_stock_threshold_multiplier: parseFloat(map['low_stock_threshold_multiplier'] ?? String(DEFAULTS.low_stock_threshold_multiplier)),
      critical_stock_threshold: parseFloat(map['critical_stock_threshold'] ?? String(DEFAULTS.critical_stock_threshold)),
      show_low_stock_alerts: (map['show_low_stock_alerts'] ?? 'true') === 'true',
      show_overdue_alerts: (map['show_overdue_alerts'] ?? 'true') === 'true',
      default_vat_rate: parseFloat(map['default_vat_rate'] ?? String(DEFAULTS.default_vat_rate)),
      pos_auto_focus_barcode: (map['pos_auto_focus_barcode'] ?? 'true') === 'true',
      auto_backup_enabled: (map['auto_backup_enabled'] ?? 'true') === 'true',
      auto_backup_frequency: (map['auto_backup_frequency'] ?? DEFAULTS.auto_backup_frequency) as 'on_close' | 'daily' | 'weekly' | 'monthly',
      max_backups: parseInt(map['max_backups'] ?? String(DEFAULTS.max_backups), 10),
      inactive_product_days: parseInt(map['inactive_product_days'] ?? String(DEFAULTS.inactive_product_days), 10),
      show_inactive_product_alerts: (map['show_inactive_product_alerts'] ?? 'true') === 'true',
      product_units: (() => {
        const raw = map['product_units'];
        if (!raw) return DEFAULTS.product_units;
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) && parsed.length > 0 ? parsed.map(String) : DEFAULTS.product_units;
        } catch {
          return DEFAULTS.product_units;
        }
      })(),
      ai_provider: (map['ai_provider'] ?? DEFAULTS.ai_provider) as 'anthropic' | 'openai' | 'custom',
      ai_base_url: map['ai_base_url'] ?? DEFAULTS.ai_base_url,
      ai_api_key: map['ai_api_key'] ?? DEFAULTS.ai_api_key,
      ai_model: map['ai_model'] ?? DEFAULTS.ai_model,
      ai_expiry_mode: (map['ai_expiry_mode'] ?? DEFAULTS.ai_expiry_mode) as 'none' | 'date',
      ai_expiry_date: map['ai_expiry_date'] ?? DEFAULTS.ai_expiry_date,
      ai_rate_limit_per_min: parseInt(map['ai_rate_limit_per_min'] ?? String(DEFAULTS.ai_rate_limit_per_min), 10),
    };
  },

  get(key: keyof GlobalSettings): string | null {
    const row = stmtGet.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  },

  save(settings: Partial<GlobalSettings>): GlobalSettings {
    const txn = db.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        if (value !== undefined && value !== null) {
          stmtSet.run(key, String(value));
        }
      }
    });
    txn();
    return this.getAll();
  }
};
