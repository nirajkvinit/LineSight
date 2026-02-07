# Changelog

## v0.0.7 — Security Hardening (Unreleased)

### Security Fixes

#### Glob pattern injection via `excludeFolders` settings
- `normalizeFolderPath` now validates folder names against an allowlist of safe characters (`a-z`, `0-9`, `_`, `-`, `.`, `/`).
- Folder entries containing glob metacharacters (`*`, `?`, `{`, `}`, `[`, `]`, `,`, etc.) are silently rejected, preventing crafted workspace settings from manipulating exclude glob patterns.

#### Unbounded queue growth under high-churn workloads
- `pendingWatcherUpdates` (file watcher) and `pendingUpdates` (decoration provider) are now capped at 500 entries. When exceeded, individual tracking is abandoned in favor of a single full refresh — preventing sustained memory growth in pathological repos.
- `ConcurrencyLimiter` queue is now capped (default 500). New work is rejected when the queue is full; existing error handling absorbs the rejection gracefully.

#### Explicit workspace trust handling
- `package.json` now declares `capabilities.untrustedWorkspaces.supported: "limited"`.
- File scanning and watching are deferred until `vscode.workspace.isTrusted` is true. In untrusted workspaces, the extension registers for `onDidGrantWorkspaceTrust` and starts only when trust is granted.
- Configuration and workspace-folder change handlers are gated on trust.

---

## v0.0.6 — Refactoring, Reliability & Bug Fixes (Unreleased)

A structural overhaul of the LineSight codebase. This section serves as the single
source of truth for every issue discovered, every fix applied, and what
remains open.

---

### Issue Tracker

#### Round 1: First codebase review

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| R1-1 | CRITICAL | Shared `debounceTimer` race condition — two code paths mutate the same timer | **Fixed.** Provider owns `refreshTimer`; watcher owns `state.watcherQueueTimer`. |
| R1-2 | MEDIUM | Empty files return 1 line from `countLinesWithReadStream` | **Fixed.** `sawAnyContent` + `lastCharWasNewline` flags handle all edge cases. |
| R1-3 | HIGH | `isInitializing` flag blocks refresh command | **Fixed.** `initializeDecorations({ force: true })` cancels running init first. |
| R1-4 | MEDIUM | `isInitializing` stuck forever on unhandled rejection | **Fixed.** try/catch/finally with proper cleanup in `initializationPromise`. |
| R1-5 | HIGH | File change events silently ignored (watcher param `true`) | **Fixed.** `createFileSystemWatcher(pattern, false, false, false)`. |
| R1-6 | MEDIUM | Cross-platform path matching broken on Windows | **Fixed.** `shouldSkipPath` normalizes all paths to forward slashes. |
| R1-7 | HIGH | Module-level global state — untestable, tightly coupled | **Fixed.** `AppState` struct passed explicitly to all modules. |
| R1-8 | MEDIUM | Duplicated binary extension lists (19 vs 27 entries) | **Fixed.** Single `BINARY_EXTENSIONS` Set in `constants.ts`. |
| R1-9 | MEDIUM | Arrays recreated on every `shouldSkipPath` call | **Fixed.** Constants hoisted to module-level Sets. |
| R1-10 | MEDIUM | Dual `stat` calls per file (provider + countLines) | **Fixed.** `provideFileDecoration` passes its stat result into `countLines`. |
| R1-11 | LOW | EventEmitter never disposed | **Fixed.** `dispose()` on provider calls `_onDidChangeFileDecorations.dispose()`. |
| R1-12 | MEDIUM | "H" abbreviation for hundreds is non-standard | **Fixed.** Shows exact counts under 1000, K for thousands, M for millions. |
| R1-13 | CRITICAL | Zero test coverage | **Fixed.** 59 unit tests across 6 test files (see below). |
| R1-14 | HIGH | No user-configurable settings | **Fixed.** 8 settings in `contributes.configuration`. |
| R1-15 | HIGH | Intrusive `showInformationMessage` on every activation | **Fixed.** Uses `setStatusBarMessage` only, gated behind `showStartupNotifications`. |
| R1-16 | MEDIUM | No read timeout on file stream — hangs on FIFO/network mounts | **Fixed.** 10s timeout with `settled` flag and stream destruction. |
| R1-17 | MEDIUM | No cancellation support for initialization | **Fixed.** `initializationRunId` monotonic counter detects stale runs. |
| R1-18 | LOW | Symlink traversal (`stat` follows symlinks to FIFOs) | Open. Timeout limits blast radius but `stat` itself has no timeout. |
| R1-19 | MEDIUM | No CI/CD pipeline | Open. Tests exist but don't run automatically on PRs. |
| R1-20 | MEDIUM | Stream overhead for small files (ReadStream for every size) | Open. Low priority — current approach is correct, just suboptimal for <512KB. |

---

#### Round 2: Post-refactor review

