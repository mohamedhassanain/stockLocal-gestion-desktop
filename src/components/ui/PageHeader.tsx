import React from 'react';

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  icon,
  actions,
}) => (
  <div className="page-header">
    <div>
      <h1>
        {icon}
        {title}
      </h1>
      {subtitle && (
        <div className="text-sm text-muted" style={{ marginTop: 4 }}>
          {subtitle}
        </div>
      )}
    </div>
    {actions && <div className="flex gap-2">{actions}</div>}
  </div>
);

export default PageHeader;
