/**
 * Configuration helpers.
 *
 * Pure validation / normalization functions live here alongside
 * `loadConfiguration`, which reads from `vscode.workspace` settings.
 * The pure functions are safe to unit-test without a VS Code runtime.
 */

import * as vscode from 'vscode';
import { LineSightConfig } from './types';
import { DEFAULT_EXCLUDED_FOLDERS, DEFAULT_INCLUDED_EXTENSIONS, DEFAULT_INCLUDED_FILE_NAMES, DEFAULT_CONFIG } from './constants';

/** Coerce a possibly-undefined number to a positive integer, applying a floor and minimum. */
export function toPositiveInteger(value: number | undefined, fallback: number, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(value));
}

/** Characters allowed in folder path tokens: alphanumeric, _, -, ., space, / (after normalization). */
const SAFE_FOLDER_CHARS = /^[a-zA-Z0-9_\-. /]+$/;

/** Convert backslashes to forward slashes, strip leading/trailing slashes, and reject glob metacharacters. */
export function normalizeFolderPath(folder: string): string {
  const normalized = folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || !SAFE_FOLDER_CHARS.test(normalized)) {
    return '';
  }
  return normalized;
}

/** Normalize a user-supplied extension to lowercase dot-prefixed form, or return undefined if invalid. */
export function normalizeExtension(ext: string): string | undefined {
  const trimmed = ext.trim().toLowerCase();
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\')) {
    return undefined;
  }
  if (trimmed.startsWith('.')) {
    return trimmed;
  }
  if (/^[a-z0-9_+-]+$/i.test(trimmed)) {
    return `.${trimmed}`;
  }
  return undefined;
}

/**
 * Read the `linesight.*` settings from VS Code and merge them with built-in
 * defaults.  User-supplied extensions override the defaults entirely when
 * non-empty; excluded folders are additive (defaults + user extras).
 */
export function loadConfiguration(): LineSightConfig {
  const cfg = vscode.workspace.getConfiguration('linesight');

  // Merge user-configured excluded folders on top of the built-in defaults.
  const configuredExcludes = cfg
    .get<string[]>('excludeFolders', [])
    .map(normalizeFolderPath)
    .filter(Boolean);

  const excludeFolders = Array.from(new Set([
    ...DEFAULT_EXCLUDED_FOLDERS.map(normalizeFolderPath),
    ...configuredExcludes,
  ]));

  // If the user provides extensions, use them exclusively; otherwise fall back to defaults.
  const configuredExtensions = cfg.get<string[]>('includeExtensions', []);
  const includeExtensions = new Set<string>();

  for (const value of configuredExtensions) {
    const normalized = normalizeExtension(value);
    if (normalized) {
      includeExtensions.add(normalized);
    }
  }

  const effectiveExtensions = includeExtensions.size > 0
    ? includeExtensions
    : new Set(DEFAULT_INCLUDED_EXTENSIONS);

  return {
    sizeLimit: toPositiveInteger(cfg.get<number>('sizeLimit'), DEFAULT_CONFIG.sizeLimit),
    batchSize: toPositiveInteger(cfg.get<number>('batchSize'), DEFAULT_CONFIG.batchSize),
    debounceDelay: toPositiveInteger(cfg.get<number>('debounceDelay'), DEFAULT_CONFIG.debounceDelay, 50),
    initialScanDelay: toPositiveInteger(cfg.get<number>('initialScanDelay'), DEFAULT_CONFIG.initialScanDelay, 0),
    estimationFactor: toPositiveInteger(cfg.get<number>('estimationFactor'), DEFAULT_CONFIG.estimationFactor),
    excludeFolders,
    includeExtensions: effectiveExtensions,
    includeFileNames: new Set(DEFAULT_INCLUDED_FILE_NAMES),
    showStartupNotifications: cfg.get<boolean>('showStartupNotifications', DEFAULT_CONFIG.showStartupNotifications),
  };
}
