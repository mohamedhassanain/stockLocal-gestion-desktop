/**
 * ─── Conformité fiscale DGI (Maroc) — Statuts ────────────────────────────────
 *
 * ⚠️  MISSION DE PRÉPARATION — AUCUNE API DGI RÉELLE N'EST BRANCHÉE ICI.
 *
 * Ce fichier définit le vocabulaire de statut utilisé par le module de
 * conformité DGI. Il est VOLONTAIREMENT PUR : aucune dépendance à `db`
 * (better-sqlite3) ni à `electron`. C'est ce qui permet au renderer (badges de
 * l'interface de facturation) de l'importer SANS embarquer better-sqlite3 dans
 * le bundle navigateur (cf. tests/renderer-import-safety.test.ts).
 *
 * Le décret d'application marocain sur la facturation électronique n'étant pas
 * publié à la date de ce travail, l'intégration réelle (endpoint, authentifica-
 * tion, accusés de réception) n'existe pas encore. En conséquence :
 *   - `DGI_INTEGRATION_AVAILABLE` vaut `false` tant que les spécifications
 *     officielles ne sont pas publiées et le connecteur réellement branché ;
 *   - on n'affiche JAMAIS un faux succès (« CLEARED ») : tant que l'intégration
 *     n'est pas branchée, un document activé reste « en attente » (`PENDING`).
 */

/** Statuts de conformité possibles d'un document vis-à-vis de la DGI. */
export type DgiStatus = 'PENDING' | 'SUBMITTED' | 'CLEARED' | 'REJECTED' | 'NOT_APPLICABLE';

/** Liste des statuts valides (source de vérité, utilisée pour la validation). */
export const DGI_STATUSES: readonly DgiStatus[] = [
  'PENDING',
  'SUBMITTED',
  'CLEARED',
  'REJECTED',
  'NOT_APPLICABLE',
] as const;

/** Libellés affichables (français) pour chaque statut. */
export const DGI_STATUS_LABEL: Record<DgiStatus, string> = {
  PENDING: "En attente d'intégration DGI",
  SUBMITTED: 'Transmise à la DGI',
  CLEARED: 'Validée par la DGI',
  REJECTED: 'Rejetée par la DGI',
  NOT_APPLICABLE: 'Non applicable',
};

/**
 * ⚠️  À BRANCHER QUAND LES SPÉCIFICATIONS OFFICIELLES SERONT PUBLIÉES.
 *
 * Tant que ce drapeau vaut `false`, le module ne prétend JAMAIS qu'un document
 * a été transmis ou validé : le statut effectif reste `PENDING`.
 * Le passer à `true` devra être fait EN MÊME TEMPS que le branchement du
 * connecteur réel (DgiConnector), jamais avant.
 */
export const DGI_INTEGRATION_AVAILABLE = false;

/** Vrai si `value` est un statut DGI valide. */
export function isDgiStatus(value: unknown): value is DgiStatus {
  return typeof value === 'string' && (DGI_STATUSES as readonly string[]).includes(value);
}

/** Contexte de résolution d'un statut DGI pour l'affichage. */
export interface DgiDisplayContext {
  /** Le module de conformité est-il activé (réglage `dgi_compliance_enabled`) ? */
  enabled: boolean;
  /** L'intégration réelle est-elle branchée ? (défaut : DGI_INTEGRATION_AVAILABLE) */
  integrationAvailable?: boolean;
  /** Valeur stockée en base pour ce document (peut être NULL). */
  stored?: DgiStatus | null;
}

/**
 * Détermine le statut DGI À AFFICHER pour un document.
 *
 * Règles :
 *   - module désactivé  → `NOT_APPLICABLE` (aucune contrainte, aucun changement) ;
 *   - module activé mais intégration non branchée → `PENDING` (honnête : jamais
 *     de faux succès) ;
 *   - module activé et intégration branchée → statut stocké, `PENDING` par défaut.
 */
export function resolveDgiDisplayStatus(context: DgiDisplayContext): DgiStatus {
  if (!context.enabled) return 'NOT_APPLICABLE';
  const integrationAvailable = context.integrationAvailable ?? DGI_INTEGRATION_AVAILABLE;
  if (!integrationAvailable) return 'PENDING';
  return isDgiStatus(context.stored) ? context.stored : 'PENDING';
}

/** Texte explicatif honnête affiché dans les Paramètres (interrupteur). */
export const DGI_MODULE_DISCLAIMER =
  "Cette fonctionnalité sera activée automatiquement dès que l'administration " +
  'fiscale marocaine aura publié les spécifications techniques officielles. ' +
  "Aucune action n'est requise pour l'instant.";
