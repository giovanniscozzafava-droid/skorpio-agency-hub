Clientelogo · TSX
Copia

import React from 'react';
 
// Colori deterministici basati sul nome del cliente
const CLIENT_COLORS = [
  '#8B5CF6', '#EC4899', '#F59E0B', '#22C55E', '#3B82F6',
  '#EF4444', '#06B6D4', '#6366F1', '#D946EF', '#14B8A6',
];
 
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}
 
interface ClienteLogoProps {
  nome: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
}
 
export function ClienteLogo({ nome, logoUrl, size = 24, className = '' }: ClienteLogoProps) {
  const color = CLIENT_COLORS[hashCode(nome || '') % CLIENT_COLORS.length];
  const initials = (nome || '?')
    .split(/[\s.]+/)
    .filter(w => w.length > 0 && w[0] !== w[0].toLowerCase())
    .map(w => w[0])
    .join('')
    .slice(0, 2) || nome?.charAt(0) || '?';
 
  const fontSize = size < 20 ? 8 : size < 32 ? 10 : 12;
 
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={nome}
        className={`rounded-full object-cover flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
 
  return (
    <div
      className={`rounded-full flex items-center justify-center flex-shrink-0 font-bold text-white select-none ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${color}, ${color}cc)`,
        fontSize,
        lineHeight: 1,
      }}
      title={nome}
    >
      {initials}
    </div>
  );
}
 
