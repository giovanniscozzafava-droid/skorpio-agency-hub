import React, { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { X, LayoutGrid, Calendar, Bot, Video, Users, Clapperboard, Settings, LogOut, Monitor, Globe, HeartPulse, BarChart3, Palette, Wrench } from 'lucide-react';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenImpostazioni: () => void;
}

const baseNavItems = [
  { id: 'kanban', label: 'Kanban', icon: LayoutGrid },
  { id: 'calendario', label: 'Calendario', icon: Calendar },
  { id: 'creative', label: 'Creative Engine', icon: Bot },
  { id: 'contenuti', label: 'Contenuti', icon: Video },
  { id: 'clienti', label: 'Clienti', icon: Users },
  { id: 'riprese', label: 'Riprese', icon: Clapperboard },
  { id: 'monitor', label: 'Monitor', icon: Monitor },
  { id: 'assets', label: 'Assets', icon: Palette },
  { id: 'siti', label: 'Siti Web', icon: Globe },
  { id: 'andromeda', label: 'Andromeda', icon: HeartPulse },
  { id: 'report', label: 'Report', icon: BarChart3 },
];

const adminOnlyItems = [
  { id: 'debug', label: 'Debug', icon: Wrench },
];

export function MobileDrawer({ open, onClose, onOpenImpostazioni }: MobileDrawerProps) {
  const { tab, setTab, logout, utente } = useApp();
  const isAdmin = utente?.ruolo === 'Admin';
  const navItems = isAdmin ? [...baseNavItems, ...adminOnlyItems] : baseNavItems;
  const overlayRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (startXRef.current === null) return;
    const diff = e.changedTouches[0].clientX - startXRef.current;
    if (diff < -80) onClose(); // swipe left to close
    startXRef.current = null;
  };

  const handleNav = (id: string) => {
    setTab(id);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] lg:hidden">
      {/* Overlay */}
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-black/50 animate-fade-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="absolute top-0 left-0 bottom-0 w-[280px] flex flex-col animate-slide-in-left"
        style={{ background: 'hsl(var(--topbar-bg))' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">🦂</span>
            <span className="font-bold text-white text-lg tracking-tight">SKORPIO</span>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X size={20} />
          </button>
        </div>

        {/* Nav items — start from bottom concept: use flex-end */}
        <div className="flex-1 flex flex-col justify-end px-3 pb-4 gap-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => handleNav(item.id)}
              className="flex items-center gap-3 px-3 rounded-lg transition-colors min-h-[48px] text-left"
              style={{
                background: tab === item.id ? 'rgba(255,255,255,0.15)' : 'transparent',
                color: tab === item.id ? 'white' : 'rgba(255,255,255,0.6)',
              }}
            >
              <item.icon size={20} />
              <span className="text-sm font-medium">{item.label}</span>
            </button>
          ))}

          <div className="h-px my-2" style={{ background: 'rgba(255,255,255,0.1)' }} />

          <button
            onClick={() => { onOpenImpostazioni(); onClose(); }}
            className="flex items-center gap-3 px-3 rounded-lg transition-colors min-h-[48px] text-left"
            style={{ color: 'rgba(255,255,255,0.6)' }}
          >
            <Settings size={20} />
            <span className="text-sm font-medium">Impostazioni</span>
          </button>

          <button
            onClick={() => { logout(); onClose(); }}
            className="flex items-center gap-3 px-3 rounded-lg transition-colors min-h-[48px] text-left"
            style={{ color: 'rgba(239,68,68,0.8)' }}
          >
            <LogOut size={20} />
            <span className="text-sm font-medium">Logout</span>
          </button>
        </div>
      </div>
    </div>
  );
}
