import React from 'react';
import { Music, Play } from 'lucide-react';
import type { Track } from '../types';

interface PlaylistProps {
  tracks: Track[];
  currentIndex: number;
  isPlaying: boolean;
  isLoadingLibrary: boolean;
  enqueueGlobalCommand: (command: string, payload: any) => void;
}

const Playlist: React.FC<PlaylistProps> = ({
  tracks,
  currentIndex,
  isPlaying,
  isLoadingLibrary,
  enqueueGlobalCommand,
}) => {
  return (
    <div className="mt-4 sm:mt-6 bg-gradient-to-br from-white/95 via-white/90 to-white/85 dark:from-black/95 dark:via-black/90 dark:to-black/85 backdrop-blur-xl border border-white/40 dark:border-white/20 rounded-3xl shadow-2xl">
      {/* Playlist Header */}
      <div className="bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-transparent border-b border-white/20 dark:border-white/10 p-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Music className="w-8 h-8 text-white" />
            </div>
            <div>
              <h3 className="text-3xl font-bold text-black dark:text-white mb-1">Playlist</h3>
              <p className="text-base text-black/70 dark:text-white/70">Your music collection</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-brand-600 dark:text-brand-400 mb-1">
              {isLoadingLibrary ? '...' : tracks.length}
            </div>
            <div className="text-sm text-black/60 dark:text-white/60 font-medium">
              {isLoadingLibrary ? 'Loading' : tracks.length === 1 ? 'track' : 'tracks'}
            </div>
          </div>
        </div>
      </div>
      {/* Playlist Content */}
      <div className="p-6 min-h-[300px] pb-8">
        {isLoadingLibrary ? (
          <div className="space-y-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-5 rounded-2xl bg-gradient-to-r from-black/5 to-black/3 dark:from-white/5 dark:to-white/3 animate-pulse">
                <div className="w-12 h-12 bg-gradient-to-br from-black/10 to-black/5 dark:from-white/10 dark:to-white/5 rounded-xl"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gradient-to-r from-black/10 to-black/5 dark:from-white/10 dark:to-white/5 rounded w-3/4"></div>
                  <div className="h-4 bg-gradient-to-r from-black/10 to-black/5 dark:from-white/10 dark:to-white/5 rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        ) : tracks.length === 0 ? (
          <div className="text-center py-12 min-h-[200px] flex flex-col justify-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-brand-500/20 to-brand-500/10 flex items-center justify-center">
              <Music className="w-8 h-8 text-brand-500" />
            </div>
            <h4 className="text-lg font-semibold text-black dark:text-white mb-2">Your playlist is empty</h4>
            <p className="text-black/60 dark:text-white/60 mb-4">Start building your music collection</p>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500/10 dark:bg-brand-500/10 border border-brand-500/20 dark:border-brand-500/20 rounded-lg text-brand-600 dark:text-brand-400 text-sm font-medium">
              <Play className="w-4 h-4" />
              Upload your first track
            </div>
          </div>
        ) : (
          <div className="space-y-3 max-h-[700px] overflow-y-auto px-2 py-2">
            {tracks.length === 1 && (
              <div className="text-center py-4 mb-4">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-brand-500/10 dark:bg-brand-500/10 border border-brand-500/20 dark:border-brand-500/20 rounded-full text-brand-600 dark:text-brand-400 text-xs font-medium">
                  <Music className="w-3 h-3" />
                  Single Track
                </div>
              </div>
            )}
            {tracks.map((t, idx) => {
              const active = idx === currentIndex;
              return (
                <div
                  key={t.id}
                  className={`group relative overflow-hidden rounded-2xl transition-all duration-300 ${
                    active
                      ? 'bg-gradient-to-r from-brand-500/20 via-brand-500/15 to-brand-500/10 shadow-lg ring-2 ring-brand-500/30'
                      : 'hover:bg-gradient-to-r hover:from-black/8 hover:via-black/5 hover:to-black/3 dark:hover:from-white/8 dark:hover:via-white/5 dark:hover:to-white/3'
                  }`}
                >
                  <button
                    className="w-full text-left p-5 transition-all duration-300"
                    onClick={() => {
                      enqueueGlobalCommand('select', { index: idx });
                      enqueueGlobalCommand('play', { index: idx, time: 0 });
                    }}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`relative w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                        active
                          ? 'bg-brand-500 text-white shadow-lg'
                          : 'bg-gradient-to-br from-black/10 to-black/5 dark:from-white/10 dark:to-white/5 text-black/70 dark:text-white/70 group-hover:bg-black/20 dark:group-hover:bg-white/20'
                      }`}>
                        {active && isPlaying ? (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="flex items-center gap-1">
                              <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
                              <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                              <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                            </div>
                          </div>
                        ) : (
                          idx + 1
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-black dark:text-white truncate text-base mb-1">
                          {t.name}
                        </div>
                        {active && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-500/20 dark:bg-brand-500/20 px-2 py-1 rounded-full">
                              {isPlaying ? 'Now Playing' : 'Paused'}
                            </span>
                          </div>
                        )}
                      </div>
                      {!active && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          <div className="w-8 h-8 bg-brand-500/20 dark:bg-brand-500/20 rounded-full flex items-center justify-center">
                            <Play className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                          </div>
                        </div>
                      )}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Playlist;
