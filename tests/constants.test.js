const test = require('node:test');
const assert = require('node:assert/strict');
const { MSG_TYPES, STORAGE_KEYS, CONFIG, getPopupStateKey } = require('../lib/constants.js');

test('StegoConstants provides expected message types and storage keys', () => {
  assert.equal(MSG_TYPES.GET_STREAMS, 'GET_STREAMS');
  assert.equal(MSG_TYPES.CLEAR_STREAMS, 'CLEAR_STREAMS');
  assert.equal(MSG_TYPES.APPLY_DNR_RULES, 'APPLY_DNR_RULES');
  assert.equal(MSG_TYPES.STREAM_DETECTED, 'STREAM_DETECTED');
  assert.equal(MSG_TYPES.GET_PAGE_TITLE, 'GET_PAGE_TITLE');
  assert.equal(MSG_TYPES.PAGE_TITLE_CHANGED, 'PAGE_TITLE_CHANGED');
  assert.equal(MSG_TYPES.STREAM_METADATA_UPDATED, 'STREAM_METADATA_UPDATED');
  assert.equal(MSG_TYPES.ADD_MANUAL_STREAM, 'ADD_MANUAL_STREAM');
  assert.equal(MSG_TYPES.START_DOWNLOAD, 'START_DOWNLOAD');
  assert.equal(MSG_TYPES.DOWNLOAD_PROGRESS, 'DOWNLOAD_PROGRESS');
  assert.equal(MSG_TYPES.CANCEL_DOWNLOAD, 'CANCEL_DOWNLOAD');
  assert.equal(MSG_TYPES.DOWNLOAD_COMPLETE, 'DOWNLOAD_COMPLETE');
  assert.equal(STORAGE_KEYS.TAB_STREAMS, 'tabStreams');
  assert.equal(STORAGE_KEYS.STREAM_METADATA, 'streamMetadata');
  assert.equal(STORAGE_KEYS.POPUP_STATE_PREFIX, 'stego_popup_state_');
  assert.equal(STORAGE_KEYS.DOWNLOAD_HISTORY, 'stegoclip_download_history');
});

test('StegoConstants generates correct popup state keys', () => {
  assert.equal(getPopupStateKey(123), 'stego_popup_state_123');
  assert.equal(getPopupStateKey('456'), 'stego_popup_state_456');
});

test('StegoConstants defines sane safety limits', () => {
  assert.equal(CONFIG.DEFAULT_CONCURRENCY, 6);
  assert.ok(CONFIG.MAX_SAFE_CLIP_BYTES > 1024 * 1024 * 1024);
});

test('StegoConstants defines quick cut defaults', () => {
  assert.equal(CONFIG.DEFAULT_QUICK_CUT_MINUTES, 10);
  assert.equal(STORAGE_KEYS.QUICK_CUT_MINUTES, 'stego_quick_cut_minutes');
});
