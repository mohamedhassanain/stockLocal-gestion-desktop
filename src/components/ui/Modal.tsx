import React from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  width?: number | string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ open, onClose, width = 520, children }) => {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel"
        style={{ width, maxWidth: 'calc(100vw - 48px)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
};

export const ModalHeader: React.FC<{ icon?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode }> = ({
  icon,
  title,
  subtitle,
}) => (
  <div className="modal-header">
    {icon && <span style={{ fontSize: 24 }}>{icon}</span>}
    <div>
      <h2 style={{ margin: 0 }}>{title}</h2>
      {subtitle && <div className="text-sm text-muted" style={{ marginTop: 4 }}>{subtitle}</div>}
    </div>
  </div>
);

export const ModalBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', children, ...props }) => (
  <div className={`modal-body ${className}`.trim()} {...props}>{children}</div>
);

export const ModalFooter: React.FC<React.HTMLAttributes<HTMLDivElement> & { between?: boolean }> = ({
  between = false,
  className = '',
  children,
  ...props
}) => (
  <div className={`modal-footer ${between ? 'modal-footer-between' : ''} ${className}`.trim()} {...props}>
    {children}
  </div>
);

export default Modal;
