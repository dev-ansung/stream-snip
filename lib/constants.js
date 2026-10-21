/**
 * Shared constants and configuration for StegoClip.
 */

const MSG_TYPES = {
  GET_STREAMS: 'GET_STREAMS',
  CLEAR_STREAMS: 'CLEAR_STREAMS',
  APPLY_DNR_RULES: 'APPLY_DNR_RULES',
  MEDIA_REQUEST: 'MEDIA_REQUEST',
  STREAM_DETECTED: 'STREAM_DETECTED',
  GET_PAGE_TITLE: 'GET_PAGE_TITLE',
  PAGE_TITLE_CHANGED: 'PAGE_TITLE_CHANGED',
  STREAM_METADATA_UPDATED: 'STREAM_METADATA_UPDATED',
  ADD_MANUAL_STREAM: 'ADD_MANUAL_STREAM',
  START_DOWNLOAD: 'START_DOWNLOAD',
  DOWNLOAD_PROGRESS: 'DOWNLOAD_PROGRESS',
  CANCEL_DOWNLOAD: 'CANCEL_DOWNLOAD',
  DOWNLOAD_COMPLETE: 'DOWNLOAD_COMPLETE'
};

const STORAGE_KEYS = {
  TAB_STREAMS: 'tabStreams',
  TAB_METADATA: 'tabMetadata',
  STREAM_METADATA: 'streamMetadata',
  LAST_ACTIVE_TAB_ID: 'lastActiveMediaTabId',
  POPUP_STATE_PREFIX: 'stego_popup_state_',
  QUICK_CUT_MINUTES: 'stego_quick_cut_minutes',
  DOWNLOAD_HISTORY: 'stegoclip_download_history'
};

const CONFIG = {
  DEFAULT_CONCURRENCY: 6,
  MAX_SAFE_CLIP_BYTES: 1.8 * 1024 * 1024 * 1024, // 1.8 GB Chrome tab heap safety guard
  DEFAULT_QUICK_CUT_MINUTES: 10,
  MIN_QUICK_CUT_MINUTES: 1,
  MAX_QUICK_CUT_MINUTES: 180
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
