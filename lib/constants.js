/**
 * Shared constants and configuration for StegoClip.
 */

const MSG_TYPES = {
  GET_STREAMS: 'GET_STREAMS',
  CLEAR_STREAMS: 'CLEAR_STREAMS',
  APPLY_DNR_RULES: 'APPLY_DNR_RULES',
  MEDIA_REQUEST: 'MEDIA_REQUEST'
};

const STORAGE_KEYS = {
  TAB_STREAMS: 'tabStreams',
  TAB_METADATA: 'tabMetadata',
  LAST_ACTIVE_TAB_ID: 'lastActiveMediaTabId',
  POPUP_STATE_PREFIX: 'stego_popup_state_'
};

const CONFIG = {
  DEFAULT_CONCURRENCY: 6,
  MAX_SAFE_CLIP_BYTES: 1.8 * 1024 * 1024 * 1024 // 1.8 GB Chrome tab heap safety guard
};

function getPopupStateKey(tabId) {
  return `${STORAGE_KEYS.POPUP_STATE_PREFIX}${tabId}`;
}

const StegoConstants = {
  MSG_TYPES,
  STORAGE_KEYS,
  CONFIG,
  getPopupStateKey
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoConstants;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoConstants = StegoConstants;
}
