import * as assert from 'assert';
import { toPositiveInteger, normalizeFolderPath, normalizeExtension } from '../config';

describe('toPositiveInteger', () => {
  it('returns the value when valid', () => {
    assert.strictEqual(toPositiveInteger(10, 5), 10);
  });

  it('returns fallback for undefined', () => {
    assert.strictEqual(toPositiveInteger(undefined, 5), 5);
  });

  it('returns fallback for NaN', () => {
    assert.strictEqual(toPositiveInteger(NaN, 5), 5);
  });

  it('returns fallback for Infinity', () => {
    assert.strictEqual(toPositiveInteger(Infinity, 5), 5);
  });

  it('floors fractional values', () => {
    assert.strictEqual(toPositiveInteger(3.9, 5), 3);
  });

  it('clamps to minimum', () => {
    assert.strictEqual(toPositiveInteger(0, 5), 1);
    assert.strictEqual(toPositiveInteger(-10, 5), 1);
  });

  it('uses custom minimum', () => {
    assert.strictEqual(toPositiveInteger(30, 100, 50), 50);
    assert.strictEqual(toPositiveInteger(100, 100, 50), 100);
  });
});

describe('normalizeFolderPath', () => {
  it('normalizes backslashes to forward slashes', () => {
    assert.strictEqual(normalizeFolderPath('foo\\bar\\baz'), 'foo/bar/baz');
  });

  it('strips leading and trailing slashes', () => {
    assert.strictEqual(normalizeFolderPath('/foo/bar/'), 'foo/bar');
    assert.strictEqual(normalizeFolderPath('///foo///'), 'foo');
  });

  it('handles simple folder names', () => {
    assert.strictEqual(normalizeFolderPath('node_modules'), 'node_modules');
  });

  it('returns empty string for root-like input', () => {
    assert.strictEqual(normalizeFolderPath('/'), '');
    assert.strictEqual(normalizeFolderPath(''), '');
  });

  it('accepts folder names containing spaces', () => {
    assert.strictEqual(normalizeFolderPath('Generated Files'), 'Generated Files');
  });

  it('accepts paths with spaces in segments', () => {
    assert.strictEqual(normalizeFolderPath('My Project/Generated Files'), 'My Project/Generated Files');
  });

  it('rejects glob metacharacters', () => {
    assert.strictEqual(normalizeFolderPath('foo*'), '');
    assert.strictEqual(normalizeFolderPath('foo?'), '');
    assert.strictEqual(normalizeFolderPath('{foo}'), '');
    assert.strictEqual(normalizeFolderPath('[foo]'), '');
  });
});

describe('normalizeExtension', () => {
  it('returns dotted extension as-is', () => {
    assert.strictEqual(normalizeExtension('.ts'), '.ts');
  });

  it('adds dot for bare extension', () => {
    assert.strictEqual(normalizeExtension('ts'), '.ts');
  });

  it('lowercases the extension', () => {
    assert.strictEqual(normalizeExtension('.TS'), '.ts');
    assert.strictEqual(normalizeExtension('PY'), '.py');
  });

  it('trims whitespace', () => {
    assert.strictEqual(normalizeExtension('  .js  '), '.js');
  });

  it('rejects empty strings', () => {
    assert.strictEqual(normalizeExtension(''), undefined);
    assert.strictEqual(normalizeExtension('   '), undefined);
  });

  it('rejects paths with slashes', () => {
    assert.strictEqual(normalizeExtension('foo/bar'), undefined);
    assert.strictEqual(normalizeExtension('foo\\bar'), undefined);
  });
});
