/**
 * Path-level filtering logic.
 *
 * Decides whether a given file should be ignored (excluded folder, binary
 * extension, or extension not in the allow-list).  All functions accept an
 * explicit `LineSightConfig` so they stay pure and testable.
 */

import * as path from 'path';
import { LineSightConfig } from './types';
import { BINARY_EXTENSIONS } from './constants';
import { normalizeFolderPath } from './config';

/**
 * Return true if the file should be skipped — i.e. it lives inside an
 * excluded folder, has a binary extension, or isn't in the include list.
 */
export function shouldSkipPath(filePath: string, config: LineSightConfig): boolean {
  const normalizedPath = `/${filePath.replace(/\\/g, '/')}`;

  for (const folder of config.excludeFolders) {
    const normalizedFolder = normalizeFolderPath(folder);
    if (!normalizedFolder) {
      continue;
    }

    const folderPattern = `/${normalizedFolder}/`;
    const folderSuffix = `/${normalizedFolder}`;

    if (normalizedPath.includes(folderPattern) || normalizedPath.endsWith(folderSuffix)) {
      return true;
    }
  }

  const fileName = path.basename(filePath).toLowerCase();
  const ext = path.extname(fileName).toLowerCase();

  if (ext && BINARY_EXTENSIONS.has(ext)) {
    return true;
  }

  if (!ext) {
    return !config.includeFileNames.has(fileName);
  }

  return !config.includeExtensions.has(ext);
}

/** Build a VS Code glob pattern that excludes all configured folders (for `workspace.findFiles`). */
export function buildExcludeGlob(config: LineSightConfig): string | undefined {
  if (config.excludeFolders.length === 0) {
    return undefined;
  }

  const patterns = config.excludeFolders
    .map((folder) => normalizeFolderPath(folder))
    .filter(Boolean)
    .map((folder) => `**/${folder}/**`);

  if (patterns.length === 0) {
    return undefined;
  }

  return `{${patterns.join(',')}}`;
}
