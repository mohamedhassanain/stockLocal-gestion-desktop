import React from 'react';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'muted' | 'primary' | 'info';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  muted: 'badge-muted',
  primary: 'badge-primary',
  info: 'badge-info',
};

export const Badge: React.FC<BadgeProps> = ({
  variant = 'muted',
  className = '',
  children,
  ...props
}) => (
  <span className={`badge ${VARIANT_CLASS[variant]} ${className}`.trim()} {...props}>
    {children}
  </span>
);

export default Badge;
