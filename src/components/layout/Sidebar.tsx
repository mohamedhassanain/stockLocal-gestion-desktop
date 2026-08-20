import React from 'react';
import type { Page } from '../../App';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

interface NavItemConfig {
  page: Page;
  icon: string;
  label: string;
  shortcut?: string;
}

interface NavSectionConfig {
  label: string;
  items: NavItemConfig[];
}

// Navigation par modules (§23) — mêmes pages, meilleure organisation
const NAV_SECTIONS: NavSectionConfig[] = [
  {
    label: 'Principal',
    items: [{ page: 'dashboard', icon: '📊', label: 'Tableau de bord', shortcut: 'F1' }],
  },
  {
    label: 'Ventes',
    items: [
      { page: 'pos', icon: '🛒', label: 'Point de vente', shortcut: 'F8' },
      { page: 'invoices', icon: '🧾', label: 'Factures & Devis', shortcut: 'F6' },
    ],
  },
  {
    label: 'Stock',
    items: [
      { page: 'products', icon: '🏷️', label: 'Produits', shortcut: 'F2' },
      { page: 'stock', icon: '📦', label: 'Mouvements', shortcut: 'F3' },
      { page: 'inventory', icon: '📋', label: 'Inventaire', shortcut: 'F10' },
    ],
  },
  {
    label: 'Achats',
    items: [
      { page: 'suppliers', icon: '🏭', label: 'Fournisseurs', shortcut: 'F5' },
      { page: 'purchases', icon: '🚚', label: 'Commandes', shortcut: 'F9' },
    ],
  },
  {
    label: 'Clients',
    items: [{ page: 'clients', icon: '🤝', label: 'Clients & Crédits', shortcut: 'F4' }],
  },
  {
    label: 'Système',
    items: [{ page: 'settings', icon: '⚙️', label: 'Paramètres', shortcut: 'F7' }],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate }) => {
  return (
    <aside
      style={{
        width: '248px',
        background: 'var(--sidebar-bg)',
        color: '#f8fafc',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: '20px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            flexShrink: 0,
          }}
        >
          📦
        </div>
        <div>
          <div style={{ fontSize: '17px', fontWeight: '700', color: '#f8fafc', lineHeight: 1.2 }}>
            StockLocal
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Gestion commerciale</div>
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '10px 0 16px', overflowY: 'auto', overflowX: 'hidden' }}>
        {NAV_SECTIONS.map((section) => (
          <React.Fragment key={section.label}>
            <div
              style={{
                padding: '14px 20px 6px',
                fontSize: '10px',
                fontWeight: '700',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#475569',
              }}
            >
              {section.label}
            </div>
            {section.items.map((item) => (
              <NavItem
                key={item.page}
                icon={item.icon}
                label={item.label}
                shortcut={item.shortcut}
                active={currentPage === item.page}
                onClick={() => onNavigate(item.page)}
              />
            ))}
          </React.Fragment>
        ))}
      </nav>

      {/* Footer */}
      <div
        style={{
          padding: '14px 20px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          fontSize: '11px',
          color: '#64748b',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#22c55e',
              display: 'inline-block',
              boxShadow: '0 0 6px rgba(34,197,94,0.6)',
            }}
          />
          Base de données active
        </div>
        <div style={{ marginTop: '4px' }}>v1.0.0 · Mode 100% local</div>
      </div>
    </aside>
  );
};

const NavItem: React.FC<{
  icon: string;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
}> = ({ icon, label, shortcut, active, onClick }) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    }}
    style={{
      padding: '10px 20px',
      cursor: 'pointer',
      background: active ? 'rgba(59,130,246,0.16)' : 'transparent',
      borderLeft: active ? '3px solid var(--sidebar-active)' : '3px solid transparent',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      fontSize: '14px',
      color: active ? '#93c5fd' : 'var(--sidebar-text)',
      fontWeight: active ? '600' : '400',
      transition: 'background 0.12s, color 0.12s',
      userSelect: 'none',
    }}
  >
    <span style={{ fontSize: '17px', width: '22px', textAlign: 'center', flexShrink: 0 }}>{icon}</span>
    <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    {shortcut && (
      <span
        style={{
          fontSize: '10px',
          color: '#475569',
          background: 'rgba(255,255,255,0.06)',
          padding: '2px 6px',
          borderRadius: '5px',
          fontFamily: 'ui-monospace, monospace',
        }}
      >
        {shortcut}
      </span>
    )}
  </div>
);
