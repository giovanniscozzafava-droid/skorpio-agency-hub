import React, { createContext, useContext, useState, ReactNode } from 'react';
import type { TeamMember } from '../types';

interface AppContextType {
  utente: TeamMember | null;
  setUtente: (u: TeamMember | null) => void;
  tab: string;
  setTab: (t: string) => void;
  toasts: ToastItem[];
  addToast: (msg: string, tipo?: 'info' | 'success' | 'error' | 'warn') => void;
  removeToast: (id: string) => void;
}

export interface ToastItem {
  id: string;
  msg: string;
  tipo: 'info' | 'success' | 'error' | 'warn';
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [utente, setUtente] = useState<TeamMember | null>(null);
  const [tab, setTab] = useState('kanban');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = (msg: string, tipo: 'info' | 'success' | 'error' | 'warn' = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, msg, tipo }]);
    setTimeout(() => removeToast(id), 3000);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <AppContext.Provider value={{ utente, setUtente, tab, setTab, toasts, addToast, removeToast }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}
