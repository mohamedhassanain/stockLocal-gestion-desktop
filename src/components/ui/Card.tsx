import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: boolean;
  overflow?: boolean;
}

export const Card: React.FC<CardProps> = ({
  padding = false,
  overflow = false,
  className = '',
  children,
  ...props
}) => {
  const classes = [
    'card',
    padding ? 'card-body' : '',
    overflow ? 'overflow-hidden' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} style={overflow ? { overflow: 'hidden' } : undefined} {...props}>
      {children}
    </div>
  );
};

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <div className={`card-header ${className}`.trim()} {...props}>
    {children}
  </div>
);

export const CardBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <div className={`card-body ${className}`.trim()} {...props}>
    {children}
  </div>
);

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <div className={`card-footer ${className}`.trim()} {...props}>
    {children}
  </div>
);

export default Card;
