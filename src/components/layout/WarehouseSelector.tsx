import React from 'react';
import { Warehouse as WarehouseIcon } from 'lucide-react';
import { useWarehouseStore } from '../../stores/useWarehouseStore';

/**
 * Sélecteur de « dépôt actif » (multi-dépôts).
 *
 * Visible et persistant dans la barre latérale. Il est MASQUÉ automatiquement
 * quand il n'existe qu'un seul dépôt : l'utilisateur mono-dépôt (cas majoritaire)
 * ne voit donc aucune complexité supplémentaire.
 */
export const WarehouseSelector: React.FC = () => {
  const { warehouses, activeId, setActive } = useWarehouseStore();

  // Mono-dépôt → pas de sélecteur : l'expérience reste identique à avant.
  if (warehouses.length <= 1) return null;

  return (
    <div
      style={{
        margin: '0 12px 10px',
        padding: '8px 10px',
        background: 'var(--surface-2, rgba(255,255,255,0.04))',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md, 8px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-secondary)',
          marginBottom: 6,
        }}
      >
        <WarehouseIcon size={13} strokeWidth={2} />
        Dépôt actif
      </div>
      <select
        value={activeId ?? ''}
        onChange={(e) => { void setActive(e.target.value); }}
        aria-label="Dépôt actif"
        style={{
          width: '100%',
          padding: '6px 8px',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}{w.is_default === 1 ? ' — par défaut' : ''}
          </option>
        ))}
      </select>
    </div>
  );
};
