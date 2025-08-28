import React from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Shuffle } from 'lucide-react';

interface PlayerControlsProps {
  isPlaying: boolean;
  togglePlay: () => void;
  goPrevious: () => void;
  goNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  duration: number;
  currentTime: number;
  onSeek: (value: number) => void;
  volume: number;
  setVolume: (v: number) => void;
  previousVolume: number;
  setPreviousVolume: (v: number) => void;
  isShuffle: boolean;
  enqueueGlobalCommand: (command: string, payload: any) => void;
  isLoadingLibrary: boolean;
  currentTrack: boolean;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const PlayerControls: React.FC<PlayerControlsProps> = ({
  isPlaying,
  togglePlay,
  goPrevious,
  goNext,
  hasPrevious,
  hasNext,
  duration,
  currentTime,
  onSeek,
  volume,
  setVolume,
  previousVolume,
  setPreviousVolume,
  isShuffle,
  enqueueGlobalCommand,
  isLoadingLibrary,
  currentTrack,
}) => {
  return (
    <div className="relative mt-4 sm:mt-6 bg-gradient-to-br from-white/80 to-white/40 dark:from-black/80 dark:to-black/40 backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-2xl p-6 sm:p-8 lg:p-10 shadow-soft w-full max-w-lg">
      {/* Progress Bar */}
      <div className="w-full max-w-lg">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={(e) => onSeek(Number(e.currentTarget.value))}
          className="w-full accent-brand-500 touch-pan-x h-3 rounded-full bg-black/10 dark:bg-white/10"
          disabled={!currentTrack || isLoadingLibrary}
        />
        <div className="mt-3 flex justify-between text-sm text-black/70 dark:text-white/70 font-medium">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      {/* Playback Controls */}
      <div className="flex items-center justify-center gap-4 sm:gap-6 mt-8">
        <button
          onClick={() => enqueueGlobalCommand('shuffle_toggle', { enabled: !isShuffle })}
          disabled={isLoadingLibrary}
          className={`icon-btn h-10 w-10 sm:h-12 sm:w-12 rounded-full backdrop-blur-sm border border-white/20 dark:border-white/10 transition-all duration-200 ${isShuffle ? 'bg-brand-500/20 text-brand-600 dark:text-brand-400' : 'bg-white/50 dark:bg-black/50 hover:bg-white/70 dark:hover:bg-black/70'}`}
          aria-label="Toggle shuffle"
          title="Shuffle"
        >
          <Shuffle className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>
        <button
          onClick={goPrevious}
          disabled={!hasPrevious || isLoadingLibrary}
          className="icon-btn h-12 w-12 sm:h-14 sm:w-14 lg:h-16 lg:w-16 rounded-full bg-white/50 dark:bg-black/50 backdrop-blur-sm border border-white/20 dark:border-white/10 hover:bg-white/70 dark:hover:bg-black/70 transition-all duration-200 disabled:opacity-50"
          aria-label="Previous"
        >
          <SkipBack className="h-5 w-5 sm:h-6 sm:w-6" />
        </button>
        <button
          onClick={togglePlay}
          disabled={!currentTrack || isLoadingLibrary}
          className="inline-flex items-center justify-center h-10 w-10 sm:h-12 sm:w-12 lg:h-14 lg:w-14 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-white hover:from-brand-400 hover:to-brand-500 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:hover:scale-100"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6" /> : <Play className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 ml-1" />}
        </button>
        <button
          onClick={goNext}
          disabled={!hasNext || isLoadingLibrary}
          className="icon-btn h-12 w-12 sm:h-14 sm:w-14 lg:h-16 lg:w-16 rounded-full bg-white/50 dark:bg-black/50 backdrop-blur-sm border border-white/20 dark:border-white/10 hover:bg-white/70 dark:hover:bg-black/70 transition-all duration-200 disabled:opacity-50"
          aria-label="Next"
        >
          <SkipForward className="h-5 w-5 sm:h-6 sm:w-6" />
        </button>
      </div>
      {/* Volume Controls */}
      <div className="lg:flex items-center gap-3 absolute bottom-4 left-6 hidden">
        <button
          onClick={() => {
            if (volume > 0) {
              setPreviousVolume(volume);
              setVolume(0);
            } else {
              setVolume(previousVolume);
            }
          }}
          className="hover:opacity-80 transition-opacity"
          aria-label={volume > 0 ? 'Mute' : 'Unmute'}
        >
          {volume > 0 ? (
            <Volume2 className="h-4 w-4 text-black/60 dark:text-white/60" />
          ) : (
            <VolumeX className="h-4 w-4 text-black/60 dark:text-white/60" />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.currentTarget.value))}
          className="w-32 accent-brand-500"
        />
      </div>
      <div className="lg:hidden mt-8 flex items-center justify-center gap-3">
        <button
          onClick={() => {
            if (volume > 0) {
              setPreviousVolume(volume);
              setVolume(0);
            } else {
              setVolume(previousVolume);
            }
          }}
          className="hover:opacity-80 transition-opacity"
          aria-label={volume > 0 ? 'Mute' : 'Unmute'}
        >
          {volume > 0 ? (
            <Volume2 className="h-4 w-4 text-black/60 dark:text-white/60" />
          ) : (
            <VolumeX className="h-4 w-4 text-black/60 dark:text-white/60" />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.currentTarget.value))}
          className="w-32 accent-brand-500"
        />
      </div>
    </div>
  );
};

export default PlayerControls;
