import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface FileCacheMetadata {
  size: number;
  mtimeMs: number;
}

interface LineSightConfig {
  sizeLimit: number;
  batchSize: number;
  debounceDelay: number;
  initialScanDelay: number;
  estimationFactor: number;
  excludeFolders: string[];
  includeExtensions: Set<string>;
  includeFileNames: Set<string>;
  showStartupNotifications: boolean;
}

// Store line counts to avoid recounting
const lineCountCache = new Map<string, number>();
// Store decorations to avoid recreating objects repeatedly
const fileDecorations = new Map<string, vscode.FileDecoration>();
// Store stat metadata for cache invalidation
const fileMetadataCache = new Map<string, FileCacheMetadata>();

let fileWatcher: vscode.Disposable | undefined;
let isInitializing = false;
let initializationRunId = 0;
let initializationPromise: Promise<void> | undefined;

// Track timers so they can be cleaned up on deactivate
const activeTimers = new Set<NodeJS.Timeout>();

// Queue state for watcher/document driven updates
const pendingWatcherUpdates = new Set<string>();
let watcherQueueTimer: NodeJS.Timeout | undefined;
let watcherQueueDelayMs = 0;

const DEFAULT_EXCLUDED_FOLDERS = [
  'node_modules', '.git', 'dist', 'build', 'out', 'bin', 'obj',
  '.vscode', '.idea', '.vs', 'vendor', 'coverage', '.next', '.nuxt',
  'public/assets', 'static/assets', 'target', '.sass-cache', '.cache'
];

const BINARY_EXTENSIONS = new Set([
  '.exe', '.dll', '.obj', '.bin', '.jpg', '.jpeg', '.png', '.gif',
  '.mp3', '.mp4', '.zip', '.gz', '.tar', '.pdf', '.class', '.pyc',
  '.pyd', '.so', '.dylib', '.o', '.a', '.lib', '.woff', '.woff2',
  '.ttf', '.eot', '.svg', '.ico', '.bmp', '.tiff', '.webp'
]);

const DEFAULT_INCLUDED_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.scss', '.less', '.vue', '.svelte',
  '.go', '.py', '.java', '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.cs', '.php', '.rb',
  '.rs', '.kt', '.swift', '.sh', '.bash', '.zsh', '.sql', '.prisma', '.graphql', '.gql',
  '.json', '.yaml', '.yml', '.xml', '.toml', '.ini', '.md', '.txt'
]);

const DEFAULT_INCLUDED_FILE_NAMES = new Set([
  'dockerfile',
  'makefile',
  '.env',
  '.gitignore',
  '.gitattributes',
  '.npmrc',
  '.editorconfig'
]);

const DEFAULT_CONFIG = {
  sizeLimit: 5_000_000,
  batchSize: 200,
  debounceDelay: 300,
  initialScanDelay: 2_000,
  estimationFactor: 50,
  showStartupNotifications: false,
};

let currentConfig: LineSightConfig = loadConfiguration();

function scheduleTimeout(callback: () => void, delayMs: number): NodeJS.Timeout {
  const safeDelay = Math.max(0, delayMs);
  const timer = setTimeout(() => {
    activeTimers.delete(timer);
    callback();
  }, safeDelay);
  activeTimers.add(timer);
  return timer;
}

function clearTrackedTimer(timer: NodeJS.Timeout | undefined): void {
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  activeTimers.delete(timer);
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    scheduleTimeout(resolve, delayMs);
  });
}

function clearAllTrackedTimers(): void {
  for (const timer of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.clear();
  watcherQueueTimer = undefined;
}

function toPositiveInteger(value: number | undefined, fallback: number, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(value));
}

