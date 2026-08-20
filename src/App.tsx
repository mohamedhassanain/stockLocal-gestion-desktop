import React, { useEffect, useState, useCallback } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { StockPage } from './pages/StockPage';
import { ClientsPage } from './pages/ClientsPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { InvoicePage } from './pages/InvoicePage';
import { SettingsPage } from './pages/SettingsPage';
import { POSPage } from './pages/POSPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { InventoryPage } from './pages/InventoryPage';
import { ReportsPage } from './pages/ReportsPage';
import { StockAlertsPage } from './pages/StockAlertsPage';
import { OnboardingWizard } from './components/OnboardingWizard';
import { DiskWarning } from './components/DiskWarning';
import { Toaster } from './components/ui/Toaster';
import { toast } from './stores/useToastStore';

export type Page = 'dashboard' | 'products' | 'stock' | 'clients' | 'suppliers' | 'invoices' | 'devis' | 'delivery-notes' | 'credit-notes' | 'settings' | 'pos' | 'purchases' | 'inventory' | 'reports' | 'stock-alerts';

const PAGE_SHORTCUTS: Record<string, Page> = {
  F1: 'dashboard',
  F2: 'products',
  F3: 'stock',
  F4: 'clients',
  F5: 'suppliers',
  F6: 'invoices',
  F7: 'settings',
  F8: 'pos',
  F9: 'purchases',
  F10: 'inventory',
};

type AppState = 'loading' | 'onboarding' | 'disk-warning' | 'ready';

export const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('loading');
  const [diskMessage, setDiskMessage] = useState('');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');

  const checkAppReady = useCallback(async () => {
    try {
      // Vérifier si premier lancement
      const isFirst = await window.api.storage.isFirstRun();
      if (isFirst) {
        setShowOnboarding(true);
        setAppState('onboarding');
        return;
      }

      // Vérifier santé du disque
      const health = await window.api.storage.checkHealth();
      if (!health.available) {
        setDiskMessage(health.message);
        setAppState('disk-warning');
        return;
      }

      setAppState('ready');
    } catch (e) {
      // Si l'API storage n'est pas encore disponible (dev mode), aller directement en mode ready
      console.warn('[App] Storage check failed, defaulting to ready:', e);
      setAppState('ready');
    }
  }, []);

  useEffect(() => {
    checkAppReady();
  }, [checkAppReady]);

  // Notification discrète de mise à jour (§2.3) — non intrusive, via toast.
  useEffect(() => {
    if (appState !== 'ready') return;
    const offAvailable = window.api?.updates?.onUpdateAvailable?.((info: { version: string }) => {
      toast.info(`Une mise à jour est disponible (v${info.version}). Elle sera installée à la fermeture.`);
    });
    const offDownloaded = window.api?.updates?.onUpdateDownloaded?.((info: { version: string }) => {
      toast.success(`Mise à jour v${info.version} prête. Elle sera installée à la fermeture.`);
    });
    return () => {
      offAvailable?.();
      offDownloaded?.();
    };
  }, [appState]);

  useEffect(() => {
    if (appState !== 'ready') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const page = PAGE_SHORTCUTS[e.key];
      if (page) {
        e.preventDefault();
        setCurrentPage(page);
      }
    };
    // Navigation programmatique (boutons internes des pages).
    const VALID_PAGES = new Set<Page>([
      'dashboard', 'products', 'stock', 'clients', 'suppliers', 'invoices',
      'devis', 'delivery-notes', 'credit-notes', 'settings', 'pos',
      'purchases', 'inventory', 'reports', 'stock-alerts',
    ]);
    const handleNavigate = (e: Event) => {
      const target = (e as CustomEvent).detail as Page;
      if (target && VALID_PAGES.has(target)) {
        setCurrentPage(target);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('navigate', handleNavigate);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('navigate', handleNavigate);
    };
  }, [appState]);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    checkAppReady();
  }, [checkAppReady]);

  const handleRetryDisk = useCallback(() => {
    checkAppReady();
  }, [checkAppReady]);

  const handleChangeLocation = useCallback(() => {
    setCurrentPage('settings');
    setAppState('ready');
    // Le settings page gérera le changement d'emplacement
  }, []);

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (appState === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center', color: '#6b7280' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📦</div>
          <div style={{ fontSize: '18px' }}>Chargement de StockLocal...</div>
        </div>
      </div>
    );
  }

  // ─── Onboarding ─────────────────────────────────────────────────────────────
  if (appState === 'onboarding' || showOnboarding) {
    return <OnboardingWizard onComplete={handleOnboardingComplete} />;
  }

  // ─── Disk Warning ───────────────────────────────────────────────────────────
  if (appState === 'disk-warning') {
    return (
      <DiskWarning
        message={diskMessage}
        onRetry={handleRetryDisk}
        onChangeLocation={handleChangeLocation}
      />
    );
  }

  // ─── Ready ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', fontFamily: '"Inter", "Segoe UI", sans-serif', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      {currentPage === 'dashboard' && <DashboardPage />}
      {currentPage === 'products' && <ProductsPage />}
      {currentPage === 'stock' && <StockPage />}
      {currentPage === 'clients' && <ClientsPage />}
      {currentPage === 'suppliers' && <SuppliersPage />}
      {currentPage === 'invoices' && <InvoicePage initialType="INVOICE" />}
      {currentPage === 'devis' && <InvoicePage initialType="QUOTE" />}
      {currentPage === 'delivery-notes' && <InvoicePage initialType="DELIVERY_NOTE" />}
      {currentPage === 'credit-notes' && <InvoicePage initialType="CREDIT_NOTE" />}
      {currentPage === 'settings' && <SettingsPage />}
      {currentPage === 'pos' && <POSPage />}
      {currentPage === 'purchases' && <PurchasesPage />}
      {currentPage === 'inventory' && <InventoryPage />}
      {currentPage === 'reports' && <ReportsPage />}
      {currentPage === 'stock-alerts' && <StockAlertsPage />}
      <Toaster />
    </div>
  );
};

export default App;
