import { buildApp } from '../../src/server.js';

// Thin re-export so integration tests import from a stable `tests/helpers`
// path rather than reaching into `src/server.ts` directly everywhere.
export default buildApp;
