/**
 * Workspace initialization — the initial scan that decorates every visible file.
 *
 * Uses a monotonically increasing `runId` to detect stale runs: if a new
 * initialization is requested (e.g. after a config change) before the current
 * one finishes, the old run notices the ID mismatch and bails out early.
 *
 * Files are processed in batches with short delays between them so the
 * extension host stays responsive during large workspace scans.
 */

import * as vscode from 'vscode';
import { AppState } from './state';
import { LineCountDecorationProvider } from './decorationProvider';
import { shouldSkipPath } from './fileFilter';
import { buildExcludeGlob } from './fileFilter';
import { wait } from './timer';

/** Bump the run ID so any in-flight initialization loop will stop on its next iteration. */
export function cancelInitialization(state: AppState): void {
  state.initializationRunId++;
  state.isInitializing = false;
  state.initializationPromise = undefined;
}

/** Send files to the provider in chunks, yielding between batches to keep the UI responsive. */
async function processBatchesWithDelay(
  files: vscode.Uri[],
  provider: LineCountDecorationProvider,
  state: AppState,
  batchSize: number,
  delayMs: number,
  runId: number,
): Promise<void> {
  for (let i = 0; i < files.length; i += batchSize) {
    if (runId !== state.initializationRunId) {
      return;
    }

    const batch = files.slice(i, i + batchSize);
    provider.refresh(batch);

    if (i > 0 && i % 1000 === 0) {
      vscode.window.setStatusBarMessage(`LineSight: Processing files (${i}/${files.length})...`, 1500);
    }

    await wait(delayMs);
  }
}

/**
 * Scan all workspace folders, filter to countable files, and feed them to the
 * decoration provider in batches.  Pass `{ force: true }` to cancel any
 * running initialization first (used after config / folder changes).
 */
export async function initializeDecorations(
  state: AppState,
  provider: LineCountDecorationProvider,
  options: { force?: boolean } = {},
): Promise<void> {
  if (options.force) {
    cancelInitialization(state);
  } else if (state.isInitializing) {
    return state.initializationPromise ?? Promise.resolve();
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const runId = ++state.initializationRunId;
  state.isInitializing = true;

  if (state.config.showStartupNotifications) {
    vscode.window.setStatusBarMessage('LineSight: Initializing line counts...', 1500);
  }

  state.initializationPromise = (async () => {
    try {
      await wait(state.config.initialScanDelay);

      if (runId !== state.initializationRunId) {
        return;
      }

      const excludeGlob = buildExcludeGlob(state.config);

      for (const folder of workspaceFolders) {
        if (runId !== state.initializationRunId) {
          return;
        }

        const allFiles = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, '**/*'),
          excludeGlob,
          6000,
        );

        if (allFiles.length >= 6000) {
          console.warn(
            `LineSight: File discovery capped at 6,000 in "${folder.name}". Some files may only be decorated when visible in the explorer.`,
          );
        }

        const candidateFiles = allFiles.filter((uri) =>
          uri.scheme === 'file' && !shouldSkipPath(uri.fsPath, state.config)
        );

        await processBatchesWithDelay(candidateFiles, provider, state, state.config.batchSize, 60, runId);
      }

      if (runId === state.initializationRunId) {
        provider.refresh();
        vscode.window.setStatusBarMessage('LineSight: Ready', 1200);
      }
    } catch (error) {
      console.error('LineSight: Initialization failed:', error);
    } finally {
      if (runId === state.initializationRunId) {
        state.isInitializing = false;
        state.initializationPromise = undefined;
      }
    }
  })();

  return state.initializationPromise;
}
