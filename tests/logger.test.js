const test = require('node:test');
const assert = require('node:assert/strict');
const Catcher = require('../background/catcher.js');

test('Catcher log buffer records entries and clears them correctly', () => {
  Catcher.clearLogs();
  assert.equal(Catcher.getLogs().length, 0);

  Catcher.addLog('SNIFF', 'Captured test stream', { url: 'https://example.com/test.m3u8' });
  Catcher.addLog('SKIP', 'Direct media below threshold');
  Catcher.addLog('WORKER', 'Capture armed');

  const logs = Catcher.getLogs();
  assert.equal(logs.length, 3);
  assert.equal(logs[0].category, 'SNIFF');
  assert.equal(logs[0].message, 'Captured test stream');
  assert.ok(logs[0].timestamp);
  assert.equal(logs[1].category, 'SKIP');
  assert.equal(logs[2].category, 'WORKER');

  Catcher.clearLogs();
  assert.equal(Catcher.getLogs().length, 0);
});

test('Catcher log buffer enforces maximum capacity ring buffer (150 entries)', () => {
  Catcher.clearLogs();

  for (let i = 0; i < 200; i++) {
    Catcher.addLog('SNIFF', `Stream entry ${i}`);
  }

  const logs = Catcher.getLogs();
  assert.equal(logs.length, 150);
  assert.equal(logs[0].message, 'Stream entry 50');
  assert.equal(logs[149].message, 'Stream entry 199');

  Catcher.clearLogs();
});
