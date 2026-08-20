import React from 'react';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  className = '',
  id,
  ...props
}) => {
  const textareaId = id ?? (label ? label.replace(/\s+/g, '-').toLowerCase() : undefined);
  return (
    <div className="form-group">
      {label && (
        <label className="form-label" htmlFor={textareaId}>
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        className={`textarea ${className}`.trim()}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error && <div className="field-error">{error}</div>}
    </div>
  );
};

export default Textarea;
