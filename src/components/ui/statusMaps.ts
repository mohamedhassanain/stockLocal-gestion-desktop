import type { BadgeVariant } from './Badge';
import type { DocumentType } from '../../repositories/DocumentRepository';

/** Badges document — palette sémantique unifiée sur toute l'app. */
export const DOCUMENT_TYPE_BADGE: Record<DocumentType, { label: string; icon: string; variant: BadgeVariant }> = {
  QUOTE: { label: 'Devis', icon: '📋', variant: 'muted' },
  DELIVERY_NOTE: { label: 'Bon de livraison', icon: '🚚', variant: 'warning' },
  INVOICE: { label: 'Facture', icon: '📄', variant: 'info' },
  CREDIT_NOTE: { label: 'Avoir', icon: '↩️', variant: 'success' },
};

export const DOCUMENT_STATUS_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  PAID: { label: 'Payée', variant: 'success' },
  UNPAID: { label: 'Impayée', variant: 'danger' },
  PARTIAL: { label: 'Partielle', variant: 'warning' },
  DRAFT: { label: 'Brouillon', variant: 'muted' },
  CANCELLED: { label: 'Annulée', variant: 'muted' },
};

export const PURCHASE_STATUS_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: 'Brouillon', variant: 'muted' },
  CONFIRMED: { label: 'Confirmée', variant: 'info' },
  PARTIALLY_RECEIVED: { label: 'Part. reçue', variant: 'warning' },
  RECEIVED: { label: 'Réceptionnée', variant: 'success' },
  CANCELLED: { label: 'Annulée', variant: 'muted' },
};

export const INVENTORY_STATUS_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: 'Brouillon', variant: 'muted' },
  COUNTING: { label: 'En cours', variant: 'warning' },
  GAPS_CALCULATED: { label: 'Écarts calculés', variant: 'info' },
  VALIDATED: { label: 'Validé', variant: 'success' },
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Espèces',
  CHECK: 'Chèque',
  TRANSFER: 'Virement',
};

export const PRODUCT_STATUS_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  ACTIVE: { label: 'ACTIVE', variant: 'success' },
  DISABLED: { label: 'DISABLED', variant: 'warning' },
  ARCHIVED: { label: 'ARCHIVED', variant: 'danger' },
};

/** Couleur de stock selon niveau — classes sémantiques, pas de hex. */
export function stockLevelClass(stock: number, minStock = 0): string {
  if (stock <= 0) return 'text-danger';
  if (stock <= minStock) return 'text-warning';
  return 'text-muted';
}
