import React from 'react';
import type { Page } from '../../App';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate }) => {
  return (
    <aside style={{ width: '240px', background: '#0f172a', color: 'white', height: '100vh', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {/* Logo */}
      <div style={{ padding: '24px 20px', borderBottom: '1px solid #1e293b' }}>
        <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#f8fafc' }}>📦 StockLocal</div>
        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Gestion commerciale</div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
        <NavSection label="PRINCIPAL" />
        <NavItem icon="📊" label="Tableau de bord" shortcut="F1" active={currentPage === 'dashboard'} onClick={() => onNavigate('dashboard')} />
        <NavItem icon="🏷️" label="Produits" shortcut="F2" active={currentPage === 'products'} onClick={() => onNavigate('products')} />
        <NavItem icon="📦" label="Stock" shortcut="F3" active={currentPage === 'stock'} onClick={() => onNavigate('stock')} />

        <NavSection label="COMMERCIAL" />
        <NavItem icon="🤝" label="Clients" shortcut="F4" active={currentPage === 'clients'} onClick={() => onNavigate('clients')} />
        <NavItem icon="🏭" label="Fournisseurs" shortcut="F5" active={currentPage === 'suppliers'} onClick={() => onNavigate('suppliers')} />
        <NavItem icon="📄" label="Facturation" shortcut="F6" active={currentPage === 'invoices'} onClick={() => onNavigate('invoices')} />
      </nav>

      {/* Footer */}
      <div style={{ padding: '16px 20px', borderTop: '1px solid #1e293b', fontSize: '12px', color: '#475569' }}>
        <div>v1.0.0 · Mode 100% local</div>
        <div style={{ marginTop: '4px', color: '#22c55e' }}>● Base de données active</div>
      </div>
    </aside>
  );
};

const NavSection: React.FC<{ label: string }> = ({ label }) => (
  <div style={{ padding: '14px 20px 6px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', color: '#475569' }}>{label}</div>
);

const NavItem: React.FC<{ icon: string; label: string; shortcut: string; active?: boolean; onClick: () => void }> = ({ icon, label, shortcut, active, onClick }) => (
  <div
    onClick={onClick}
    style={{
      padding: '12px 20px',
      cursor: 'pointer',
      background: active ? 'rgba(59,130,246,0.15)' : 'transparent',
      borderLeft: active ? '3px solid #3b82f6' : '3px solid transparent',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      fontSize: '15px',
      color: active ? '#93c5fd' : '#94a3b8',
      fontWeight: active ? '600' : '400',
      transition: 'all 0.15s',
      userSelect: 'none',
    }}
  >
    <span style={{ fontSize: '18px', width: '22px', textAlign: 'center' }}>{icon}</span>
    <span style={{ flex: 1 }}>{label}</span>
    {shortcut && <span style={{ fontSize: '11px', color: '#334155', background: '#1e293b', padding: '2px 6px', borderRadius: '4px' }}>{shortcut}</span>}
  </div>
);
