import React from 'react';
import { useApp, ToastItem } from '../context/AppContext';

const tipoStyle: Record<string, string> = {
  info: 'bg-[#1e293b]',
  success: 'bg-[#15803d]',
  error: 'bg-[#b91c1c]',
  warn: 'bg-[#d97706]',
};

const tipoIcon: Record<string, string> = {
  info: 'ℹ️',
  success: '✅',
  error: '❌',
  warn: '⚠️',
};

export function ToastContainer() {
  const { toasts, removeToast } = useApp();

  return (
    <div className="sk-toast-container">
      {toasts.map((t: ToastItem) => (
        <div
          key={t.id}
          className={`sk-toast ${tipoStyle[t.tipo] || tipoStyle.info} animate-slide-up`}
          onClick={() => removeToast(t.id)}
        >
          <span>{tipoIcon[t.tipo]}</span>
          <span className="flex-1 text-sm">{t.msg}</span>
          <button className="opacity-60 hover:opacity-100 text-xs ml-2">✕</button>
        </div>
      ))}
    </div>
  );
}
