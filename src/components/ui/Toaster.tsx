import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useToastStore } from '../../stores/useToastStore';

const ICONS: Record<string, React.ComponentType<any>> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS: Record<string, string> = {
  success: 'var(--success)',
  error: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--primary)',
};

/** Rendu du conteneur de notifications (§3.6). À placer au niveau racine. */
export const Toaster: React.FC = () => {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 2000, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380 }}>
      {toasts.map((t) => {
        const Icon = ICONS[t.type] ?? Info;
        const color = COLORS[t.type] ?? 'var(--primary)';
        return (
          <div
            key={t.id}
            role="status"
            className="toast-item"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderLeft: `4px solid ${color}`,
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-md)',
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
            }}
            onClick={() => dismiss(t.id)}
          >
            <Icon size={18} style={{ color, flexShrink: 0 }} />
            <span style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.4, flex: 1 }}>{t.message}</span>
            <X size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          </div>
        );
      })}
    </div>
  );
};

export default Toaster;
