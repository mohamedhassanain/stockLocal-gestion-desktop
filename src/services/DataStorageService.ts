import path from 'path';
import fs from 'fs';

const CONFIG_FILE = 'storage-config.json';

interface ElectronAppLike {
  getPath(name: string): string;
}

function loadElectronApp(): ElectronAppLike | undefined {
  try {
    // Sous Electron (main process en CJS/ESM), `require` reste accessible via eval
    // même dans un bundle. Hors Electron (tests Vitest / Node pur), eval('require')
    // n'existe pas → on retombe sur le dossier de test. On vérifie explicitement
    // process.versions.electron pour ne charger le module qu'en environnement réel.
    if (typeof process !== 'undefined' && process.versions?.electron) {
      // eslint-disable-next-line no-eval
      const mod = (0, eval)('require')('electron') as { app?: ElectronAppLike } | undefined;
      if (mod && typeof mod.app?.getPath === 'function') {
        return mod.app;
      }
    }
  } catch {
    // Hors Electron (tests unitaires / Node) : le module electron renvoie un chemin
    // ou n'existe pas → on retombe sur le dossier de test.
  }
  return undefined;
}

/**
 * Emplacement userData (Electron) avec fallback hors Electron (tests / dev).
 * Sous Node pur (Vitest), `app` n'existe pas : on utilise un dossier de test.
 */
function resolveUserDataDir(): string {
  const electronApp = loadElectronApp();
  if (electronApp) {
    try {
      return electronApp.getPath('userData');
    } catch {
      // Electron pas encore prêt
    }
  }
  return process.env.STOCKLOCAL_TEST_DATA_PATH ?? path.join(process.cwd(), '.stocklocal-test-data');
}

export interface StorageConfig {
  dataPath: string;
  isFirstRun: boolean;
}

export interface StorageValidation {
  valid: boolean;
  error?: string;
}

/**
 * Gère l'emplacement des données de l'application.
 * Permet à l'utilisateur de choisir où stocker sa base de données.
 */
export class DataStorageService {
  private static configPath: string;
  private static config: StorageConfig | null = null;

  /** Chemins pour les sous-dossiers de données */
  static readonly DB_FILENAME = 'stocklocal.db';
  static readonly BACKUPS_DIR = 'backups';
  static readonly DOCUMENTS_DIR = 'documents';
  static readonly EXPORTS_DIR = 'exports';
  static readonly ATTACHMENTS_DIR = 'attachments';

  static init(): void {
    this.configPath = path.join(resolveUserDataDir(), CONFIG_FILE);
    this.config = this.loadConfig();
  }

  /** Retourne la config courante, initialise si nécessaire */
  static getConfig(): StorageConfig {
    if (!this.config) this.init();
    return this.config!;
  }

  /** Emplacement recommandé par défaut */
  static getRecommendedPath(): string {
    return path.join(resolveUserDataDir(), 'data');
  }

  /** Chemin complet vers la base de données */
  static getDatabasePath(): string {
    return path.join(this.getConfig().dataPath, this.DB_FILENAME);
  }

  /** Chemin complet vers le dossier backups */
  static getBackupsPath(): string {
    return path.join(this.getConfig().dataPath, this.BACKUPS_DIR);
  }

  /** Chemin complet vers le dossier documents */
  static getDocumentsPath(): string {
    return path.join(this.getConfig().dataPath, this.DOCUMENTS_DIR);
  }

  /** Chemin complet vers le dossier exports */
  static getExportsPath(): string {
    return path.join(this.getConfig().dataPath, this.EXPORTS_DIR);
  }

  /** Chemin complet vers le dossier attachments */
  static getAttachmentsPath(): string {
    return path.join(this.getConfig().dataPath, this.ATTACHMENTS_DIR);
  }

  /** Vérifie si c'est le premier lancement (pas de config existante) */
  static isFirstRun(): boolean {
    if (!fs.existsSync(this.configPath)) return true;
    const cfg = this.loadConfig();
    return cfg.isFirstRun;
  }

  /** Valide un emplacement de données */
  static validatePath(dataPath: string): StorageValidation {
    // Vérifier que le chemin n'est pas vide
    if (!dataPath || dataPath.trim() === '') {
      return { valid: false, error: 'Le chemin ne peut pas être vide.' };
    }

    // Vérifier que le chemin est valide
    try {
      const resolved = path.resolve(dataPath);
      if (resolved !== dataPath.trim()) {
        return { valid: false, error: 'Le chemin doit être un chemin absolu valide.' };
      }
    } catch {
      return { valid: false, error: 'Le chemin n\'est pas valide.' };
    }

    // Vérifier que le disque existe
    const root = path.parse(dataPath).root;
    if (root && !fs.existsSync(root)) {
      return { valid: false, error: `Le disque ${root} n'est pas accessible.` };
    }

    // Si le dossier existe déjà, vérifier les permissions
    if (fs.existsSync(dataPath)) {
      try {
        // Test lecture
        fs.accessSync(dataPath, fs.constants.R_OK);
        // Test écriture
        fs.accessSync(dataPath, fs.constants.W_OK);
      } catch {
        return { valid: false, error: 'Vous n\'avez pas les permissions de lecture/écriture sur ce dossier.' };
      }

      // Vérifier l'espace disque (approximatif)
      try {
        const stats = fs.statfsSync(dataPath);
        const freeBytes = stats.bfree * stats.bsize;
        if (freeBytes < 10 * 1024 * 1024) { // < 10 MB
          return { valid: false, error: 'Espace disque insuffisant (moins de 10 Mo disponibles).' };
        }
      } catch {
        // statfs pas disponible sur tous les OS, on continue
      }
    }

    // Vérifier que le disque parent est accessible
    const parentDir = path.dirname(dataPath);
    if (!fs.existsSync(parentDir)) {
      return { valid: false, error: `Le dossier parent n'existe pas : ${parentDir}` };
    }

    return { valid: true };
  }

