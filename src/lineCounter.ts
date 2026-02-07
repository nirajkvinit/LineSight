/**
 * Line counting and display formatting.
 *
 * `countLinesWithReadStream` streams a file in 128 KB chunks and counts
 * newline characters.  A configurable read timeout (default 10 s) destroys
 * the stream if it stalls — this prevents the extension from hanging on
 * network-mounted or locked files.
 *
 * `countLines` is the higher-level wrapper that checks caches, skips binaries,
 * and falls back to byte-based estimation for oversized files.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BINARY_EXTENSIONS } from './constants';
import { AppState } from './state';

/**
 * Format a number for the explorer badge.
 *
 * VS Code silently drops FileDecoration badges longer than 2 characters,
 * so every tier must produce a 1–2 char string:
 *   1–99  →  "1" … "99"
 *   100–999  →  "1H" … "9H"  (H = hundreds: 1H ≈ 100s, 2H ≈ 200s, …)
 *   1 000–9 999  →  "1K" … "9K"
 *   10 000–999 999  →  "10K" … "999K" — but 3+ chars; use "XK" floored
 *   1 000 000+  →  "1M" …
 */
export function formatLineCount(count: number): string {
  if (count >= 1_000_000) {
    return `${Math.floor(count / 1_000_000)}M`;
  }

  if (count >= 1_000) {
    return `${Math.floor(count / 1_000)}K`;
  }

  if (count >= 100) {
    return `${Math.floor(count / 100)}H`;
  }

  return count.toString();
}

/** Create a VS Code FileDecoration badge + tooltip from a line count. */
export function createLineDecoration(lineCount: number, estimated = false): vscode.FileDecoration {
  const formattedCount = formatLineCount(lineCount);
  const badge = estimated ? `~${formattedCount}` : formattedCount;
  const tooltip = estimated
    ? `~${lineCount} lines (estimated)`
    : `${lineCount} lines`;

  return new vscode.FileDecoration(badge, tooltip);
}

/**
 * Count newline characters in a file using a read stream.
 *
 * A `settled` flag guards against double-resolution: whichever of end /
 * error / timeout fires first wins, and the stream is destroyed on timeout
 * so the file handle is released promptly.
 */
export async function countLinesWithReadStream(filePath: string, timeoutMs = 10000): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const readStream = fs.createReadStream(filePath, {
      encoding: 'utf8',
      highWaterMark: 128 * 1024, // 128 KB chunks balance syscall overhead vs memory
    });

    // Abort hung reads (e.g. network mounts, locked files) after timeoutMs.
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        readStream.destroy();
        reject(new Error(`Read timeout after ${timeoutMs}ms for ${filePath}`));
      }
    }, timeoutMs);

    let lineCount = 0;
    let sawAnyContent = false;
    let lastCharWasNewline = true;

    readStream.on('data', (chunk: string | Buffer) => {
      const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (data.length > 0) {
        sawAnyContent = true;
      }

      for (let i = 0; i < data.length; i++) {
        if (data[i] === '\n') {
          lineCount++;
          lastCharWasNewline = true;
        } else {
          lastCharWasNewline = false;
        }
      }
    });

    readStream.on('end', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (sawAnyContent && !lastCharWasNewline) {
          lineCount++;
        }
        resolve(lineCount);
      }
    });

    readStream.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

/**
 * High-level line counter: checks file metadata, skips binaries, estimates
 * oversized files, and falls back to a streaming count.  On error the
 * relevant caches are purged so the next request retries from scratch.
 */
export async function countLines(filePath: string, state: AppState, stats?: fs.Stats): Promise<number> {
  try {
    const fileStats = stats ?? await fs.promises.stat(filePath);

    if (!fileStats.isFile()) {
      return 0;
    }

    state.fileMetadataCache.set(filePath, {
      size: fileStats.size,
      mtimeMs: fileStats.mtimeMs,
    });

    const ext = path.extname(filePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return 0;
    }

    if (fileStats.size > state.config.sizeLimit) {
      return Math.floor(fileStats.size / state.config.estimationFactor);
    }

    return await countLinesWithReadStream(filePath);
  } catch (error) {
    state.lineCountCache.delete(filePath);
    state.fileDecorations.delete(filePath);
    state.fileMetadataCache.delete(filePath);
    console.error(`LineSight: Error counting lines for ${filePath}:`, error);
    return 0;
  }
}