function normalizeFolderPath(folder: string): string {
  return folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function normalizeExtension(ext: string): string | undefined {
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

function loadConfiguration(): LineSightConfig {
  const cfg = vscode.workspace.getConfiguration('linesight');

  const configuredExcludes = cfg
    .get<string[]>('excludeFolders', [])
    .map(normalizeFolderPath)
    .filter(Boolean);

  const excludeFolders = Array.from(new Set([
    ...DEFAULT_EXCLUDED_FOLDERS.map(normalizeFolderPath),
    ...configuredExcludes,
  ]));

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

function updateConfiguration(): void {
  currentConfig = loadConfiguration();
}

function clearAllCaches(): void {
  lineCountCache.clear();
  fileDecorations.clear();
  fileMetadataCache.clear();
}

function shouldSkipPath(filePath: string): boolean {
  const normalizedPath = `/${filePath.replace(/\\/g, '/')}`;

  for (const folder of currentConfig.excludeFolders) {
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
    return !currentConfig.includeFileNames.has(fileName);
  }

  return !currentConfig.includeExtensions.has(ext);
}

// More efficient line counting using read stream instead of loading entire file
async function countLinesWithReadStream(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(filePath, {
      encoding: 'utf8',
      highWaterMark: 128 * 1024,
    });

    let lineCount = 0;
    let sawAnyContent = false;
    let lastCharWasNewline = true;

    readStream.on('data', (chunk: string) => {
      if (chunk.length > 0) {
        sawAnyContent = true;
      }

      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === '\n') {
          lineCount++;
          lastCharWasNewline = true;
        } else {
          lastCharWasNewline = false;
        }
      }
    });

    readStream.on('end', () => {
      if (sawAnyContent && !lastCharWasNewline) {
        lineCount++;
      }
      resolve(lineCount);
    });

    readStream.on('error', (err) => {
      reject(err);
    });
  });
}

// Function to count lines in a file
async function countLines(filePath: string, stats?: fs.Stats): Promise<number> {
  try {
    const fileStats = stats ?? await fs.promises.stat(filePath);

    if (!fileStats.isFile()) {
      return 0;
    }

    fileMetadataCache.set(filePath, {
      size: fileStats.size,
      mtimeMs: fileStats.mtimeMs,
    });

    const ext = path.extname(filePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return 0;
    }

    if (fileStats.size > currentConfig.sizeLimit) {
      return Math.floor(fileStats.size / currentConfig.estimationFactor);
    }

    return await countLinesWithReadStream(filePath);
  } catch (error) {
    lineCountCache.delete(filePath);
    fileDecorations.delete(filePath);
    fileMetadataCache.delete(filePath);
    console.error(`LineSight: Error counting lines for ${filePath}:`, error);
    return 0;
  }
}

// Format line count for display
function formatLineCount(count: number): string {
  if (count >= 1_000_000) {
    return `${Math.floor(count / 1_000_000)}M`;
  }

  if (count >= 1_000) {
    return `${Math.floor(count / 1_000)}K`;
  }

  return count.toString();
}

function createLineDecoration(lineCount: number, estimated = false): vscode.FileDecoration {
  const formattedCount = formatLineCount(lineCount);
  const badge = estimated ? `~${formattedCount}` : formattedCount;
  const tooltip = estimated
    ? `~${lineCount} lines (estimated)`
    : `${lineCount} lines`;

  return new vscode.FileDecoration(badge, tooltip);
}

function buildExcludeGlob(): string | undefined {
  if (currentConfig.excludeFolders.length === 0) {
    return undefined;
  }

  const patterns = currentConfig.excludeFolders
    .map((folder) => normalizeFolderPath(folder))
    .filter(Boolean)
    .map((folder) => `**/${folder}/**`);

  if (patterns.length === 0) {
    return undefined;
  }

  return `{${patterns.join(',')}}`;
}

function cancelInitialization(): void {
  initializationRunId++;
  isInitializing = false;
  initializationPromise = undefined;
}

