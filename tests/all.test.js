// Register the full suite in one process, including environments without test
// runner subprocess support. node:test still reports every test and subtest.
import './core.test.js';
import './server.test.js';
import './service-worker.test.js';
import './assets.test.js';
import './ui.test.js';
import './vercel.test.js';
