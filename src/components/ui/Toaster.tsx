import React from 'react';
import { useToastStore } from '../../stores/useToastStore';

const ICONS: Record<string, string> = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
};

const COLORS: Record<string, string> = {
  success: 'var(--success)',
  error: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--primary)',
};

/** Rendu du conteneur de notifications (§28). À placer au niveau racine de l'application. */
export const Toaster: React.FC = () => {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 2000, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380 }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => dismiss(t.id)}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderLeft: `4px solid ${COLORS[t.type]}`,
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            animation: 'slideUp 0.18s ease',
          }}
        >
          <span style={{ fontSize: 18, flexShrink: 0 }}>{ICONS[t.type]}</span>
          <span style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.4 }}>{t.message}</span>
        </div>
      ))}
    </div>
  );
};

export default Toaster;
