import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * §Phase 5 — Recherche globale (Ctrl+K).
 *
 * - Résultats GROUPÉS (Produits, Clients, Fournisseurs, Documents, Commandes).
 * - Recherche SQL indexée, paginée par groupe (jamais de chargement complet).
 * - Clic sur un résultat : ferme la palette et navigue vers la page concernée,
 *   en publiant un évènement `focus-entity` (détail de l'entité ciblée).
 */

interface GlobalSearchProduct {
  id: string;
  reference: string;
  designation: string;
  barcode: string | null;
  selling_price: number;
}
interface GlobalSearchParty {
  id: string;
  name: string;
  phone: string | null;
  documentCount: number;
}
interface GlobalSearchDocument {
  id: string;
  document_number: string;
  type: string;
  party_name: string | null;
  total_incl_tax: number;
  date: string;
}
interface GlobalSearchPurchase {
  id: string;
  order_number: string;
  supplier_name: string | null;
  total: number;
  date: string;
}
interface GlobalSearchResult {
  query: string;
  products: GlobalSearchProduct[];
  customers: GlobalSearchParty[];
  suppliers: GlobalSearchParty[];
  documents: GlobalSearchDocument[];
  purchases: GlobalSearchPurchase[];
  total: number;
}

const EMPTY: GlobalSearchResult = {
  query: '', products: [], customers: [], suppliers: [], documents: [], purchases: [], total: 0,
};

/** Type de document → page de destination dans l'application. */
const DOCUMENT_PAGE: Record<string, string> = {
  INVOICE: 'invoices',
  QUOTE: 'devis',
  DELIVERY_NOTE: 'delivery-notes',
  CREDIT_NOTE: 'credit-notes',
};

/** Type de document → libellé français. */
const DOCUMENT_LABEL: Record<string, string> = {
  INVOICE: 'Facture',
  QUOTE: 'Devis',
  DELIVERY_NOTE: 'Bon de livraison',
  CREDIT_NOTE: 'Avoir',
};

const DEBOUNCE_MS = 180;

function navigateTo(page: string, entity: { kind: string; id: string; label: string } | null): void {
  window.dispatchEvent(new CustomEvent('navigate', { detail: page }));
  if (entity) {
    // Les pages peuvent écouter cet évènement pour ouvrir directement la fiche.
    window.dispatchEvent(new CustomEvent('focus-entity', { detail: entity }));
  }
}

export const GlobalSearchModal: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<GlobalSearchResult>(EMPTY);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Raccourci global Ctrl+K (et Cmd+K sur macOS).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
        return;
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    setQuery('');
    setResult(EMPTY);
    return undefined;
  }, [open]);

  // Recherche debouncée : une seule requête IPC par frappe stabilisée.
  useEffect(() => {
    if (!open) return undefined;
    const term = query.trim();
    if (term === '') { setResult(EMPTY); return undefined; }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = (await window.api.search.global(term)) as GlobalSearchResult;
        if (!cancelled) setResult(res ?? EMPTY);
      } catch {
        if (!cancelled) setResult(EMPTY);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, open]);

  const close = useCallback(() => setOpen(false), []);

  if (!open) return null;

  const go = (page: string, entity: { kind: string; id: string; label: string } | null) => {
    navigateTo(page, entity);
    close();
  };

  const hasResults = result.total > 0;

  return (
    <div
      className="modal-backdrop"
      style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh' }}
      onClick={close}
    >
      <div
        className="card"
        style={{ width: 'min(680px, 92vw)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <input
            ref={inputRef}
            type="text"
            className="input input-lg"
            style={{ width: '100%' }}
            placeholder="Rechercher un produit, client, fournisseur, facture, commande…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Recherche globale"
          />
          <div className="text-xs text-muted" style={{ marginTop: 6 }}>
            <strong>Ctrl + K</strong> pour ouvrir/fermer · <strong>Échap</strong> pour fermer
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '8px 0' }}>
          {isSearching && <div className="state-text" style={{ padding: '8px 16px' }}>Recherche…</div>}
          {!isSearching && query.trim() !== '' && !hasResults && (
            <div className="state-text" style={{ padding: '16px' }}>Aucun résultat pour « {query.trim()} ».</div>
          )}
          {query.trim() === '' && (
            <div className="state-text" style={{ padding: '16px' }}>
              Saisissez un nom, une référence, un code-barres, un numéro de document ou un téléphone.
            </div>
          )}

          {result.products.length > 0 && (
            <SearchGroup title="Produits">
              {result.products.map(p => (
                <SearchRow
                  key={p.id}
                  primary={`${p.reference} — ${p.designation}`}
                  secondary={`${p.selling_price.toFixed(2)} MAD${p.barcode ? ` · ${p.barcode}` : ''}`}
                  onSelect={() => go('products', { kind: 'product', id: p.id, label: p.reference })}
                />
              ))}
            </SearchGroup>
          )}

          {result.customers.length > 0 && (
            <SearchGroup title="Clients">
              {result.customers.map(c => (
                <SearchRow
                  key={c.id}
                  primary={c.name}
                  secondary={`${c.phone ?? 'sans téléphone'} · ${c.documentCount} document(s)`}
                  onSelect={() => go('clients', { kind: 'customer', id: c.id, label: c.name })}
                />
              ))}
            </SearchGroup>
          )}

          {result.suppliers.length > 0 && (
            <SearchGroup title="Fournisseurs">
              {result.suppliers.map(s => (
                <SearchRow
                  key={s.id}
                  primary={s.name}
                  secondary={`${s.phone ?? 'sans téléphone'} · ${s.documentCount} commande(s)`}
                  onSelect={() => go('suppliers', { kind: 'supplier', id: s.id, label: s.name })}
                />
              ))}
            </SearchGroup>
          )}

          {result.documents.length > 0 && (
            <SearchGroup title="Documents">
              {result.documents.map(d => (
                <SearchRow
                  key={d.id}
                  primary={`${d.document_number} — ${DOCUMENT_LABEL[d.type] ?? d.type}`}
                  secondary={`${d.party_name ?? '—'} · ${d.total_incl_tax.toFixed(2)} MAD · ${String(d.date).split('T')[0]}`}
                  onSelect={() => go(DOCUMENT_PAGE[d.type] ?? 'invoices', { kind: 'document', id: d.id, label: d.document_number })}
                />
              ))}
            </SearchGroup>
          )}

          {result.purchases.length > 0 && (
            <SearchGroup title="Commandes d'achat">
              {result.purchases.map(p => (
                <SearchRow
                  key={p.id}
                  primary={`${p.order_number}`}
                  secondary={`${p.supplier_name ?? '—'} · ${p.total.toFixed(2)} MAD · ${String(p.date).split('T')[0]}`}
                  onSelect={() => go('purchases', { kind: 'purchase', id: p.id, label: p.order_number })}
                />
              ))}
            </SearchGroup>
          )}
        </div>
      </div>
    </div>
  );
};

const SearchGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: 4 }}>
    <div className="text-xs text-muted" style={{ padding: '6px 16px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {title}
    </div>
    {children}
  </div>
);

const SearchRow: React.FC<{ primary: string; secondary: string; onSelect: () => void }> = ({ primary, secondary, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    className="list-item"
    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 16px', background: 'transparent', border: 'none', cursor: 'pointer' }}
  >
    <div className="font-semibold" style={{ fontSize: 'var(--font-size-sm)' }}>{primary}</div>
    <div className="text-xs text-muted">{secondary}</div>
  </button>
);
