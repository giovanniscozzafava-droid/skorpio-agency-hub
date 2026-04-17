import React from 'react';
import { useApp } from '../context/AppContext';
import { LayoutGrid, Calendar, Plus, Bell, Menu } from 'lucide-react';

interface Props {
  onOpenDrawer: () => void;
  onOpenNotifiche?: () => void;
  onQuickAdd?: () => void;
  notificheCount?: number;
}

/**
 * Bottom Navigation — stile app mobile/tablet
 * Visibile solo su schermi <1024px. Mostra le 5 azioni più frequenti.
 */
export function BottomNav({ onOpenDrawer, onOpenNotifiche, onQuickAdd, notificheCount = 0 }: Props) {
  const { tab, setTab } = useApp();

  const items = [
    { id: 'kanban', label: 'Task', Icon: LayoutGrid, onClick: () => setTab('kanban') },
    { id: 'calendario', label: 'Calendar', Icon: Calendar, onClick: () => setTab('calendario') },
    { id: 'add', label: 'Aggiungi', Icon: Plus, onClick: onQuickAdd, special: true },
    { id: 'notif', label: 'Notifiche', Icon: Bell, onClick: onOpenNotifiche, badge: notificheCount },
    { id: 'menu', label: 'Menu', Icon: Menu, onClick: onOpenDrawer },
  ];

  return (
    <div className="skorpio-bottom-nav">
      {items.map(item => {
        const isActive = item.id === tab;
        const Icon = item.Icon;
        return (
          <button
            key={item.id}
            onClick={item.onClick}
            className={`skorpio-bottom-nav-item ${isActive ? 'active' : ''} relative`}
            style={item.special ? {
              background: 'linear-gradient(135deg, hsl(var(--skorpio-accent)), #A855F7)',
              color: '#fff',
              transform: 'translateY(-6px)',
              boxShadow: '0 4px 12px rgba(139, 92, 246, 0.4)',
              borderRadius: 20,
              minWidth: 56,
              maxWidth: 56,
              height: 56,
            } : {}}
          >
            <Icon className="icon" style={{ width: item.special ? 26 : 22, height: item.special ? 26 : 22 }} />
            {!item.special && <span className="label">{item.label}</span>}
            {item.badge && item.badge > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                style={{ background: '#EF4444' }}>
                {item.badge > 9 ? '9+' : item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
