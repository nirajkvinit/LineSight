/** Folders skipped by default — common build output, dependency, and tooling directories. */
export const DEFAULT_EXCLUDED_FOLDERS = [
  'node_modules', '.git', 'dist', 'build', 'out', 'bin', 'obj',
  '.vscode', '.idea', '.vs', 'vendor', 'coverage', '.next', '.nuxt',
  'public/assets', 'static/assets', 'target', '.sass-cache', '.cache'
];

/** Extensions that represent non-text content — always skipped, never line-counted. */
export const BINARY_EXTENSIONS = new Set([
  '.exe', '.dll', '.obj', '.bin', '.jpg', '.jpeg', '.png', '.gif',
  '.mp3', '.mp4', '.zip', '.gz', '.tar', '.pdf', '.class', '.pyc',
  '.pyd', '.so', '.dylib', '.o', '.a', '.lib', '.woff', '.woff2',
  '.ttf', '.eot', '.svg', '.ico', '.bmp', '.tiff', '.webp'
]);

/** Source / text extensions counted when the user hasn't overridden `includeExtensions`. */
export const DEFAULT_INCLUDED_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.scss', '.less', '.vue', '.svelte',
  '.go', '.py', '.java', '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.cs', '.php', '.rb',
  '.rs', '.kt', '.swift', '.sh', '.bash', '.zsh', '.sql', '.prisma', '.graphql', '.gql',
  '.json', '.yaml', '.yml', '.xml', '.toml', '.ini', '.md', '.txt'
]);

/** Well-known extensionless filenames that should still be line-counted. */
export const DEFAULT_INCLUDED_FILE_NAMES = new Set([
  'dockerfile',
  'makefile',
  '.env',
  '.gitignore',
  '.gitattributes',
  '.npmrc',
  '.editorconfig'
]);

/** Numeric / boolean defaults used when VS Code settings are absent or invalid. */
export const DEFAULT_CONFIG = {
  sizeLimit: 5_000_000,
  batchSize: 200,
  debounceDelay: 300,
  initialScanDelay: 2_000,
  estimationFactor: 50,
  showStartupNotifications: false,
};
