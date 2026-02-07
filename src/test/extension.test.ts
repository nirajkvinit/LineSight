import * as assert from 'assert';

/* eslint-disable @typescript-eslint/no-require-imports */
// Dynamic require is necessary here: the vscode mock must be resolved at
// runtime through the setup.ts module-intercept, and the extension module
// must be loaded/unloaded per suite to reset module-scoped state.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const vscode = require('vscode');

describe('extension – workspace trust', function () {
  // Allow time for the async initialization path in the trusted test.
  this.timeout(5000);

  let deactivate: () => void;

  before(() => {
    vscode.__test.reset();
    vscode.workspace.isTrusted = false;
    vscode.__test.findFilesCalled = false;

    // Require extension module (creates module-scoped state).
    const ext = require('../extension');
    deactivate = ext.deactivate;

    // Activate in untrusted mode — startScanning should be skipped.
    ext.activate(vscode.__test.createMockContext());
  });

  after(() => {
    deactivate();
    vscode.__test.reset();

    // Purge compiled extension modules so other suites get a fresh state.
    for (const key of Object.keys(require.cache)) {
      if (key.includes('/out/') && !key.includes('/out/test/')) {
        delete require.cache[key];
      }
    }
  });

  it('does not scan workspace during activation when untrusted', () => {
    assert.strictEqual(vscode.__test.findFilesCalled, false);
  });

  it('refresh command short-circuits in untrusted workspace', async () => {
    vscode.__test.findFilesCalled = false;
    vscode.workspace.isTrusted = false;

    const handler = vscode.__test.commandHandlers.get('linesight.refresh');
    assert.ok(handler, 'linesight.refresh command should be registered');

    await handler();

    assert.strictEqual(
      vscode.__test.findFilesCalled,
      false,
      'refresh must not trigger findFiles in an untrusted workspace',
    );
  });

  it('refresh command proceeds in trusted workspace', async () => {
    vscode.__test.findFilesCalled = false;
    vscode.workspace.isTrusted = true;

    const handler = vscode.__test.commandHandlers.get('linesight.refresh');
    assert.ok(handler);

    await handler();

    assert.strictEqual(
      vscode.__test.findFilesCalled,
      true,
      'refresh should call findFiles when workspace is trusted',
    );
  });
});
