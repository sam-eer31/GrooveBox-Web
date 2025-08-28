import React from 'react';
import { Sun, Moon, Users, Menu, X, Copy, Check } from 'lucide-react';
import type { Toast } from '../types';

interface HeaderProps {
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  roomCode: string;
  roomTitle: string;
  isHost: boolean;
  participants: Array<{ key: string; name: string; isHost?: boolean }>;
  isCodeCopied: boolean;
  copyRoomCode: () => void;
  isParticipantsOpen: boolean;
  setIsParticipantsOpen: (open: boolean) => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
  children?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({
  theme,
  setTheme,
  roomCode,
  roomTitle,
  isHost,
  participants,
  isCodeCopied,
  copyRoomCode,
  isParticipantsOpen,
  setIsParticipantsOpen,
  isMobileMenuOpen,
  setIsMobileMenuOpen,
  children,
}) => {
  return (
    <header className="sticky top-[15px] sm:top-0 z-50 bg-white dark:bg-black border-b border-black/10 dark:border-white/10">
      <div className="container-pro flex h-14 sm:h-16 items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-3">
          <img src="/favicon/favicon.svg" alt="GrooveBox" className="h-5 w-5 sm:h-6 sm:w-6" />
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base md:text-lg font-semibold tracking-tight">GrooveBox</h1>
            <p className="text-[10px] sm:text-[11px] text-black/60 dark:text-white/60 truncate">
              {isHost && <span className="text-brand-500">Host</span>}
              {roomTitle && <span className="ml-2">· {roomTitle}</span>}
            </p>
          </div>
        </div>
        {/* Centered Room Info (Desktop and larger) */}
        <div className="hidden md:flex flex-1 items-center justify-center">
          {roomCode && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-gradient-to-br from-white/70 via-white/40 to-transparent dark:from-black/70 dark:via-black/40 dark:to-transparent shadow-sm backdrop-blur">
              <span className="text-xs text-black/60 dark:text-white/60">{roomTitle || 'Room'}</span>
              <span className="font-mono text-sm sm:text-base px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10">{roomCode}</span>
              <button
                onClick={copyRoomCode}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                aria-label="Copy room code"
                title="Copy room code"
              >
                {isCodeCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-green-500" />
                    <span className="text-xs text-green-600 dark:text-green-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-black/60 dark:text-white/60" />
                    <span className="text-xs text-black/60 dark:text-white/60">Copy</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="icon-btn ml-1 sm:ml-2 h-8 w-8 sm:h-9 sm:w-9"
          aria-label="Toggle theme"
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        {children}
      </div>
    </header>
  );
};

export default Header;
