// Minimal vscode mock for unit tests that run outside the VS Code extension host.
// Only the APIs actually touched by production modules are stubbed here.
// Test-specific helpers live under the `__test` namespace.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const noopDisposable = { dispose: () => {} };
const noopEvent = () => noopDisposable;

// ─── Command tracking ───────────────────────────────────────────────
const commandHandlers = new Map<string, AnyFn>();

// ─── findFiles tracking ─────────────────────────────────────────────
let findFilesCalled = false;

// ─── Config overrides (keep tests fast) ─────────────────────────────
const configOverrides: Record<string, unknown> = {
  initialScanDelay: 0,
  debounceDelay: 50,
};

// ─── Core API stubs ─────────────────────────────────────────────────
const workspace: Record<string, unknown> = {
  isTrusted: true,
  workspaceFolders: [{ uri: { fsPath: '/mock-workspace' }, name: 'mock', index: 0 }],
  getConfiguration: () => ({
    get: <T>(_key: string, defaultValue?: T): T | undefined => {
      if (_key in configOverrides) {
        return configOverrides[_key] as T;
      }
      return defaultValue;
    },
  }),
  findFiles: async () => {
    findFilesCalled = true;
    return [];
  },
  createFileSystemWatcher: () => ({
    onDidCreate: noopEvent,
    onDidChange: noopEvent,
    onDidDelete: noopEvent,
    dispose: () => {},
  }),
  onDidGrantWorkspaceTrust: noopEvent,
  onDidChangeWorkspaceFolders: noopEvent,
  onDidChangeConfiguration: noopEvent,
  onDidChangeTextDocument: noopEvent,
  onDidSaveTextDocument: noopEvent,
};

const vscodeWindow = {
  registerFileDecorationProvider: () => noopDisposable,
  onDidChangeVisibleTextEditors: noopEvent,
  setStatusBarMessage: () => noopDisposable,
};

const commands = {
  registerCommand: (id: string, handler: AnyFn) => {
    commandHandlers.set(id, handler);
    return noopDisposable;
  },
};

// ─── VS Code classes ────────────────────────────────────────────────
class EventEmitter {
  event = noopEvent;
  fire() {}
  dispose() {}
}

class FileDecoration {
  badge?: string;
  tooltip?: string;
  constructor(badge?: string, tooltip?: string) {
    this.badge = badge;
    this.tooltip = tooltip;
  }
}

class Disposable {
  static from(...disposables: { dispose: () => void }[]) {
    return { dispose: () => disposables.forEach((d) => d.dispose()) };
  }
  dispose() {}
}

class Uri {
  scheme: string;
  fsPath: string;
  private constructor(scheme: string, fsPath: string) {
    this.scheme = scheme;
    this.fsPath = fsPath;
  }
  static file(path: string): Uri {
    return new Uri('file', path);
  }
}

class RelativePattern {
  constructor(public base: unknown, public pattern: string) {}
}

// ─── Test helpers ───────────────────────────────────────────────────
const __test = {
  commandHandlers,
  get findFilesCalled() { return findFilesCalled; },
  set findFilesCalled(v: boolean) { findFilesCalled = v; },
  reset() {
    workspace.isTrusted = true;
    commandHandlers.clear();
    findFilesCalled = false;
  },
  createMockContext() {
    return { subscriptions: [] as { dispose: () => void }[] };
  },
};

module.exports = {
  workspace,
  window: vscodeWindow,
  commands,
  EventEmitter,
  FileDecoration,
  Disposable,
  Uri,
  RelativePattern,
  __test,
};
