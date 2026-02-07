/**
 * Snapshot of a file's stat metadata used for cache invalidation.
 * When size or mtime changes the cached line count is considered stale.
 */
export interface FileCacheMetadata {
  size: number;
  mtimeMs: number;
}

/**
 * Resolved user + default configuration for a LineSight session.
 * Built once at activation and rebuilt whenever VS Code settings change.
 */
export interface LineSightConfig {
  /** Files larger than this (bytes) use byte-based estimation instead of counting. */
  sizeLimit: number;
  /** Number of files sent to the decoration provider per initialization batch. */
  batchSize: number;
  /** Milliseconds to wait before flushing debounced file-change events. */
  debounceDelay: number;
  /** Milliseconds to wait after activation before starting the initial workspace scan. */
  initialScanDelay: number;
  /** Assumed average bytes-per-line, used to estimate counts for oversized files. */
  estimationFactor: number;
  /** Folder paths (normalized, no leading/trailing slashes) to skip during scanning. */
  excludeFolders: string[];
  /** Allowed file extensions (lowercased, dot-prefixed). */
  includeExtensions: Set<string>;
  /** Extensionless filenames (lowercased) that should still be counted (e.g. "dockerfile"). */
  includeFileNames: Set<string>;
  /** Whether to show status-bar messages during initialization. */
  showStartupNotifications: boolean;
}
