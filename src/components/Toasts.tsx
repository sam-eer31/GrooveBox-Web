import React from 'react';
import type { Toast } from '../types';

interface ToastsProps {
  toasts: Toast[];
}

const Toasts: React.FC<ToastsProps> = ({ toasts }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[60] space-y-2 w-72">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`rounded-md px-3 py-2 text-sm shadow-soft border \
            ${t.type === 'success' ? 'bg-green-600/10 border-green-600/30 text-green-200' : ''}
            ${t.type === 'info' ? 'bg-brand-500/10 border-brand-500/30 text-brand-500' : ''}
            ${t.type === 'warning' ? 'bg-yellow-600/10 border-yellow-600/30 text-yellow-200' : ''}
            ${t.type === 'error' ? 'bg-red-600/10 border-red-600/30 text-red-200' : ''}
          `}
          role="status"
          aria-live="polite"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
};

export default Toasts;