Issues identified after the modularization refactor.

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| R2-1 | HIGH | Stale in-flight counts committed with fresh metadata — `processingQueue` race condition | **Fixed.** See fix details below. |
| R2-2 | HIGH | `ConcurrencyLimiter` deadlocks when task function throws synchronously | **Fixed.** See fix details below. |
| R2-3 | MEDIUM | `onDidChangeTextDocument` triggers pointless disk I/O on every keystroke | **Fixed.** See fix details below. |
| R2-4 | MEDIUM | `findFiles` silently truncates at 6,000 files per workspace folder | **Fixed.** See fix details below. |
| R2-5 | MEDIUM | `activeTimers` in `timer.ts` is the lone module-level global | Open. Works correctly but inconsistent with AppState pattern. |
| R2-6 | MEDIUM | File watcher `**/*` pattern is broad; excluded dirs still generate callbacks | Open. VS Code's watcher API doesn't support complex exclude globs; filtering in callbacks is the standard approach. |
| R2-7 | MEDIUM | Unbounded `stat()` calls bypass the concurrency limiter | Open. Only impacts network-mounted filesystems; local stats are ~0.1ms. |
| R2-8 | LOW | Redundant `updateConfiguration` call on activate | Open. Harmless — double-loads identical config. |
| R2-9 | LOW | Redundant double `cancelInitialization` in refresh command | Open. Defensive pattern — not worth removing. |
| R2-10 | LOW | Debounce is "first-event windowed" not trailing-edge | Open. Valid design choice for batch flushing. |
| R2-11 | LOW | Redundant double-normalization of exclude folders in hot paths | Open. Correct but wasteful. |
| R2-12 | LOW | `LRUCache.get()` can't distinguish stored `undefined` from miss | Open. Not a practical issue — cache value types are never `undefined`. |
| R2-13 | LOW | `FileDecoration.badge` limited to 2 chars; `~9K` and `999` are 3 | Open. Verify rendering for edge cases. |

---

### Fix Details

#### Fix 1: ConcurrencyLimiter sync throw deadlock (R2-2)

**Problem:** `run()` calls `this.running++` then `fn().then(...)`. If `fn`
throws synchronously before returning a Promise, the `.then()` handlers never
execute, so `running--` and `dequeue()` never run. With `maxConcurrent=1`
this permanently stalls all future tasks.

**Fix:** Wrapped `fn()` invocation in try/catch. On sync throw: decrement
`running`, call `dequeue()`, and reject the outer promise. Added a regression
test that verifies a sync-throwing task rejects cleanly without blocking the
queue.

**Files:** `src/concurrency.ts`, `src/test/concurrency.test.ts`

---

#### Fix 2: Stale in-flight counts race condition (R2-1)

**Problem:** `processingQueue` deduplicates by file path only. If a file
changes while an old count is in-flight:

1. `refresh()` clears caches but old promise stays in `processingQueue`
2. New `provideFileDecoration` reuses the stale promise
3. Stale count is written to caches under fresh metadata
4. Wrong badge persists until the next filesystem event

**Fix (three parts):**

1. `refresh()` now deletes `processingQueue` entries for invalidated files,
   so new requests create fresh counting promises instead of reusing stale ones.
2. After `await lineCountPromise`, a metadata guard compares the current
   `fileMetadataCache` entry against the `stat` captured at the start of
   `provideFileDecoration`. If they diverge (because `refresh()` cleared or
   updated the metadata), the stale result is silently dropped.
3. `flushUpdates()` clears `pendingUpdates` when firing a full refresh,
   preventing stale file-specific entries from re-firing after a full refresh
   already covers them.

**File:** `src/decorationProvider.ts`

---

#### Fix 3: `onDidChangeTextDocument` wasted disk I/O (R2-3)

**Problem:** Every keystroke triggered `queueUpdate` -> `refresh` -> cache
invalidation -> `provideFileDecoration` -> `fs.stat()` + stream read on the
**saved disk file**. The count never changed until save, so all this I/O was
wasted. On a large workspace, rapid typing caused unnecessary stat + read
operations every ~300ms.

