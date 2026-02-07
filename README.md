# LineSight

[![CI](https://github.com/nirajkvinit/LineSight/actions/workflows/ci.yml/badge.svg)](https://github.com/nirajkvinit/LineSight/actions/workflows/ci.yml)

A VS Code extension that displays line counts next to files in the explorer sidebar.

Large files are a common friction point when working with LLMs — context windows have limits, and even modern IDEs with smart chunking perform better on smaller files. LineSight gives you an at-a-glance view of file sizes so you know when something needs to be broken up.

<img src="resources/images/logo.png" width="100" height="100" alt="LineSight Logo">

## Install

**From the Marketplace** — search for "LineSight" in the VS Code extensions panel, or install directly:

https://marketplace.cursorapi.com/items?itemName=2048Labs.linesight

**From source:**

```sh
git clone https://github.com/karansinghgit/LineSight.git
cd LineSight
npm install
npm run build
npx @vscode/vsce package --no-dependencies
```

This produces a `.vsix` file. Install it in VS Code:

```
code --install-extension linesight-*.vsix
```

Or open VS Code, go to Extensions > `...` menu > "Install from VSIX..." and select the file.

## Screenshot

![LineSight in action](resources/images/screenshot.png)

## Features

- **Line count badges** in the explorer next to every tracked file
- **Live updates** as you type — uses the in-memory editor buffer, zero disk I/O
- **Abbreviated display** — `42`, `3H`, `2K`, `1M` as badges, exact counts in tooltips
- **Refresh command** — manual refresh button in the explorer title bar
- **Configurable** — control size limits, debounce timing, file types, excluded folders
- **Workspace trust aware** — defers file scanning in untrusted workspaces

## How It Works

LineSight registers a `FileDecorationProvider` that VS Code queries whenever it renders a file in the explorer. On activation, it walks the workspace in batches, streams each file to count newlines, and caches the result. From there:

- **Edits** update the count from the in-memory buffer (no disk read)
- **Saves** trigger a disk-based recount
- **File system changes** (create, rename, delete) are picked up by a watcher and debounced

Performance is managed through bounded LRU caches, a concurrency limiter on parallel file reads, stream timeouts for hung files, and queue caps that trigger a full refresh under update storms.

## Configuration

All settings live under the `linesight.*` namespace.

| Setting | Default | Description |
|---|---|---|
| `sizeLimit` | `5000000` | Max file size (bytes) before switching to estimated counts |
| `batchSize` | `200` | Files per initialization batch |
| `debounceDelay` | `300` | Debounce delay (ms) for file change events |
| `initialScanDelay` | `2000` | Delay (ms) before initial workspace scan |
| `estimationFactor` | `50` | Bytes-per-line factor for large file estimates |
| `excludeFolders` | `[]` | Additional folders to skip (additive to built-in defaults) |
| `includeExtensions` | `[]` | File extensions to include (empty = built-in defaults) |
| `showStartupNotifications` | `false` | Show status bar messages during initialization |

**Built-in excluded folders:** node_modules, .git, dist, build, out, bin, obj, .vscode, .idea, .vs, vendor, coverage, .next, .nuxt, target, .sass-cache, .cache, and others.

**Built-in included extensions:** 60+ file types covering web (.js, .ts, .jsx, .tsx, .html, .css, .vue, .svelte), systems (.go, .rs, .c, .cpp, .java, .py, .rb), data (.json, .yaml, .xml, .sql, .graphql), and more.

## Architecture

The codebase is split into focused, cycle-free modules:

```
extension.ts          thin entry point — wires everything together
types.ts              shared TypeScript interfaces
constants.ts          built-in file extension and folder lists
config.ts             settings parsing and validation
cache.ts              bounded LRU cache (ES2015 Map insertion order)
concurrency.ts        promise-based concurrency limiter with FIFO queue
timer.ts              tracked timeouts with clean disposal
state.ts              central AppState threaded through all modules
fileFilter.ts         path/extension filtering logic
lineCounter.ts        stream-based line counting and formatting
decorationProvider.ts FileDecorationProvider with batched notifications
fileWatcher.ts        file system watching with debounced updates
initialization.ts     workspace scanning with batch processing
```

Tests live in `src/test/` with a lightweight VS Code mock that allows unit testing without the extension host.

## Development

```sh
npm install
npm run compile        # type-check with tsc
npm run build          # production bundle with esbuild
npm run watch          # esbuild watch mode for development
npm run lint           # eslint
npm run test:unit      # compile + mocha unit tests
npm test               # compile + lint + unit tests
```

## License

This extension is licensed under the MIT License. 
