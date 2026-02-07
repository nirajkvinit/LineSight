// Register the vscode mock before any test modules load.
// Mocha's --require runs this before importing test files,
// so `require('vscode')` in production code resolves to our stub.

import * as Module from 'module';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M = Module as any;
const originalResolveFilename = M._resolveFilename;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
M._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') {
    return require.resolve('./vscode-mock');
  }
  return originalResolveFilename.call(this, request, ...args);
};
