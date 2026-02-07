import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { formatLineCount, countLinesWithReadStream } from '../lineCounter';

describe('formatLineCount', () => {
  it('formats millions', () => {
    assert.strictEqual(formatLineCount(1_000_000), '1M');
    assert.strictEqual(formatLineCount(2_500_000), '2M');
  });

  it('formats thousands', () => {
    assert.strictEqual(formatLineCount(1_000), '1K');
    assert.strictEqual(formatLineCount(9_999), '9K');
  });

  it('returns plain number under 1000', () => {
    assert.strictEqual(formatLineCount(0), '0');
    assert.strictEqual(formatLineCount(1), '1');
    assert.strictEqual(formatLineCount(999), '999');
  });
});

describe('countLinesWithReadStream', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linesight-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('counts lines in a simple file', async () => {
    const filePath = path.join(tmpDir, 'simple.txt');
    fs.writeFileSync(filePath, 'line1\nline2\nline3\n');
    const count = await countLinesWithReadStream(filePath);
    assert.strictEqual(count, 3);
  });

  it('counts last line without trailing newline', async () => {
    const filePath = path.join(tmpDir, 'no-trailing.txt');
    fs.writeFileSync(filePath, 'line1\nline2');
    const count = await countLinesWithReadStream(filePath);
    assert.strictEqual(count, 2);
  });

  it('returns 0 for an empty file', async () => {
    const filePath = path.join(tmpDir, 'empty.txt');
    fs.writeFileSync(filePath, '');
    const count = await countLinesWithReadStream(filePath);
    assert.strictEqual(count, 0);
  });

  it('counts a single line without newline', async () => {
    const filePath = path.join(tmpDir, 'single.txt');
    fs.writeFileSync(filePath, 'hello');
    const count = await countLinesWithReadStream(filePath);
    assert.strictEqual(count, 1);
  });

  it('counts a single line with trailing newline', async () => {
    const filePath = path.join(tmpDir, 'single-nl.txt');
    fs.writeFileSync(filePath, 'hello\n');
    const count = await countLinesWithReadStream(filePath);
    assert.strictEqual(count, 1);
  });

  it('rejects on missing file', async () => {
    const filePath = path.join(tmpDir, 'nonexistent.txt');
    await assert.rejects(() => countLinesWithReadStream(filePath));
  });
});
