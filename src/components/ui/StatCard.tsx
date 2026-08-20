import React from 'react';
import type { BadgeVariant } from './Badge';

export type StatTone = 'default' | 'success' | 'warning' | 'danger' | 'primary' | 'info';

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  sub?: React.ReactNode;
  tone?: StatTone;
  softBg?: string;
}

const TONE_COLOR: Record<StatTone, string> = {
  default: 'var(--text)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  primary: 'var(--primary)',
  info: 'var(--info)',
};

const TONE_SOFT: Record<StatTone, string> = {
  default: 'var(--surface-2)',
  success: 'var(--success-soft)',
  warning: 'var(--warning-soft)',
  danger: 'var(--danger-soft)',
  primary: 'var(--primary-soft)',
  info: 'var(--info-soft)',
};

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  icon,
  sub,
  tone = 'default',
  softBg,
}) => (
  <div className="card stat-card">
    {icon ? (
      <div className="flex items-center gap-2">
        <span className="stat-card-icon" style={{ background: softBg ?? TONE_SOFT[tone] }}>
          {icon}
        </span>
        <span className="stat-card-label">{label}</span>
      </div>
    ) : (
      <span className="stat-card-label">{label}</span>
    )}
    <span className="stat-card-value money" style={{ color: TONE_COLOR[tone] }}>
      {value}
    </span>
    {sub && <div className="text-xs text-muted">{sub}</div>}
  </div>
);

/** Mappe un statut métier vers une variante Badge cohérente. */
export function toneToBadgeVariant(tone: StatTone): BadgeVariant {
  if (tone === 'success') return 'success';
  if (tone === 'warning') return 'warning';
  if (tone === 'danger') return 'danger';
  if (tone === 'primary') return 'primary';
  if (tone === 'info') return 'info';
  return 'muted';
}

export default StatCard;
