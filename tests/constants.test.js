const test = require('node:test');
const assert = require('node:assert/strict');
const { MSG_TYPES, STORAGE_KEYS, CONFIG, getPopupStateKey } = require('../lib/constants.js');

test('StegoConstants provides expected message types and storage keys', () => {
  assert.equal(MSG_TYPES.GET_STREAMS, 'GET_STREAMS');
  assert.equal(MSG_TYPES.CLEAR_STREAMS, 'CLEAR_STREAMS');
  assert.equal(MSG_TYPES.APPLY_DNR_RULES, 'APPLY_DNR_RULES');
  assert.equal(MSG_TYPES.TAB_MEDIA_SEEK, 'TAB_MEDIA_SEEK');
  assert.equal(MSG_TYPES.GET_PAGE_MEDIA_TIME, 'GET_PAGE_MEDIA_TIME');
  assert.equal(MSG_TYPES.STREAM_DETECTED, 'STREAM_DETECTED');
  assert.equal(STORAGE_KEYS.TAB_STREAMS, 'tabStreams');
  assert.equal(STORAGE_KEYS.POPUP_STATE_PREFIX, 'stego_popup_state_');
});

test('StegoConstants generates correct popup state keys', () => {
  assert.equal(getPopupStateKey(123), 'stego_popup_state_123');
  assert.equal(getPopupStateKey('456'), 'stego_popup_state_456');
});

test('StegoConstants defines sane safety limits', () => {
  assert.equal(CONFIG.DEFAULT_CONCURRENCY, 6);
  assert.ok(CONFIG.MAX_SAFE_CLIP_BYTES > 1024 * 1024 * 1024);
});