**Fix:** Added `updateFromBuffer(uri, lineCount)` method to the decoration
provider. The `onDidChangeTextDocument` handler now calls it with
`event.document.lineCount` (VS Code's in-memory buffer count), which writes
directly to caches and schedules a debounced notification — zero disk I/O.
The disk-based count is reconciled on save via `onDidSaveTextDocument` and
the file watcher.

**Bonus:** Users now get live line count updates as they type, rather than
waiting for save.

**Files:** `src/decorationProvider.ts`, `src/extension.ts`

---

#### Fix 4: `findFiles` silent 6,000 cap (R2-4)

**Problem:** `findFiles(..., 6000)` imposes a hard per-folder limit with no
feedback. Large monorepos would silently have missing decorations for files
beyond the cap, with no indication to the user or developer.

**Fix:** Added `console.warn` when the result count reaches the cap, so the
behavior is at least observable in the developer console / output channel.

**File:** `src/initialization.ts`

---

### Structural Changes

#### Modular file structure

The monolithic 765-line `src/extension.ts` was split into 13 focused modules
with an explicit, cycle-free dependency graph:

```
types        constants       cache       concurrency     timer
  \            |               |
   \---> config <-+            |
          |       |            |
     fileFilter   |            |
          |       |            |
     lineCounter  |            |
          \       |            |
     state <------+------------+
          |
   decorationProvider <-- concurrency, fileFilter, lineCounter, timer
          |
   fileWatcher <-- fileFilter, timer
   initialization <-- fileFilter, timer
          |
   extension.ts (thin entry point, ~100 lines)
```

**Key design decisions:**

- **AppState as explicit parameter:** All mutable state lives in a single
  `AppState` object created at activation and threaded through every function.
  Makes data flow visible and modules testable without global setup/teardown.

- **Config as function parameter:** `shouldSkipPath` and `buildExcludeGlob`
  accept `LineSightConfig` explicitly. Tests pass hand-crafted config objects
  without touching VS Code settings.

- **Zero new runtime dependencies:** `LRUCache` and `ConcurrencyLimiter` are
  implemented in-house. Mocha is devDependencies-only.

#### Bounded caches via LRU eviction

Replaced the three unbounded `Map`s with `LRUCache<K, V>` (max 10,000
entries each). The implementation exploits ES2015 Map insertion order:
`get()` promotes by delete + re-insert; `has()` is a non-promoting peek.
Drop-in replacement — same `.get/.set/.delete/.has/.clear` API.

**File:** `src/cache.ts`, `src/state.ts`

#### Bounded concurrency for file reads

Introduced `ConcurrencyLimiter` — a promise-based concurrency gate with a
FIFO queue. The decoration provider wraps every `countLines` call in
`limiter.run(...)` with a cap of 20 concurrent reads.

**File:** `src/concurrency.ts`, `src/decorationProvider.ts`

#### Read timeout on file streams

Added a configurable `timeoutMs` parameter (default 10,000 ms) to
`countLinesWithReadStream`. A `settled` flag ensures whichever of end /
error / timeout fires first wins. On timeout the stream is destroyed
immediately so the file handle is released.

**File:** `src/lineCounter.ts`

#### User-configurable settings

Added 8 settings under `linesight.*` in `contributes.configuration`:
`sizeLimit`, `batchSize`, `debounceDelay`, `initialScanDelay`,
`estimationFactor`, `excludeFolders`, `includeExtensions`,
`showStartupNotifications`.

**File:** `package.json`, `src/config.ts`

---

### Test Coverage

59 unit tests across 6 test files, running outside the VS Code extension host
via a lightweight mock (`test/vscode-mock.ts`):

| File | What it tests |
|------|---------------|
| `test/cache.test.ts` | LRU eviction, recency promotion, peek, edge cases (capacity 0/1) |
| `test/concurrency.test.ts` | Parallel limits, queue ordering, error propagation, sync-throw handling |
| `test/config.test.ts` | `toPositiveInteger`, `normalizeFolderPath`, `normalizeExtension` |
| `test/fileFilter.test.ts` | `shouldSkipPath`, `buildExcludeGlob` with manual configs |
| `test/lineCounter.test.ts` | `formatLineCount`, `countLinesWithReadStream` (real temp files) |
| `test/timer.test.ts` | `scheduleTimeout`, `clearTrackedTimer`, `wait` |

**Test gaps (known):**
- `decorationProvider.ts` — most complex module, requires richer VS Code mock
- `fileWatcher.ts` — debouncing and watcher setup
- `initialization.ts` — batch processing and cancellation
- `countLines` wrapper — depends on AppState
- `countLinesWithReadStream` timeout path — needs FIFO or mock stream

---

### Open Items (not yet addressed)

| # | Severity | Item | Notes |
|---|----------|------|-------|
| R1-18 | LOW | Symlink traversal | `stat()` follows symlinks; timeout limits blast radius |
| R1-19 | MEDIUM | No CI/CD pipeline | Tests exist but need GitHub Actions |
| R1-20 | LOW | Stream overhead for small files | Correct but suboptimal |
| R2-5 | MEDIUM | `activeTimers` module-level global | Works correctly, inconsistent with AppState |
| R2-6 | MEDIUM | Broad file watcher pattern | VS Code API limitation |
| R2-7 | MEDIUM | Unbounded stat calls | Only impacts network filesystems |
| R2-10 | LOW | First-event-windowed debounce | Valid design choice |
| R2-11 | LOW | Double-normalization of exclude folders | Correct but redundant |
| R2-13 | LOW | Badge 2-char limit edge cases | Needs manual verification |

---

### How to verify

```bash
npm install          # picks up mocha + @types/mocha
npm run compile      # should produce zero errors
npm run lint         # should produce zero warnings/errors
npm run test:unit    # 59 mocha tests, all passing
npm test             # compile + lint + mocha in sequence
```

For manual verification: open a workspace in the VS Code extension
development host (`F5`), confirm line counts appear in the explorer, edit a
file and verify counts update live while typing, save and confirm the count
reconciles, and run the "Refresh Line Counts" command.
