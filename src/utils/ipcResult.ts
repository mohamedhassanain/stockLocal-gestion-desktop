/**
 * Enveloppe standard des réponses IPC.
 *
 * Convention du main process (`electron/ipc/*`) : un handler répond soit
 *   { success: true,  data: T }
 * soit
 *   { success: false, error: string }
 *
 * `ipcRenderer.invoke` est typé `Promise<any>` : on normalise la réponse ICI,
 * une seule fois, à la frontière, au lieu de disperser des `as unknown as`
 * non vérifiés dans chaque composant.
 *
 * `data` provient d'un handler dont les entrées sont validées par Zod côté
 * main : la seule assertion du renderer est donc portée par ce module.
 */

export interface IpcSuccess<T> {
  success: true;
  data: T;
}

export interface IpcFailure {
  success: false;
  error?: string;
}

export type IpcResult<T> = IpcSuccess<T> | IpcFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Normalise une réponse IPC brute.
 *
 * Tolère aussi une réponse DIRECTE (objet métier sans enveloppe) : plusieurs
 * handlers historiques renvoient la donnée elle-même. Le comportement observé
 * est préservé à l'identique :
 *   { success: false, error }  → échec
 *   { success: true,  data }   → succès avec `data`
 *   <objet direct>             → succès avec l'objet
 */
export function toIpcResult<T>(raw: unknown): IpcResult<T> {
  if (isRecord(raw)) {
    if (raw.success === false) {
      const { error } = raw;
      return { success: false, error: typeof error === 'string' ? error : undefined };
    }
    if (raw.success === true && 'data' in raw) {
      return { success: true, data: raw.data as T };
    }
  }
  return { success: true, data: raw as T };
}
