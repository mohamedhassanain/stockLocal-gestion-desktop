import fs from 'fs';
import path from 'path';
import { DataStorageService } from './DataStorageService';

/**
 * Journal d'erreurs local (2.5) — 100% hors ligne, aucune télémétrie réseau.
 *
 * - Écriture dans <dataPath>/logs/errors.log avec rotation basique (max 1 Mo,
 *   l'ancien fichier est renommé errors.old.log puis recyclé).
 * - Capture les erreurs non gérées du process principal et les rejets de
 *   promesses non catchés (enregistrement via installGlobalHandlers).
 * - L'utilisateur peut exporter ce fichier depuis Paramètres pour l'envoyer
 *   au support (WhatsApp/email).
 */
const MAX_LOG_BYTES = 1024 * 1024; // 1 Mo

function getLogsDir(): string {
  return path.join(DataStorageService.getConfig().dataPath, 'logs');
}

function getLogPath(): string {
  return path.join(getLogsDir(), 'errors.log');
}

function rotateIfNeeded(logPath: string): void {
  try {
    const stats = fs.statSync(logPath);
    if (stats.size <= MAX_LOG_BYTES) return;
    const oldPath = logPath + '.old';
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    fs.renameSync(logPath, oldPath);
  } catch { /* pas encore de log */ }
}

export function formatError(err: unknown): string {
  if (!err) return 'Erreur inconnue';
  const e = err as any;
  const stack = typeof e?.stack === 'string' ? e.stack : String(e?.message ?? err);
  return stack.substring(0, 2000);
}

function writeEntry(context: string, err: unknown): void {
  try {
    const dir = getLogsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const logPath = getLogPath();
    rotateIfNeeded(logPath);
    const ts = new Date().toISOString();
    const line = `[${ts}] [${context}] ${formatError(err).replace(/\r?\n/g, '\n    ')}\n`;
    fs.appendFileSync(logPath, line, 'utf-8');
  } catch (e) {
    // Ne jamais faire tomber l'application pour un échec de journalisation
    console.error('[ErrorLog] Échec d\'écriture du journal:', e);
  }
}

export const ErrorLogService = {
  log(context: string, err: unknown): void {
    writeEntry(context, err);
  },

  /** Chemin du fichier de journal (vide s'il n'existe pas encore). */
  getLogFilePath(): string | null {
    try {
      const logPath = getLogPath();
      return fs.existsSync(logPath) ? logPath : null;
    } catch {
      return null;
    }
  },

  /** Installe la capture globale des erreurs non gérées du process principal. */
  installGlobalHandlers(): void {
    process.on('uncaughtException', (err) => {
      writeEntry('uncaughtException', err);
      console.error('[ErrorLog] Erreur non gérée capturée :', err);
    });
    process.on('unhandledRejection', (reason) => {
      writeEntry('unhandledRejection', reason);
      console.error('[ErrorLog] Rejet non géré capturé :', reason);
    });
  },
};

export default ErrorLogService;
