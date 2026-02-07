/**
 * Centralised mutable state for the extension.
 *
 * A single `AppState` is created at activation and threaded through every
 * module.  This avoids module-level globals, makes dependencies explicit,
 * and keeps individual modules easy to test.
 *
 * All three caches use LRUCache (max 10 000 entries) to bound memory usage.
 */

import * as vscode from 'vscode';
import { FileCacheMetadata, LineSightConfig } from './types';
import { LRUCache } from './cache';
import { loadConfiguration } from './config';

export interface AppState {
  lineCountCache: LRUCache<string, number>;
  fileDecorations: LRUCache<string, vscode.FileDecoration>;
  fileMetadataCache: LRUCache<string, FileCacheMetadata>;
  config: LineSightConfig;
  fileWatcher: vscode.Disposable | undefined;
  isInitializing: boolean;
  initializationRunId: number;
  initializationPromise: Promise<void> | undefined;
  pendingWatcherUpdates: Set<string>;
  watcherQueueTimer: NodeJS.Timeout | undefined;
  watcherQueueDelayMs: number;
}

export function createAppState(): AppState {
  return {
    lineCountCache: new LRUCache<string, number>(10000),
    fileDecorations: new LRUCache<string, vscode.FileDecoration>(10000),
    fileMetadataCache: new LRUCache<string, FileCacheMetadata>(10000),
    config: loadConfiguration(),
    fileWatcher: undefined,
    isInitializing: false,
    initializationRunId: 0,
    initializationPromise: undefined,
    pendingWatcherUpdates: new Set<string>(),
    watcherQueueTimer: undefined,
    watcherQueueDelayMs: 0,
  };
}

export function clearAllCaches(state: AppState): void {
  state.lineCountCache.clear();
  state.fileDecorations.clear();
  state.fileMetadataCache.clear();
}

export function updateConfiguration(state: AppState): void {
  state.config = loadConfiguration();
}
