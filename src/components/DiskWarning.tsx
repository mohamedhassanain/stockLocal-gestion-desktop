import React from 'react';

interface DiskWarningProps {
  message: string;
  onRetry: () => void;
  onChangeLocation: () => void;
}

/**
 * Affiché quand le disque contenant les données est déconnecté.
 * Empêche l'application de crasher et guide l'utilisateur.
 */
export const DiskWarning: React.FC<DiskWarningProps> = ({ message, onRetry, onChangeLocation }) => {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0f172a',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }}>
      <div style={{
        background: 'white', borderRadius: '16px', padding: '40px', width: '520px',
        boxShadow: '0 25px 50px rgba(0,0,0,0.3)', textAlign: 'center',
      }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>💾</div>
        <h1 style={{ color: '#991b1b', fontSize: '22px', margin: '0 0 12px' }}>
          Données indisponibles
        </h1>
        <div style={{
          padding: '16px', background: '#fef2f2', borderRadius: '8px', border: '1px solid #fecaca',
          color: '#991b1b', fontSize: '14px', marginBottom: '24px', whiteSpace: 'pre-line', lineHeight: '1.6',
        }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={onRetry} style={{
            flex: 1, padding: '16px', background: '#2563eb', color: 'white', border: 'none',
            borderRadius: '8px', fontSize: '16px', fontWeight: '700', cursor: 'pointer',
          }}>
            🔄 Réessayer
          </button>
          <button onClick={onChangeLocation} style={{
            flex: 1, padding: '16px', background: '#f3f4f6', color: '#374151',
            border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '16px', fontWeight: '600',
            cursor: 'pointer',
          }}>
            📁 Changer l'emplacement
          </button>
        </div>
      </div>
    </div>
  );
};