async function processBatchesWithDelay(
  files: vscode.Uri[],
  provider: LineCountDecorationProvider,
  batchSize: number,
  delayMs: number,
  runId: number,
): Promise<void> {
  for (let i = 0; i < files.length; i += batchSize) {
    if (runId !== initializationRunId) {
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

// Initialize decorations for all visible files
async function initializeDecorations(
  provider: LineCountDecorationProvider,
  options: { force?: boolean } = {},
): Promise<void> {
  if (options.force) {
    cancelInitialization();
  } else if (isInitializing) {
    return initializationPromise ?? Promise.resolve();
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const runId = ++initializationRunId;
  isInitializing = true;

  if (currentConfig.showStartupNotifications) {
    vscode.window.setStatusBarMessage('LineSight: Initializing line counts...', 1500);
  }

  initializationPromise = (async () => {
    try {
      await wait(currentConfig.initialScanDelay);

      if (runId !== initializationRunId) {
        return;
      }

      const excludeGlob = buildExcludeGlob();

      for (const folder of workspaceFolders) {
        if (runId !== initializationRunId) {
          return;
        }

        const allFiles = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, '**/*'),
          excludeGlob,
          6000,
        );

        const candidateFiles = allFiles.filter((uri) =>
          uri.scheme === 'file' && !shouldSkipPath(uri.fsPath)
        );

        await processBatchesWithDelay(candidateFiles, provider, currentConfig.batchSize, 60, runId);
      }

      if (runId === initializationRunId) {
        provider.refresh();
        vscode.window.setStatusBarMessage('LineSight: Ready', 1200);
      }
    } catch (error) {
      console.error('LineSight: Initialization failed:', error);
    } finally {
      if (runId === initializationRunId) {
        isInitializing = false;
        initializationPromise = undefined;
      }
    }
  })();

  return initializationPromise;
}

// Main file decorator provider
class LineCountDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private processingQueue = new Map<string, Promise<number>>();
  private pendingUpdates = new Set<string>();
  private refreshTimer: NodeJS.Timeout | undefined;
  private fullRefreshPending = false;

  async provideFileDecoration(uri: vscode.Uri): Promise<vscode.FileDecoration | undefined> {
    try {
      if (uri.scheme !== 'file') {
        return undefined;
      }

      const filePath = uri.fsPath;

      if (shouldSkipPath(filePath)) {
        return undefined;
      }

      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        return undefined;
      }

      const cachedMetadata = fileMetadataCache.get(filePath);
      const cachedCount = lineCountCache.get(filePath);

      if (
        cachedMetadata &&
        cachedCount !== undefined &&
        cachedMetadata.size === stat.size &&
        cachedMetadata.mtimeMs === stat.mtimeMs
      ) {
        const cachedDecoration = fileDecorations.get(filePath) ?? createLineDecoration(cachedCount, stat.size > currentConfig.sizeLimit);
        fileDecorations.set(filePath, cachedDecoration);
        return cachedDecoration;
      }

      fileMetadataCache.set(filePath, {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });

      if (stat.size === 0) {
        lineCountCache.set(filePath, 0);
        const zeroDecoration = createLineDecoration(0);
        fileDecorations.set(filePath, zeroDecoration);
        return zeroDecoration;
      }

      if (stat.size > currentConfig.sizeLimit) {
        const estimatedLineCount = Math.floor(stat.size / currentConfig.estimationFactor);
        lineCountCache.set(filePath, estimatedLineCount);
        const estimatedDecoration = createLineDecoration(estimatedLineCount, true);
        fileDecorations.set(filePath, estimatedDecoration);
        return estimatedDecoration;
      }

      let lineCountPromise = this.processingQueue.get(filePath);

      if (!lineCountPromise) {
        lineCountPromise = countLines(filePath, stat)
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
        fileDecorations.delete(filePath);
        return undefined;
      }

      lineCountCache.set(filePath, lineCount);
      const decoration = createLineDecoration(lineCount);
      fileDecorations.set(filePath, decoration);
      return decoration;
    } catch {
      return undefined;
    }
  }

  refresh(resources?: vscode.Uri | vscode.Uri[]) {
    if (resources === undefined) {
      this.fullRefreshPending = true;
      this.pendingUpdates.clear();
    } else if (Array.isArray(resources)) {
      for (const uri of resources) {
        this.pendingUpdates.add(uri.fsPath);
        lineCountCache.delete(uri.fsPath);
        fileDecorations.delete(uri.fsPath);
        fileMetadataCache.delete(uri.fsPath);
      }
    } else {
      this.pendingUpdates.add(resources.fsPath);
      lineCountCache.delete(resources.fsPath);
      fileDecorations.delete(resources.fsPath);
      fileMetadataCache.delete(resources.fsPath);
    }

    clearTrackedTimer(this.refreshTimer);

    const delayMs = isInitializing ? Math.max(100, currentConfig.debounceDelay) : currentConfig.debounceDelay;
    this.refreshTimer = scheduleTimeout(() => {
      this.flushUpdates();
    }, delayMs);
  }

  dispose(): void {
    clearTrackedTimer(this.refreshTimer);
    this.refreshTimer = undefined;
    this.pendingUpdates.clear();
    this.processingQueue.clear();
    this._onDidChangeFileDecorations.dispose();
  }

  private flushUpdates() {
    if (this.fullRefreshPending) {
      this.fullRefreshPending = false;
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

function flushQueuedWatcherUpdates(provider: LineCountDecorationProvider): void {
  clearTrackedTimer(watcherQueueTimer);
  watcherQueueTimer = undefined;
  watcherQueueDelayMs = 0;

  if (pendingWatcherUpdates.size === 0) {
    return;
  }

  const updates = Array.from(pendingWatcherUpdates).map((filePath) => vscode.Uri.file(filePath));
  pendingWatcherUpdates.clear();
  provider.refresh(updates);
}

// Helper function to queue updates with debouncing without losing previous files
function queueUpdate(
  uri: vscode.Uri,
  provider: LineCountDecorationProvider,
  delay: number = currentConfig.debounceDelay,
): void {
  if (uri.scheme !== 'file') {
    return;
  }

  pendingWatcherUpdates.add(uri.fsPath);

  const normalizedDelay = Math.max(50, delay);

  if (!watcherQueueTimer) {
    watcherQueueDelayMs = normalizedDelay;
    watcherQueueTimer = scheduleTimeout(() => {
      flushQueuedWatcherUpdates(provider);
    }, watcherQueueDelayMs);
    return;
  }

  if (normalizedDelay < watcherQueueDelayMs) {
    clearTrackedTimer(watcherQueueTimer);
    watcherQueueDelayMs = normalizedDelay;
    watcherQueueTimer = scheduleTimeout(() => {
      flushQueuedWatcherUpdates(provider);
    }, watcherQueueDelayMs);
  }
}

// Set up file system watcher to track changes
function setupFileWatcher(provider: LineCountDecorationProvider): void {
  if (fileWatcher) {
    fileWatcher.dispose();
    fileWatcher = undefined;
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
      if (shouldSkipPath(uri.fsPath)) {
        return;
      }
      queueUpdate(uri, provider);
    });

    watcher.onDidChange((uri: vscode.Uri) => {
      if (shouldSkipPath(uri.fsPath)) {
        return;
      }
      queueUpdate(uri, provider, currentConfig.debounceDelay);
    });

    watcher.onDidDelete((uri: vscode.Uri) => {
      lineCountCache.delete(uri.fsPath);
      fileDecorations.delete(uri.fsPath);
      fileMetadataCache.delete(uri.fsPath);
      provider.refresh(uri);
    });

    watchers.push(watcher);
  }

  fileWatcher = vscode.Disposable.from(...watchers);
}

export function activate(context: vscode.ExtensionContext): void {
  updateConfiguration();

  const provider = new LineCountDecorationProvider();
  context.subscriptions.push(provider);
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(provider));

  setupFileWatcher(provider);
  void initializeDecorations(provider);

  const refreshCommand = vscode.commands.registerCommand('linesight.refresh', async () => {
    cancelInitialization();
    clearAllCaches();
    provider.refresh();
    await initializeDecorations(provider, { force: true });
  });

  context.subscriptions.push(refreshCommand);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      cancelInitialization();
      clearAllCaches();
      setupFileWatcher(provider);
      void initializeDecorations(provider, { force: true });
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('linesight')) {
        return;
      }

      updateConfiguration();
      cancelInitialization();
      clearAllCaches();
      setupFileWatcher(provider);
      provider.refresh();
      void initializeDecorations(provider, { force: true });
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const uri = event.document.uri;
      if (uri.scheme !== 'file' || shouldSkipPath(uri.fsPath)) {
        return;
      }
      queueUpdate(uri, provider, currentConfig.debounceDelay);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      const uri = document.uri;
      if (uri.scheme !== 'file' || shouldSkipPath(uri.fsPath)) {
        return;
      }
      queueUpdate(uri, provider, 75);
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        const uri = editor.document.uri;
        if (uri.scheme !== 'file' || shouldSkipPath(uri.fsPath)) {
          continue;
        }
        queueUpdate(uri, provider, 100);
      }
    }),
  );
}

export function deactivate(): void {
  cancelInitialization();
  clearAllCaches();

  pendingWatcherUpdates.clear();
  clearTrackedTimer(watcherQueueTimer);
  watcherQueueTimer = undefined;

  clearAllTrackedTimers();

  if (fileWatcher) {
    fileWatcher.dispose();
    fileWatcher = undefined;
  }
}
