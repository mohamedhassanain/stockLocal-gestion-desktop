import React, { useMemo, useState } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  /** Formatteur optionnel de la cellule (texte ou JSX). */
  render?: (row: T) => React.ReactNode;
  width?: string | number;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string | number;
  searchableKeys?: (keyof T & string)[];
  searchPlaceholder?: string;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyText?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  /** Rendu optionnel d'actions par ligne (boutons d'édition, etc.). */
  rowActions?: (row: T) => React.ReactNode;
}

/** Tableau professionnel réutilisable : recherche, tri, pagination, états (§25). */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  searchableKeys,
  searchPlaceholder = 'Rechercher…',
  isLoading = false,
  emptyTitle = 'Aucun résultat',
  emptyText = 'Aucune donnée ne correspond à votre recherche.',
  pageSize = 20,
  onRowClick,
  rowActions,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    if (!query.trim() || !searchableKeys || searchableKeys.length === 0) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((row) =>
      searchableKeys.some((key) => {
        const value = (row as Record<string, unknown>)[key];
        return value !== null && value !== undefined && String(value).toLowerCase().includes(q);
      })
    );
  }, [rows, query, searchableKeys]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortKey];
      const bVal = (b as Record<string, unknown>)[sortKey];
      if (aVal === bVal) return 0;
      return (aVal === null || aVal === undefined ? -1 : String(aVal).localeCompare(String(bVal))) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const handleSearch = (value: string) => {
    setQuery(value);
    setPage(1);
  };

  if (isLoading) {
    return (
      <div className="state-box">
        <div className="state-icon">⏳</div>
        <div className="state-title">Chargement…</div>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="state-box">
        <div className="state-icon">📭</div>
        <div className="state-title">{emptyTitle}</div>
        <div className="state-text">{emptyText}</div>
      </div>
    );
  }

  return (
    <div>
      {searchableKeys && searchableKeys.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <input
            className="input"
            type="text"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            style={{ maxWidth: 320 }}
          />
        </div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)' }}>
        <table className="table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  style={{ cursor: col.sortable ? 'pointer' : 'default', width: col.width }}
                >
                  {col.label}
                  {col.sortable && sortKey === col.key && <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
              {rowActions && <th style={{ width: 120 }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr
                key={getRowId(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key}>
                    {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '—')}
                  </td>
                ))}
                {rowActions && <td onClick={(e) => e.stopPropagation()}>{rowActions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="btn btn-secondary" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
            ← Précédent
          </button>
          <span className="text-sm" style={{ fontWeight: 600 }}>
            {safePage} / {totalPages}
          </span>
          <button className="btn btn-secondary" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
            Suivant →
          </button>
        </div>
      )}
    </div>
  );
}

export default DataTable;
