import React, { useState } from 'react';

interface AvatarProps {
  nome: string;
  colore: string;
  size?: number;
  className?: string;
  avatarUrl?: string | null;
}

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  function Avatar({ nome, colore, size = 32, className = '', avatarUrl }, ref) {
    const iniziale = nome.charAt(0).toUpperCase();
    const [imgError, setImgError] = useState(false);
    const showImg = !!avatarUrl && !imgError;

    return (
      <div
        ref={ref}
        className={`sk-avatar flex-shrink-0 ${className}`}
        style={{
          width: size,
          height: size,
          backgroundColor: showImg ? 'transparent' : colore,
          fontSize: size * 0.4,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: 700,
          userSelect: 'none',
          overflow: 'hidden',
          border: showImg ? `2px solid ${colore}` : 'none',
          boxSizing: 'border-box',
        }}
      >
        {showImg ? (
          <img
            src={avatarUrl!}
            alt={nome}
            onError={() => setImgError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : (
          iniziale
        )}
      </div>
    );
  }
);

Avatar.displayName = 'Avatar';
