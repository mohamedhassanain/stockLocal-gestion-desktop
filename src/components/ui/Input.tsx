import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  inputSize?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASS = { sm: 'input-sm', md: '', lg: 'input-lg' };

export const Input: React.FC<InputProps> = ({
  label,
  error,
  inputSize = 'md',
  className = '',
  id,
  ...props
}) => {
  const inputId = id ?? (label ? label.replace(/\s+/g, '-').toLowerCase() : undefined);
  return (
    <div className="form-group">
      {label && (
        <label className="form-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`input ${SIZE_CLASS[inputSize]} ${className}`.trim()}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error && <div className="field-error">{error}</div>}
    </div>
  );
};

export default Input;
