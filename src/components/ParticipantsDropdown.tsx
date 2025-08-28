import React from 'react';

interface Participant {
  key: string;
  name: string;
  isHost?: boolean;
}

interface ParticipantsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  participants: Participant[];
  displayName: string;
  isHost: boolean;
}

const ParticipantsDropdown: React.FC<ParticipantsDropdownProps> = ({
  isOpen,
  onClose,
  participants,
  displayName,
  isHost,
}) => {
  if (!isOpen) return null;
  return (
    <div className="participants-dropdown absolute top-full right-0 mt-2 w-80 bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-lg shadow-soft z-50">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Participants ({participants.length + 1})</h3>
          <button
            onClick={onClose}
            className="text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Current User (You) */}
        <div className="mb-3">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-brand-500/10 to-brand-500/5 border border-brand-500/20">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white font-semibold text-sm">
                {(displayName || 'Guest').charAt(0).toUpperCase()}
              </div>
              {isHost && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center shadow-sm">
                  <svg className="w-2.5 h-2.5 text-black" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8L15 13.2L18 10.5L17.3 14H6.7L6 10.5L9 13.2L12 8M12 4L8.5 10L3 5L5 16H19L21 5L15.5 10L12 4Z"/>
                  </svg>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-black dark:text-white truncate">{displayName || 'Guest'}</span>
                {isHost && (
                  <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-[9px] font-medium rounded-full border border-yellow-500/30">
                    HOST
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* Other Participants */}
        {participants.length > 0 ? (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {participants.map((p, i) => (
              <div key={p.key + i} className="flex items-center gap-3 p-3 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/20">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center text-white font-semibold text-sm">
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-black dark:text-white truncate">{p.name}</span>
                    {p.isHost && (
                      <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-[9px] font-medium rounded-full border border-yellow-500/30">
                        HOST
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-black/50 dark:text-white/50">Connected</p>
                </div>
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-black/40 dark:text-white/40">
            <div className="w-8 h-8 mx-auto mb-2 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <p className="text-xs">You're the only one here</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ParticipantsDropdown;
