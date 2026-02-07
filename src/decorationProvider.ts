/**
 * VS Code FileDecorationProvider that shows line counts in the file explorer.
 *
 * Each call to `provideFileDecoration` is initiated by VS Code whenever a
 * file becomes visible.  The provider:
 *  1. Returns instantly from cache when size+mtime haven't changed.
 *  2. Uses byte-based estimation for files above the configured size limit.
 *  3. Delegates actual counting to `countLines`, gated through a
 *     `ConcurrencyLimiter` (default max 20) to avoid overwhelming the host.
 *  4. De-duplicates in-flight counts via `processingQueue`.
 *  5. Batches refresh notifications with a debounce timer.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { AppState } from './state';
import { ConcurrencyLimiter } from './concurrency';
import { shouldSkipPath } from './fileFilter';
import { countLines, createLineDecoration } from './lineCounter';
import { scheduleTimeout, clearTrackedTimer } from './timer';

/** When more unique pending updates queue up than this, switch to a full refresh. */
const PENDING_UPDATES_CAP = 500;

export class LineCountDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  /** Maps file path -> in-flight line-count promise to avoid duplicate work. */
  private processingQueue = new Map<string, Promise<number>>();
  /** File paths whose decorations need to be re-emitted on the next flush. */
  private pendingUpdates = new Set<string>();
  private refreshTimer: NodeJS.Timeout | undefined;
  private fullRefreshPending = false;

  constructor(
    private readonly state: AppState,
    private readonly limiter: ConcurrencyLimiter,
  ) {}

  async provideFileDecoration(uri: vscode.Uri): Promise<vscode.FileDecoration | undefined> {
    try {
      if (uri.scheme !== 'file') {
        return undefined;
      }

      const filePath = uri.fsPath;

      if (shouldSkipPath(filePath, this.state.config)) {
        return undefined;
      }

      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        return undefined;
      }

      const cachedMetadata = this.state.fileMetadataCache.get(filePath);
      const cachedCount = this.state.lineCountCache.get(filePath);

      if (
        cachedMetadata &&
        cachedCount !== undefined &&
        cachedMetadata.size === stat.size &&
        cachedMetadata.mtimeMs === stat.mtimeMs
      ) {
        const cachedDecoration = this.state.fileDecorations.get(filePath) ?? createLineDecoration(cachedCount, stat.size > this.state.config.sizeLimit);
        this.state.fileDecorations.set(filePath, cachedDecoration);
        return cachedDecoration;
      }

      this.state.fileMetadataCache.set(filePath, {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });

      if (stat.size === 0) {
        this.state.lineCountCache.set(filePath, 0);
        const zeroDecoration = createLineDecoration(0);
        this.state.fileDecorations.set(filePath, zeroDecoration);
        return zeroDecoration;
      }

      if (stat.size > this.state.config.sizeLimit) {
        const estimatedLineCount = Math.floor(stat.size / this.state.config.estimationFactor);
        this.state.lineCountCache.set(filePath, estimatedLineCount);
        const estimatedDecoration = createLineDecoration(estimatedLineCount, true);
        this.state.fileDecorations.set(filePath, estimatedDecoration);
        return estimatedDecoration;
      }

      let lineCountPromise = this.processingQueue.get(filePath);

      if (!lineCountPromise) {
        lineCountPromise = this.limiter.run(() => countLines(filePath, this.state, stat))
          .then((lineCount) => {
            this.processingQueue.delete(filePath);
            return lineCount;
          })
          .catch((error) => {
            this.processingQueue.delete(filePath);
            console.error(`LineSight: Failed to count lines for ${filePath}:`, error);
            return 0;
          });

        this.processingQueue.set(filePath, lineCountPromise);
      }

      const lineCount = await lineCountPromise;

      if (lineCount <= 0) {
        this.state.fileDecorations.delete(filePath);
        return undefined;
      }

      // Guard against stale counts: if the file was invalidated while
      // counting (e.g. by a file-watcher refresh), the metadata will
      // have been cleared or updated.  Drop the result so the next
      // provideFileDecoration call re-counts from scratch.
      const currentMeta = this.state.fileMetadataCache.get(filePath);
      if (!currentMeta || currentMeta.size !== stat.size || currentMeta.mtimeMs !== stat.mtimeMs) {
        return undefined;
      }

      this.state.lineCountCache.set(filePath, lineCount);
      const decoration = createLineDecoration(lineCount);
      this.state.fileDecorations.set(filePath, decoration);
      return decoration;
    } catch {
      return undefined;
    }
  }

  /**
   * Queue a decoration refresh.  Pass specific URIs for targeted updates,
   * or call with no arguments to trigger a full (undefined) fire.
   * Stale cache entries are purged immediately so the next provideFileDecoration re-counts.
   */
  refresh(resources?: vscode.Uri | vscode.Uri[]): void {
    if (resources === undefined) {
      this.fullRefreshPending = true;
      this.pendingUpdates.clear();
    } else if (Array.isArray(resources)) {
      for (const uri of resources) {
        this.pendingUpdates.add(uri.fsPath);
        this.processingQueue.delete(uri.fsPath);
        this.state.lineCountCache.delete(uri.fsPath);
        this.state.fileDecorations.delete(uri.fsPath);
        this.state.fileMetadataCache.delete(uri.fsPath);
      }
    } else {
      this.pendingUpdates.add(resources.fsPath);
      this.processingQueue.delete(resources.fsPath);
      this.state.lineCountCache.delete(resources.fsPath);
      this.state.fileDecorations.delete(resources.fsPath);
      this.state.fileMetadataCache.delete(resources.fsPath);
    }

    // If too many individual paths queue up, coalesce into a single full refresh.
    if (!this.fullRefreshPending && this.pendingUpdates.size > PENDING_UPDATES_CAP) {
      this.fullRefreshPending = true;
      this.pendingUpdates.clear();
    }

    clearTrackedTimer(this.refreshTimer);

    const delayMs = this.state.isInitializing ? Math.max(100, this.state.config.debounceDelay) : this.state.config.debounceDelay;
    this.refreshTimer = scheduleTimeout(() => {
      this.flushUpdates();
    }, delayMs);
  }

  /**
   * Update decoration from an in-memory line count (e.g. editor buffer).
   * Writes directly to caches and schedules a debounced notification
   * without invalidating — avoids disk I/O for unsaved changes.
   * The disk-based count is reconciled on the next save or watcher event.
   */
  updateFromBuffer(uri: vscode.Uri, lineCount: number): void {
    const filePath = uri.fsPath;
    if (lineCount <= 0) {
      return;
    }
    this.state.lineCountCache.set(filePath, lineCount);
    const decoration = createLineDecoration(lineCount);
    this.state.fileDecorations.set(filePath, decoration);

    this.pendingUpdates.add(filePath);
    clearTrackedTimer(this.refreshTimer);
    this.refreshTimer = scheduleTimeout(() => {
      this.flushUpdates();
    }, this.state.config.debounceDelay);
  }

  dispose(): void {
    clearTrackedTimer(this.refreshTimer);
    this.refreshTimer = undefined;
    this.pendingUpdates.clear();
    this.processingQueue.clear();
    this._onDidChangeFileDecorations.dispose();
  }

  /** Emit queued decoration changes to VS Code in a single batch. */
  private flushUpdates(): void {
    if (this.fullRefreshPending) {
      this.fullRefreshPending = false;
      this.pendingUpdates.clear();
      this._onDidChangeFileDecorations.fire(undefined);
      return;
    }

    if (this.pendingUpdates.size === 0) {
      return;
    }

    const updates: vscode.Uri[] = [];
    this.pendingUpdates.forEach((fsPath) => {
      updates.push(vscode.Uri.file(fsPath));
    });

    this.pendingUpdates.clear();
    this._onDidChangeFileDecorations.fire(updates);
  }
}
