/**
 * File system watcher integration.
 *
 * Watches every workspace folder for create / change / delete events and
 * funnels them through a debounced queue so rapid-fire saves don't flood
 * the decoration provider.  If a shorter delay arrives while a timer is
 * already running, the timer is restarted with the shorter delay.
 */

import * as vscode from 'vscode';
import { AppState } from './state';
import { LineCountDecorationProvider } from './decorationProvider';
import { shouldSkipPath } from './fileFilter';
import { scheduleTimeout, clearTrackedTimer } from './timer';

/** Flush all pending watcher updates to the decoration provider immediately. */
export function flushQueuedWatcherUpdates(state: AppState, provider: LineCountDecorationProvider): void {
  clearTrackedTimer(state.watcherQueueTimer);
  state.watcherQueueTimer = undefined;
  state.watcherQueueDelayMs = 0;

  if (state.pendingWatcherUpdates.size === 0) {
    return;
  }

  const updates = Array.from(state.pendingWatcherUpdates).map((filePath) => vscode.Uri.file(filePath));
  state.pendingWatcherUpdates.clear();
  provider.refresh(updates);
}

/**
 * Add a file to the pending-update queue and (re)start the debounce timer.
 * Multiple files accumulate in the queue and are flushed together, which
 * avoids per-file decoration refreshes during burst edits.
 */
/** When more unique files queue up than this, stop tracking individuals and do a full refresh. */
const WATCHER_QUEUE_CAP = 500;

export function queueUpdate(
  uri: vscode.Uri,
  state: AppState,
  provider: LineCountDecorationProvider,
  delay?: number,
): void {
  if (uri.scheme !== 'file') {
    return;
  }

  state.pendingWatcherUpdates.add(uri.fsPath);

  // If the queue grows too large, coalesce into a full refresh.
  if (state.pendingWatcherUpdates.size > WATCHER_QUEUE_CAP) {
    clearTrackedTimer(state.watcherQueueTimer);
    state.watcherQueueTimer = undefined;
    state.watcherQueueDelayMs = 0;
    state.pendingWatcherUpdates.clear();
    provider.refresh();
    return;
  }

  const normalizedDelay = Math.max(50, delay ?? state.config.debounceDelay);

  if (!state.watcherQueueTimer) {
    state.watcherQueueDelayMs = normalizedDelay;
    state.watcherQueueTimer = scheduleTimeout(() => {
      flushQueuedWatcherUpdates(state, provider);
    }, state.watcherQueueDelayMs);
    return;
  }

  if (normalizedDelay < state.watcherQueueDelayMs) {
    clearTrackedTimer(state.watcherQueueTimer);
    state.watcherQueueDelayMs = normalizedDelay;
    state.watcherQueueTimer = scheduleTimeout(() => {
      flushQueuedWatcherUpdates(state, provider);
    }, state.watcherQueueDelayMs);
  }
}

/**
 * Create file system watchers for every workspace folder.
 * Disposes any previous watcher first so re-calling is safe after
 * workspace-folder or configuration changes.
 */
export function setupFileWatcher(state: AppState, provider: LineCountDecorationProvider): void {
  if (state.fileWatcher) {
    state.fileWatcher.dispose();
    state.fileWatcher = undefined;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const watchers: vscode.Disposable[] = [];

  for (const folder of workspaceFolders) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '**/*'),
      false,
      false,
      false,
    );

    watcher.onDidCreate((uri: vscode.Uri) => {
      if (shouldSkipPath(uri.fsPath, state.config)) {
        return;
      }
      queueUpdate(uri, state, provider);
    });

    watcher.onDidChange((uri: vscode.Uri) => {
      if (shouldSkipPath(uri.fsPath, state.config)) {
        return;
      }
      queueUpdate(uri, state, provider, state.config.debounceDelay);
    });

    watcher.onDidDelete((uri: vscode.Uri) => {
      state.lineCountCache.delete(uri.fsPath);
      state.fileDecorations.delete(uri.fsPath);
      state.fileMetadataCache.delete(uri.fsPath);
      provider.refresh(uri);
    });

    watchers.push(watcher);
  }

  state.fileWatcher = vscode.Disposable.from(...watchers);
}
