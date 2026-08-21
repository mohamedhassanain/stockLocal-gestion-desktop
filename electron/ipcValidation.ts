/**
 * Validation utilities for IPC handlers (§32, §33 - Sécurité)
 * All string/number params must be validated before use.
 * Path traversal protection: no ../ in paths, restrict to data folder.
 */

import path from 'node:path';
import fs from 'node:fs';

// ─── String Validation ────────────────────────────────────────────────────────

export function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Paramètre invalide : "${fieldName}" est requis et doit être une chaîne non vide.`);
  }
  return value.trim();
}

export function requireId(value: unknown, fieldName: string): string {
  const str = requireString(value, fieldName);
  if (!/^[a-zA-Z0-9\-]{1,64}$/.test(str)) {
    throw new Error(`Paramètre invalide : "${fieldName}" contient des caractères non autorisés.`);
  }
  return str;
}

export function requirePositiveNumber(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (isNaN(num) || num < 0) {
    throw new Error(`Paramètre invalide : "${fieldName}" doit être un nombre positif.`);
  }
  return num;
}

export function requireStrictPositiveNumber(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (isNaN(num) || num <= 0) {
    throw new Error(`Paramètre invalide : "${fieldName}" doit être un nombre supérieur à 0.`);
  }
  return num;
}

export function optionalString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`Paramètre invalide : "${fieldName}" doit être une chaîne.`);
  }
  return value.trim();
}

// ─── Path Validation (§33) ───────────────────────────────────────────────────

const DANGEROUS_PATH_CHARS = /[<>"|?*\x00-\x1f]/;

/** Limites de taille de fichiers lus via IPC (Phase 2 — anti DoS mémoire). */
export const FILE_LIMITS = {
  /** Images produits / logo : 5 Mo max (base64 via IPC). */
  IMAGE_MAX_BYTES: 5 * 1024 * 1024,
  /** CSV import : 50 Mo max (lecture mémoire bornée). */
  CSV_MAX_BYTES: 50 * 1024 * 1024,
} as const;

/** Vérifie la taille d'un fichier avant une lecture complète en mémoire. */
export function assertFileSizeWithin(filePath: string, maxBytes: number, fieldName: string): void {
  validateFileExists(filePath, fieldName);
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > maxBytes) {
      const mb = Math.round(maxBytes / (1024 * 1024));
      throw new Error(
        `Fichier trop volumineux : "${fieldName}" dépasse la limite de ${mb} Mo autorisés.`
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('trop volumineux')) throw e;
    throw new Error(`Impossible de lire les informations du fichier : "${fieldName}".`);
  }
}

/**
 * Confine un chemin fourni par le renderer à un sous-dossier du dossier de
 * données. C'est la barrière pour `backup:now`, `backup:delete`, `backup:restore`,
 * `backup:validate` : le renderer ne peut jamais cibler un fichier arbitraire
 * du filesystem (ex. suppression de C:\Windows\... via backup:delete).
 *
 * @returns chemin absolu résolu, dans <dataDir>/<subDir>/
 */
export function validatePathWithinSubDir(filePath: string, dataDir: string, subDir: string, fieldName: string): string {
  const allowedDir = path.resolve(dataDir, subDir);
  const resolved = validatePathWithinDataDir(filePath, allowedDir, fieldName);
  return resolved;
}

// ─── CSV Escaping (§1.4) ─────────────────────────────────────────────────────

/**
 * Échappe une valeur pour un fichier CSV :
 *  - anti-injection de formule : les cellules commençant par `=`, `+`, `-` ou `@`
 *    sont préfixées d'une apostrophe pour empêcher Excel/LibreOffice de les
 *    interpréter comme des formules (CVE classique).
 *  - citation des cellules contenant séparateur, guillemets ou retour ligne.
 */
export function csvEscape(val: unknown): string {
  let s = String(val ?? '');
  if (s.startsWith('=') || s.startsWith('+') || s.startsWith('-') || s.startsWith('@')) {
    s = `'${s}`;
  }
  if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Protection PRÉCOCE contre les séquences de traversal (`..`, `~`).
 *
 * ATTENTION : cette fonction n'est PAS la barrière de sécurité principale.
 * Elle ne bloque ni les chemins absolus (C:\Windows\System32\..., /etc/...)
 * ni les chemins relatifs hors du dossier de données.
 *
 * La protection RÉELLE est `validatePathWithinDataDir` : tout chemin fourni
 * par le renderer doit être confiné au dossier de données avant tout accès
 * au système de fichiers. `hasPathTraversal` sert uniquement de filet
 * complémentaire précoce (rejet rapide avant les vérifications lourdes).
 */
export function hasPathTraversal(filePath: string): boolean {
  if (filePath.includes('..')) return true;
  // Bloque `~` uniquement en DÉBUT de segment (`~/fichier`, `sous-dossier/~/x`),
  // pas dans un nom de dossier légitime (ex. chemin court Windows 8.3 `MOHAME~1`)
  if (/(^|[\\/])~([\\/]|$)/.test(filePath)) return true;
  return false;
}

export function validateFilePath(filePath: string, fieldName: string): string {
  requireString(filePath, fieldName);
  if (hasPathTraversal(filePath)) {
    throw new Error(`Chemin invalide : "${fieldName}" contient une séquence de traversal (..).`);
  }
  if (DANGEROUS_PATH_CHARS.test(filePath)) {
    throw new Error(`Chemin invalide : "${fieldName}" contient des caractères non autorisés.`);
  }
  try {
    return path.resolve(filePath);
  } catch {
    throw new Error(`Chemin invalide : "${fieldName}" ne peut pas être résolu.`);
  }
}

