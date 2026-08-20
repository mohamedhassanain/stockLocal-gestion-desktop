import React from 'react';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select: React.FC<SelectProps> = ({
  label,
  error,
  className = '',
  id,
  children,
  ...props
}) => {
  const selectId = id ?? (label ? label.replace(/\s+/g, '-').toLowerCase() : undefined);
  return (
    <div className="form-group">
      {label && (
        <label className="form-label" htmlFor={selectId}>
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={`select ${className}`.trim()}
        aria-invalid={error ? true : undefined}
        {...props}
      >
        {children}
      </select>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
};

export default Select;
