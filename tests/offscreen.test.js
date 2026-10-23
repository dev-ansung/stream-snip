const test = require('node:test');
const assert = require('node:assert/strict');

// Ensure StegoConstants and StegoTime are loaded in global
require('../lib/constants.js');
require('../lib/time.js');
const {
  activeTasks,
  guessDirectFileExtension,
  handleCancelDownload,
  handleStartDownload
} = require('../offscreen/offscreen.js');

test('offscreen/offscreen.js guessDirectFileExtension infers extensions correctly', () => {
  assert.equal(guessDirectFileExtension('https://example.com/video.mp4'), 'mp4');
  assert.equal(
    guessDirectFileExtension('https://example.com/stream?token=abc', 'video/webm'),
    'webm'
  );
  assert.equal(
    guessDirectFileExtension('https://example.com/stream?token=abc', 'video/mp4; codecs="avc1"'),
    'mp4'
  );
  assert.equal(guessDirectFileExtension('https://example.com/audio', 'audio/mpeg'), 'mpeg');
  assert.equal(guessDirectFileExtension('https://example.com/unknown', ''), 'mp4');
});

test('offscreen/offscreen.js handleCancelDownload rejects non-existent tasks', () => {
  let response = null;
  handleCancelDownload({ taskId: 'nonexistent_123' }, (res) => {
    response = res;
  });
  assert.deepEqual(response, { success: false, error: 'Task not found' });
});

test('offscreen/offscreen.js handleCancelDownload signals abort for active tasks', () => {
  const dummyTaskId = 'task_test_cancel';
  const abortController = new AbortController();
  activeTasks.set(dummyTaskId, {
    taskId: dummyTaskId,
    abortController,
    task: {},
    startedAt: Date.now()
  });

  assert.equal(abortController.signal.aborted, false);

  let response = null;
  handleCancelDownload({ taskId: dummyTaskId }, (res) => {
    response = res;
  });

  assert.equal(response.success, true);
  assert.equal(abortController.signal.aborted, true);
  activeTasks.delete(dummyTaskId);
});

test('offscreen/offscreen.js handleStartDownload validates missing taskId', async () => {
  let response = null;
  await handleStartDownload({}, (res) => {
    response = res;
  });
  assert.deepEqual(response, { success: false, error: 'Missing taskId' });
});

test('offscreen/offscreen.js handleStartDownload detects duplicate taskId and ignores', async () => {
  const duplicateId = 'task_dup_123';
  activeTasks.set(duplicateId, {
    taskId: duplicateId,
    abortController: new AbortController(),
    task: {},
    startedAt: Date.now()
  });

  let response = null;
  await handleStartDownload({ taskId: duplicateId }, (res) => {
    response = res;
  });

  assert.deepEqual(response, { success: true, taskId: duplicateId, duplicate: true });
  activeTasks.delete(duplicateId);
});

test('offscreen/offscreen.js produces .partial.mp4 filename for interrupted downloads', () => {
  const { buildPartialFilename } = require('../lib/time.js');
  assert.equal(buildPartialFilename('video1.mp4'), 'video1.partial.mp4');
  assert.equal(buildPartialFilename('video1.00_04_23.mp4'), 'video1.00_04_23.partial.mp4');
});
