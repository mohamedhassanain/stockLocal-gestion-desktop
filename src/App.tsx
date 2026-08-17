import React, { useEffect, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { StockPage } from './pages/StockPage';
import { ClientsPage } from './pages/ClientsPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { InvoicePage } from './pages/InvoicePage';

export type Page = 'dashboard' | 'products' | 'stock' | 'clients' | 'suppliers' | 'invoices';

const PAGE_SHORTCUTS: Record<string, Page> = {
  F1: 'dashboard',
  F2: 'products',
  F3: 'stock',
  F4: 'clients',
  F5: 'suppliers',
  F6: 'invoices',
};

export const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const page = PAGE_SHORTCUTS[e.key];
      if (page) {
        e.preventDefault();
        setCurrentPage(page);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div style={{ display: 'flex', fontFamily: '"Inter", "Segoe UI", sans-serif', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      {currentPage === 'dashboard' && <DashboardPage />}
      {currentPage === 'products' && <ProductsPage />}
      {currentPage === 'stock' && <StockPage />}
      {currentPage === 'clients' && <ClientsPage />}
      {currentPage === 'suppliers' && <SuppliersPage />}
      {currentPage === 'invoices' && <InvoicePage />}
    </div>
  );
};

export default App;
