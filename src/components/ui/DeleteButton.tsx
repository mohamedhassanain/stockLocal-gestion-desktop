import React from 'react';

interface DeleteButtonProps {
  onClick: () => void;
  title?: string;
  ariaLabel?: string;
  size?: 'sm' | 'xs';
}

// Icône de suppression (poubelle) — SVG en currentColor → suit la couleur
// du bouton (rouge, hover rouge clair). Plus propre et cohérent qu'un emoji.
const TrashSvg: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

// Bouton de suppression discret et cohérent dans toute l'app :
// icône poubelle (SVG, courant) sur fond transparent, fond rouge clair
// + bordure rouge au survol. Taille "sm" (30px) pour les lignes, "xs" (22px)
// pour les lignes denses (sous-catégories, etc.).
export const DeleteButton: React.FC<DeleteButtonProps> = ({ onClick, title, ariaLabel, size = 'sm' }) => (
  <button
    type="button"
    className={`icon-btn icon-btn-danger${size === 'xs' ? ' icon-btn-xs' : ''}`}
    onClick={onClick}
    title={title ?? 'Supprimer'}
    aria-label={ariaLabel ?? title ?? 'Supprimer'}
  >
    <TrashSvg size={size === 'xs' ? 13 : 15} />
  </button>
);

export default DeleteButton;
