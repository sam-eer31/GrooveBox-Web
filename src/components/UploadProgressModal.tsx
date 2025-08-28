import React from 'react';
import type { UploadProgress } from '../types';

interface UploadProgressModalProps {
  isOpen: boolean;
  uploadProgress: UploadProgress[];
  totalUploaded: number;
  totalUploadSize: number;
  formatFileSize: (bytes: number) => string;
  formatSpeed: (bps: number) => string;
  onCancel: () => void;
}

const UploadProgressModal: React.FC<UploadProgressModalProps> = ({
  isOpen,
  uploadProgress,
  totalUploaded,
  totalUploadSize,
  formatFileSize,
  formatSpeed,
  onCancel,
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-lg card p-6 md:p-7">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Uploading Tracks...</h2>
        </div>
        <div className="mt-4 space-y-4">
          {/* Overall progress */}
          <div className="panel p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium">Overall Progress</span>
              <span className="text-sm text-black/60 dark:text-white/60">
                {formatFileSize(totalUploaded)} / {formatFileSize(totalUploadSize)}
              </span>
            </div>
            <div className="w-full bg-black/10 dark:bg-white/10 rounded-full h-2">
              <div
                className="bg-brand-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${totalUploadSize > 0 ? (totalUploaded / totalUploadSize) * 100 : 0}%` }}
              />
            </div>
          </div>
          {/* Individual file progress */}
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {uploadProgress.map((item, index) => (
              <div key={index} className="panel p-3">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-sm font-medium truncate flex-1 mr-2" title={item.fileName}>
                    {item.fileName}
                  </span>
                  <span className="text-xs text-black/60 dark:text-white/60 whitespace-nowrap">
                    {item.status === 'completed' ? '100%' : `${Math.round(item.progress)}%`}
                  </span>
                </div>
                <div className="w-full bg-black/10 dark:bg-white/10 rounded-full h-1.5 mb-2">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      item.status === 'error' ? 'bg-red-500' :
                      item.status === 'completed' ? 'bg-green-500' : 'bg-brand-500'
                    }`}
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
                <div className="flex justify-between items-center text-xs text-black/60 dark:text-white/60">
                  <span>
                    {formatFileSize(item.uploaded)} / {formatFileSize(item.total)}
                  </span>
                  <span>
                    {item.status === 'uploading' && item.speed > 0 ? formatSpeed(item.speed) : ''}
                  </span>
                </div>
                {item.status === 'error' && item.error && (
                  <p className="text-xs text-red-500 mt-1">{item.error}</p>
                )}
                {item.status === 'completed' && (
                  <div className="flex items-center text-xs text-green-600 dark:text-green-400 mt-1">
                    <span className="mr-1">✓</span> Uploaded successfully
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Cancel button */}
          <div className="flex justify-end">
            <button
              className="btn-outline border-red-500/60 text-red-500 hover:bg-red-500/10"
              onClick={onCancel}
            >
              Cancel Uploads
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UploadProgressModal;
