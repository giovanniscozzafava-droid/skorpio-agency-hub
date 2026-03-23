import React from 'react';

interface AvatarProps {
  nome: string;
  colore: string;
  size?: number;
  className?: string;
}

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  function Avatar({ nome, colore, size = 32, className = '' }, ref) {
    const iniziale = nome.charAt(0).toUpperCase();
    return (
      <div
        ref={ref}
        className={`sk-avatar flex-shrink-0 ${className}`}
        style={{
          width: size,
          height: size,
          backgroundColor: colore,
          fontSize: size * 0.4,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: 700,
          userSelect: 'none',
        }}
      >
        {iniziale}
      </div>
    );
  }
);

Avatar.displayName = 'Avatar';
