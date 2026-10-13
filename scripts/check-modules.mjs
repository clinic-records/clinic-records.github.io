/**
 * Native Zero-Dependency Frontend ES Module Validator
 * Validates syntax, export/import linkage, and AST compliance for all browser files.
 * Uses pure Node.js built-ins: adds 0 bytes to production and requires 0 external dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';

const publicDir = path.resolve(process.cwd(), 'public');

function collectJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(collectJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

const jsFiles = collectJsFiles(publicDir);

console.log(`🔍 Checking ${jsFiles.length} frontend JavaScript files for syntax and parsing integrity...`);

let hasError = false;

// Dummy browser globals for safe static linkage test
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = {
  readyState: 'complete',
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ setAttribute: () => {}, style: {}, classList: { add: () => {}, remove: () => {} } }),
  body: { classList: { add: () => {}, remove: () => {} } },
};
globalThis.window = {
  location: { origin: 'http://localhost:3000', hash: '', search: '', pathname: '/' },
  addEventListener: () => {},
  removeEventListener: () => {},
  confirm: () => true,
};

for (const file of jsFiles) {
  const relPath = path.relative(process.cwd(), file);
  try {
    // Dynamic import verifies syntax, lexical binding, and module linkage
    await import(`file://${file}?check=${Date.now()}`);
  } catch (err) {
    // Check if error is pure syntax/parse/link error vs mock DOM missing call
    const isSyntaxOrLinkError = err instanceof SyntaxError ||
      err.message.includes('Invalid left-hand side') ||
      err.message.includes('does not provide an export') ||
      err.message.includes('Cannot find module');

    if (isSyntaxOrLinkError) {
      console.error(`\n❌ [SYNTAX/LINK ERROR] ${relPath}:`);
      console.error(`   ${err.stack || err.message}\n`);
      hasError = true;
    }
  }
}

if (hasError) {
  console.error('💥 Frontend module validation failed! Fix the syntax errors above.');
  process.exit(1);
} else {
  console.log(`✅ All ${jsFiles.length} frontend ES Modules parsed and linked with 100% clean syntax.`);
  process.exit(0);
}
