import React, { RefObject } from 'react';

interface UploadModalProps {
  isOpen: boolean;
  isUploading: boolean;
  isLoadingLibrary: boolean;
  error: string | null;
  onClose: () => void;
  onFiles: (files: FileList | null) => void;
  inputRef: RefObject<HTMLInputElement>;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
}

const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  isUploading,
  isLoadingLibrary,
  error,
  onClose,
  onFiles,
  inputRef,
  onDrop,
  onDragOver,
}) => {
  if (!isOpen || isUploading) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg card p-6 md:p-7">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Upload Tracks</h2>
        </div>
        <div
          onDrop={(e) => { onDrop(e); onClose(); }}
          onDragOver={onDragOver}
          className="mt-4 panel p-6 text-center border-2 border-dashed border-black/20 dark:border-white/20 hover:border-brand-500/60 transition"
        >
          <p className="text-black/70 dark:text-white/70">Drag and drop songs here</p>
          <p className="mt-1 text-[11px] text-black/50 dark:text-white/50">MP3, WAV, M4A, AAC</p>
          <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center">
            <label
              htmlFor="file-input"
              className="btn-outline cursor-pointer"
              onClick={() => { if (inputRef.current) inputRef.current.value = ''; }}
            >
              Choose Files
            </label>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
          </div>
          {isLoadingLibrary && (
            <p className="mt-2 text-sm text-black/60 dark:text-white/60">Loading your library…</p>
          )}
          {error && (
            <p className="mt-2 text-sm text-red-500">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default UploadModal;
