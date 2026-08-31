import { safeStorage } from 'electron';

/**
 * ─── secureStorage ────────────────────────────────────────────────────────────
 *
 * Chiffre/déchiffre les secrets (clé API) via `electron.safeStorage`.
 * - Si safeStorage n'est pas disponible (`ELECTRON_RUN_AS_NODE`, Linux sans keyring,
 *   etc.) ou `isEncryptionAvailable()` est false → FALLBACK documenté : stockage en
 *   clair (l'UI affiche un avertissement). L'app ne plante jamais.
 * - Les valeurs chiffrées sont préfixées `enc:v1:` ; une valeur sans préfixe est
 *   traitée comme du clair (base existante / fallback).
 * - La clé n'est JAMAIS renvoyée en clair au renderer (seulement `apiKeySet`).
 * ──────────────────────────────────────────────────────────────────────────────
 */

const ENC_PREFIX = 'enc:v1:';

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage?.isEncryptionAvailable?.() ?? false;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  try {
    if (safeStorage?.isEncryptionAvailable?.()) {
      return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
    }
  } catch {
    // fallback
  }
  // Fallback clair (documenté, averti dans l'UI).
  return plain;
}

export function decryptSecret(stored: string): string {
  if (!stored) return '';
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      if (safeStorage?.isEncryptionAvailable?.()) {
        return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')).toString();
      }
    } catch {
      return '';
    }
    return '';
  }
  // Clair (legacy / fallback).
  return stored;
}
