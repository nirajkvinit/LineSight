/**
 * Extension entry point.
 *
 * This thin wrapper creates the shared `AppState`, wires the decoration
 * provider and file watcher together, and registers VS Code event handlers.
 * All real logic lives in the focused modules it imports.
 */

import * as vscode from 'vscode';
import { createAppState, clearAllCaches, updateConfiguration } from './state';
import { ConcurrencyLimiter } from './concurrency';
import { LineCountDecorationProvider } from './decorationProvider';
import { setupFileWatcher } from './fileWatcher';
import { queueUpdate } from './fileWatcher';
import { cancelInitialization, initializeDecorations } from './initialization';
import { shouldSkipPath } from './fileFilter';
import { clearTrackedTimer, clearAllTrackedTimers } from './timer';

/** Shared state lives at module scope so both activate() and deactivate() can reach it. */
const state = createAppState();

export function activate(context: vscode.ExtensionContext): void {
  updateConfiguration(state);

  // Cap concurrent file reads so we don't overwhelm the extension host.
  const limiter = new ConcurrencyLimiter(20);
  const provider = new LineCountDecorationProvider(state, limiter);

  context.subscriptions.push(provider);
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(provider));

  // Defer scanning/watching until the workspace is trusted.
  const startScanning = () => {
    setupFileWatcher(state, provider);
    void initializeDecorations(state, provider);
  };

  if (vscode.workspace.isTrusted) {
    startScanning();
  } else {
    context.subscriptions.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        startScanning();
      }),
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('linesight.refresh', async () => {
      if (!vscode.workspace.isTrusted) {
        return;
      }
      cancelInitialization(state);
      clearAllCaches(state);
      provider.refresh();
      await initializeDecorations(state, provider, { force: true });
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (!vscode.workspace.isTrusted) { return; }
      cancelInitialization(state);
      clearAllCaches(state);
      setupFileWatcher(state, provider);
      void initializeDecorations(state, provider, { force: true });
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('linesight')) {
        return;
      }
      updateConfiguration(state);
      if (!vscode.workspace.isTrusted) { return; }
      cancelInitialization(state);
      clearAllCaches(state);
      setupFileWatcher(state, provider);
      provider.refresh();
      void initializeDecorations(state, provider, { force: true });
    }),
  );

  // Live updates: edits use the in-memory buffer line count (no disk I/O).
  // Saves and editor visibility changes queue disk-based refreshes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const uri = event.document.uri;
      if (uri.scheme !== 'file' || shouldSkipPath(uri.fsPath, state.config)) {
        return;
      }
      provider.updateFromBuffer(uri, event.document.lineCount);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      const uri = document.uri;
      if (uri.scheme !== 'file' || shouldSkipPath(uri.fsPath, state.config)) {
        return;
      }
      queueUpdate(uri, state, provider, 75);
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        const uri = editor.document.uri;
        if (uri.scheme !== 'file' || shouldSkipPath(uri.fsPath, state.config)) {
          continue;
        }
        queueUpdate(uri, state, provider, 100);
      }
    }),
  );
}

export function deactivate(): void {
  cancelInitialization(state);
  clearAllCaches(state);

  state.pendingWatcherUpdates.clear();
  clearTrackedTimer(state.watcherQueueTimer);
  state.watcherQueueTimer = undefined;

  clearAllTrackedTimers();

  if (state.fileWatcher) {
    state.fileWatcher.dispose();
    state.fileWatcher = undefined;
  }
}