  /** Crée les sous-dossiers nécessaires */
  static createDirectories(dataPath: string): void {
    const dirs = [
      dataPath,
      path.join(dataPath, this.BACKUPS_DIR),
      path.join(dataPath, this.DOCUMENTS_DIR),
      path.join(dataPath, this.EXPORTS_DIR),
      path.join(dataPath, this.ATTACHMENTS_DIR),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /** Définit l'emplacement des données (premier lancement ou changement) */
  static setDataPath(dataPath: string): void {
    const resolved = path.resolve(dataPath);
    const validation = this.validatePath(resolved);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    this.createDirectories(resolved);
    this.config = { dataPath: resolved, isFirstRun: false };
    this.saveConfig();
  }

  /** Vérifie si le disque contenant les données est disponible */
  static isDataAvailable(): boolean {
    const config = this.getConfig();
    if (!fs.existsSync(config.dataPath)) return false;
    try {
      fs.accessSync(config.dataPath, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** Déplace les données d'un emplacement à un autre */
  static async migrateData(fromPath: string, toPath: string): Promise<{ success: boolean; error?: string }> {
    const validation = this.validatePath(toPath);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Créer les dossiers cibles
    this.createDirectories(toPath);

    // Copier la base de données
    const dbSource = path.join(fromPath, this.DB_FILENAME);
    const dbDest = path.join(toPath, this.DB_FILENAME);

    if (fs.existsSync(dbSource)) {
      // Vérifier espace disque
      const sourceStats = fs.statSync(dbSource);
      try {
        const destStats = fs.statfsSync(toPath);
        if (destStats.bfree * destStats.bsize < sourceStats.size + 1024 * 1024) {
          return { success: false, error: 'Espace disque insuffisant sur la destination.' };
        }
      } catch {
        // statfs pas disponible
      }

      fs.copyFileSync(dbSource, dbDest);
    }

    // Copier les WAL et SHM si existants
    for (const ext of ['-wal', '-shm']) {
      const src = path.join(fromPath, this.DB_FILENAME + ext);
      const dst = path.join(toPath, this.DB_FILENAME + ext);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
      }
    }

    // Copier les autres dossiers
    const subDirs = [this.BACKUPS_DIR, this.DOCUMENTS_DIR, this.EXPORTS_DIR, this.ATTACHMENTS_DIR];
    for (const dir of subDirs) {
      const srcDir = path.join(fromPath, dir);
      const dstDir = path.join(toPath, dir);
      if (fs.existsSync(srcDir)) {
        this.copyDirRecursive(srcDir, dstDir);
      }
    }

    // Mettre à jour la config
    this.setDataPath(toPath);

    return { success: true };
  }

  /** Copie récursive de dossier */
  private static copyDirRecursive(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /** Vérifie si un produit est utilisé (a des mouvements de stock ou documents) */
  static checkDiskHealth(): { available: boolean; message: string } {
    try {
      const config = this.getConfig();
      if (!fs.existsSync(config.dataPath)) {
        return {
          available: false,
          message: 'Les données sont actuellement indisponibles.\n\nLe disque contenant vos données semble être déconnecté.'
        };
      }
      fs.accessSync(config.dataPath, fs.constants.R_OK | fs.constants.W_OK);
      return { available: true, message: '' };
    } catch {
      return {
        available: false,
        message: 'Les données sont actuellement indisponibles.\n\nLe disque contenant vos données semble être déconnecté.'
      };
    }
  }

  // ─── Gestion de la config ────────────────────────────────────────────────

  private static loadConfig(): StorageConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          dataPath: parsed.dataPath ?? this.getRecommendedPath(),
          isFirstRun: parsed.isFirstRun ?? false,
        };
      }
    } catch {
      // Config corrompue
    }
    return {
      dataPath: this.getRecommendedPath(),
      isFirstRun: true,
    };
  }

  private static saveConfig(): void {
    if (!this.config) return;
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (e) {
      console.error('[DataStorage] Erreur sauvegarde config:', e);
    }
  }

  /** Marque le premier lancement comme terminé */
  static completeFirstRun(): void {
    this.config = { ...this.getConfig(), isFirstRun: false };
    this.saveConfig();
  }
}