/**
 * Confine un chemin fourni par le renderer au dossier de données autorisé.
 *
 * VÉRITABLE barrière anti-lecture/écriture arbitraire : rejette tout chemin
 * absolu ou relatif qui sort du dossier de données (ex. C:\Windows\System32,
 * /etc/passwd). Sur Windows, la comparaison est insensible à la casse et
 * normalise les séparateurs (garde-fous contre les variantes du chemin).
 */
export function validatePathWithinDataDir(filePath: string, dataDir: string, fieldName: string): string {
  const resolved = validateFilePath(filePath, fieldName);
  const resolvedDataDir = path.resolve(dataDir);
  // Détection Windows par format de chemin (lettre de lecteur / UNC),
  // sans dépendre de process.platform (utilitaire autonome et testable).
  const isWindowsLike = /^[a-zA-Z]:[\\/]/.test(resolvedDataDir) || resolvedDataDir.startsWith('\\\\');

  const normalizedFile = isWindowsLike ? resolved.replace(/\//g, '\\').toLowerCase() : resolved;
  const normalizedDataDir = isWindowsLike ? resolvedDataDir.replace(/\//g, '\\').toLowerCase() : resolvedDataDir;

  const inside = normalizedFile.startsWith(normalizedDataDir + path.sep) || normalizedFile === normalizedDataDir;
  if (!inside) {
    throw new Error(
      `Accès refusé : "${fieldName}" est en dehors du dossier de données autorisé.`
    );
  }
  return resolved;
}

export function validateFileExists(filePath: string, fieldName: string): void {
  const resolved = validateFilePath(filePath, fieldName);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Fichier introuvable : "${fieldName}" (${resolved}).`);
  }
  try {
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch {
    throw new Error(`Accès refusé : "${fieldName}" n'est pas lisible.`);
  }
}

// ─── Object Validation ────────────────────────────────────────────────────────

export function requireObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Paramètre invalide : "${fieldName}" doit être un objet.`);
  }
  return value as Record<string, unknown>;
}

export function requireArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Paramètre invalide : "${fieldName}" doit être un tableau.`);
  }
  return value;
}

// ─── Hiérarchie d'erreurs centralisée (§33) ─────────────────────────────────
// Chaque couche (IPC → service → repository) peut lever une erreur typée.
// toHumanError() transforme TOUJOURS ces erreurs en messages français clairs.

export class AppError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, cause?: unknown) {
    super('DATABASE_ERROR', `${message}${cause && cause !== message ? ` (cause: ${String((cause as any)?.message ?? cause)})` : ''}`);
    this.name = 'DatabaseError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}

export class BusinessError extends AppError {
  constructor(message: string) {
    super('BUSINESS_ERROR', message);
    this.name = 'BusinessError';
  }
}

export class PermissionError extends AppError {
  constructor(message = 'Action non autorisée.') {
    super('PERMISSION_DENIED', message);
    this.name = 'PermissionError';
  }
}

export class FileSystemError extends AppError {
  constructor(message: string) {
    super('FILESYSTEM_ERROR', message);
    this.name = 'FileSystemError';
  }
}

export class BackupError extends AppError {
  constructor(message: string) {
    super('BACKUP_ERROR', message);
    this.name = 'BackupError';
  }
}

// ─── Sanitization ─────────────────────────────────────────────────────────────

export function sanitizeString(value: string): string {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
}

export function sanitizeNote(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null;
  return sanitizeString(value).substring(0, 500) || null;
}

// ─── Human Error Messages (§31) ──────────────────────────────────────────────

const HUMAN_ERROR_MAP: Record<string, string> = {
  'UNIQUE constraint failed': 'Un élément avec ce nom/référence existe déjà.',
  'FOREIGN KEY constraint failed': 'Impossible : cet élément est utilisé par un autre enregistrement.',
  'NOT NULL constraint failed': 'Un champ obligatoire est manquant.',
  'CHECK constraint failed': 'La valeur saisie ne respecte pas les règles de validation.',
  'database disk image is malformed': 'La base de données est corrompue. Essayez de restaurer une sauvegarde.',
  'attempt to write a readonly database': 'La base de données est en lecture seule. Vérifiez les permissions.',
  'SQLITE_BUSY': 'La base de données est momentanément occupée (souvent un dossier synchronisé, ex. OneDrive/Dropbox). Réessayez dans quelques secondes.',
  'SQLITE_LOCKED': 'La base de données est verrouillée par une autre opération. Réessayez dans quelques secondes.',
  'no such table': 'Erreur interne : une table est manquante dans la base de données.',
  'no such column': 'Erreur interne : une colonne est manquante dans la base de données.',
  ' SQLITE_CONSTRAINT': 'Une contrainte de la base de données a été violée.',
};

/**
 * Converts SQLite/technical errors to human-friendly French messages (§31).
 */
export function toHumanError(error: unknown): string {
  if (!error) return 'Une erreur inconnue est survenue.';
  const msg = String((error as any)?.message ?? error);

  for (const [pattern, human] of Object.entries(HUMAN_ERROR_MAP)) {
    if (msg.includes(pattern)) return human;
  }

  // If it's already a French error from our services, return as-is
  if (msg.includes('invalide') || msg.includes('introuvable') || msg.includes('impossible') ||
      msg.includes('manquant') || msg.includes('obligatoire') || msg.includes('supérieur')) {
    return msg;
  }

  // Generic fallback
  return `Erreur : ${msg.substring(0, 200)}`;
}
