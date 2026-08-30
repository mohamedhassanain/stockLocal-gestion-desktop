import React from 'react';
import {
  LayoutDashboard, ShoppingCart, FileText, FileCheck2, Truck, Undo2,
  Package, ArrowLeftRight, ClipboardList, AlertTriangle, ShoppingBag,
  PackageCheck, Factory, Users, CreditCard, Wallet, BarChart3, Settings,
  Boxes, Bot,
} from 'lucide-react';
import type { Page } from '../../App';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

interface NavItemConfig {
  page: Page;
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
  label: string;
  shortcut?: string;
}

interface NavSectionConfig {
  label: string;
  items: NavItemConfig[];
}

// Navigation fonctionnelle (§3.2) — une seule bibliothèque d'icônes (lucide-react).
// Raccourcis clavier F1-F10 conservés (documentés dans le README).
const NAV_SECTIONS: NavSectionConfig[] = [
  {
    label: 'Principal',
    items: [{ page: 'dashboard', icon: LayoutDashboard, label: 'Tableau de bord', shortcut: 'F1' }],
  },
  {
    label: 'Ventes',
    items: [
      { page: 'pos', icon: ShoppingCart, label: 'Point de vente', shortcut: 'F8' },
      { page: 'invoices', icon: FileText, label: 'Factures', shortcut: 'F6' },
      { page: 'devis', icon: FileCheck2, label: 'Devis' },
      { page: 'delivery-notes', icon: Truck, label: 'Bons de livraison' },
      { page: 'credit-notes', icon: Undo2, label: 'Avoirs' },
    ],
  },
  {
    label: 'Stock',
    items: [
      { page: 'products', icon: Package, label: 'Produits', shortcut: 'F2' },
      { page: 'stock', icon: ArrowLeftRight, label: 'Mouvements', shortcut: 'F3' },
      { page: 'inventory', icon: ClipboardList, label: 'Inventaire', shortcut: 'F10' },
      { page: 'stock-alerts', icon: AlertTriangle, label: 'Alertes stock' },
    ],
  },
  {
    label: 'Achats',
    items: [
      { page: 'purchases', icon: ShoppingBag, label: 'Commandes fournisseurs', shortcut: 'F9' },
      { page: 'receivings', icon: PackageCheck, label: 'Réceptions' },
      { page: 'suppliers', icon: Factory, label: 'Fournisseurs', shortcut: 'F5' },
    ],
  },
  {
    label: 'Clients',
    items: [
      { page: 'clients', icon: Users, label: 'Clients', shortcut: 'F4' },
      { page: 'client-credits', icon: CreditCard, label: 'Crédits & échéances' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { page: 'payments', icon: Wallet, label: 'Paiements' },
      { page: 'cash-register', icon: Wallet, label: 'Caisse' },
    ],
  },

  {
    label: 'Analyse',
    items: [{ page: 'reports', icon: BarChart3, label: 'Rapports' }],
  },
  {
    label: 'Système',
    items: [
      { page: 'settings', icon: Settings, label: 'Paramètres', shortcut: 'F7' },
      { page: 'ai-assistant', icon: Bot, label: 'Assistant IA' },
    ],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate }) => {
  return (
    <aside className="sidebar" style={{ width: 252 }}>
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon"><Boxes size={22} /></div>
        <div>
          <div className="sidebar-logo-title">StockLocal</div>
          <div className="sidebar-logo-sub">Gestion commerciale</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV_SECTIONS.map((section) => (
          <React.Fragment key={section.label}>
            <div className="sidebar-section-label">{section.label}</div>
            {section.items.map((item) => (
              <NavItem
                key={`${item.page}-${item.label}`}
                Icon={item.icon}
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
      <div className="sidebar-footer">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="sidebar-dot" />
          Base de données active
        </div>
        <div style={{ marginTop: 4 }}>v1.0.0 · Mode 100% local</div>
      </div>
    </aside>
  );
};

const NavItem: React.FC<{
  Icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
}> = ({ Icon, label, shortcut, active, onClick }) => (
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
    className={active ? 'sidebar-item active' : 'sidebar-item'}
  >
    <Icon size={17} strokeWidth={2} />
    <span className="sidebar-item-label">{label}</span>
    {shortcut && <span className="sidebar-item-shortcut">{shortcut}</span>}
  </div>
);
