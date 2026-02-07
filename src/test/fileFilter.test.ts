import * as assert from 'assert';
import { shouldSkipPath, buildExcludeGlob } from '../fileFilter';
import { LineSightConfig } from '../types';

function makeConfig(overrides: Partial<LineSightConfig> = {}): LineSightConfig {
  return {
    sizeLimit: 5_000_000,
    batchSize: 200,
    debounceDelay: 300,
    initialScanDelay: 2000,
    estimationFactor: 50,
    excludeFolders: ['node_modules', '.git'],
    includeExtensions: new Set(['.ts', '.js', '.py']),
    includeFileNames: new Set(['dockerfile', 'makefile']),
    showStartupNotifications: false,
    ...overrides,
  };
}

describe('shouldSkipPath', () => {
  it('skips files in excluded folders', () => {
    const config = makeConfig();
    assert.strictEqual(shouldSkipPath('/project/node_modules/foo.ts', config), true);
    assert.strictEqual(shouldSkipPath('/project/.git/config', config), true);
  });

  it('does not skip files in non-excluded folders', () => {
    const config = makeConfig();
    assert.strictEqual(shouldSkipPath('/project/src/index.ts', config), false);
  });

  it('skips binary extensions', () => {
    const config = makeConfig();
    assert.strictEqual(shouldSkipPath('/project/image.png', config), true);
    assert.strictEqual(shouldSkipPath('/project/file.exe', config), true);
  });

  it('skips files with non-included extensions', () => {
    const config = makeConfig();
    assert.strictEqual(shouldSkipPath('/project/data.csv', config), true);
  });

  it('includes files with included extensions', () => {
    const config = makeConfig();
    assert.strictEqual(shouldSkipPath('/project/main.py', config), false);
    assert.strictEqual(shouldSkipPath('/project/index.js', config), false);
  });

  it('includes known extensionless file names', () => {
    const config = makeConfig();
    assert.strictEqual(shouldSkipPath('/project/Dockerfile', config), false);
    assert.strictEqual(shouldSkipPath('/project/Makefile', config), false);
  });

  it('skips unknown extensionless files', () => {
    const config = makeConfig();
    assert.strictEqual(shouldSkipPath('/project/LICENSE', config), true);
  });

  it('handles Windows-style paths', () => {
    const config = makeConfig();
    assert.strictEqual(shouldSkipPath('C:\\project\\node_modules\\foo.ts', config), true);
    assert.strictEqual(shouldSkipPath('C:\\project\\src\\index.ts', config), false);
  });
});

describe('buildExcludeGlob', () => {
  it('returns undefined for empty excludeFolders', () => {
    const config = makeConfig({ excludeFolders: [] });
    assert.strictEqual(buildExcludeGlob(config), undefined);
  });

  it('builds glob from excludeFolders', () => {
    const config = makeConfig({ excludeFolders: ['node_modules', 'dist'] });
    const result = buildExcludeGlob(config);
    assert.strictEqual(result, '{**/node_modules/**,**/dist/**}');
  });

  it('normalizes folder paths in glob', () => {
    const config = makeConfig({ excludeFolders: ['/foo/bar/'] });
    const result = buildExcludeGlob(config);
    assert.strictEqual(result, '{**/foo/bar/**}');
  });
});
