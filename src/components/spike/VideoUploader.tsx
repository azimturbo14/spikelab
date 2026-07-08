'use client';

import { X, Loader2, AlertCircle, Volleyball } from 'lucide-react';
import { useCallback, useState, useRef } from 'react';
import { useI18n } from '@/lib/i18n-store';

interface VideoUploaderProps {
  onVideoReady: (file: File) => void;
  isAnalyzing: boolean;
  disabled: boolean;
}

const VIDEO_EXTENSIONS = /\.(mp4|mov|avi|webm|mkv|flv|m4v|3gp|3g2|mts|m2ts|ogv|wmv)$/i;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function VideoUploader({
  onVideoReady,
  isAnalyzing,
  disabled,
}: VideoUploaderProps) {
  const { t } = useI18n();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      setUploadError(null);

      const isVideoByMime = file.type.startsWith('video/');
      const isVideoByExt = VIDEO_EXTENSIONS.test(file.name);

      if (!isVideoByMime && !isVideoByExt) {
        setUploadError(t().uploader.errorNotVideo);
        return;
      }

      if (file.size > 50 * 1024 * 1024) {
        setUploadError(t().uploader.errorTooLarge);
        return;
      }

      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }

      const url = URL.createObjectURL(file);
      setSelectedFile(file);
      setVideoUrl(url);
      onVideoReady(file);
    },
    [videoUrl, onVideoReady, t]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (disabled || isAnalyzing) return;

      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [disabled, isAnalyzing, handleFile]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled && !isAnalyzing) {
        setIsDragOver(true);
      }
    },
    [disabled, isAnalyzing]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    },
    []
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [handleFile]
  );

  const handleClick = useCallback(() => {
    if (!disabled && !isAnalyzing && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [disabled, isAnalyzing]);

  const handleRemove = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      setSelectedFile(null);
      setVideoUrl(null);
      setUploadError(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [videoUrl]
  );

  return (
    <div className="relative w-full">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleInputChange}
        className="hidden"
        disabled={disabled || isAnalyzing}
      />

      {/* Drag-and-drop zone / video preview container */}
      <div
        onClick={selectedFile ? undefined : handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          relative w-full rounded-2xl border-2 border-dashed transition-all duration-200
          ${
            uploadError
              ? 'border-red-200 bg-red-50/50 dark:bg-red-950/20'
              : selectedFile
                ? 'border-border bg-background'
                : isDragOver
                  ? 'border-primary bg-primary/5 cursor-pointer'
                  : disabled || isAnalyzing
                    ? 'border-muted-foreground/20 bg-muted/30 cursor-not-allowed'
                    : 'border-muted-foreground/30 bg-muted/50 cursor-pointer hover:bg-muted/70 hover:border-primary/50'
          }
        `}
      >
        {!selectedFile ? (
          /* Upload prompt */
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
            <div
              className={`rounded-2xl p-4 transition-colors duration-200 ${
                isDragOver
                  ? 'bg-primary/10 text-primary'
                  : disabled || isAnalyzing
                    ? 'bg-muted text-muted-foreground/50'
                    : 'bg-primary/10 text-primary'
              }`}
            >
              <Volleyball className="h-10 w-10" />
            </div>
            <div className="text-center">
              <p
                className={`text-base font-semibold ${
                  disabled || isAnalyzing
                    ? 'text-muted-foreground/50'
                    : 'text-foreground'
                }`}
              >
                {t().uploader.dropHere}
              </p>
              <p
                className={`mt-1 text-sm ${
                  disabled || isAnalyzing
                    ? 'text-muted-foreground/40'
                    : 'text-muted-foreground'
                }`}
              >
                {t().uploader.orBrowse}
              </p>
            </div>
            <p className="text-xs text-muted-foreground/60">
              {t().uploader.formats}
            </p>
          </div>
        ) : (
          /* Video preview */
          <div className="p-3">
            {/* File info bar */}
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                <span className="truncate text-sm font-medium text-foreground">
                  {selectedFile.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  ({formatFileSize(selectedFile.size)})
                </span>
              </div>
              <button
                onClick={handleRemove}
                disabled={isAnalyzing}
                className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                {t().uploader.remove}
              </button>
            </div>

            {/* Video player */}
            {videoUrl && (
              <video
                src={videoUrl}
                controls
                className="w-full rounded-xl bg-black max-h-64 object-contain"
                preload="metadata"
              />
            )}

            {/* Ready to analyze indicator */}
            {!isAnalyzing && (
              <div className="mt-2 flex items-center justify-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                <div className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                {t().uploader.readyToAnalyze}
              </div>
            )}
          </div>
        )}

        {/* Upload error overlay */}
        {uploadError && (
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-red-600 dark:text-red-400 border-t border-red-200 dark:border-red-800/40">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}

        {/* Analyzing overlay */}
        {isAnalyzing && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-background/80 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">
              {t().uploader.analyzing}
            </p>
            <p className="text-xs text-muted-foreground">
              {t().uploader.analyzingSub}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}