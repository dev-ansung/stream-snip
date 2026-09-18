/**
 * Tab-isolated state management for StegoClip popup and studio.
 */

class StateManagerClass {
  constructor(options = {}) {
    this.debounceMs = options.debounceMs || 250;
    this.debounceTimers = new Map();
  }

  getStateKey(tabId) {
    if (typeof StegoConstants !== 'undefined' && StegoConstants.getPopupStateKey) {
      return StegoConstants.getPopupStateKey(tabId);
    }
    return `stego_popup_state_${tabId}`;
  }

  async loadState(tabId) {
    if (!tabId || typeof chrome === 'undefined' || !chrome.storage?.local) {
      return null;
    }
    const key = this.getStateKey(tabId);
    try {
      const res = await chrome.storage.local.get([key]);
      return res[key] || null;
    } catch (err) {
      console.warn('[StateManager] Failed to load state:', err);
      return null;
    }
  }

  saveState(tabId, state) {
    if (!tabId || typeof chrome === 'undefined' || !chrome.storage?.local) {
      return;
    }
    const key = this.getStateKey(tabId);
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(key);
      try {
        await chrome.storage.local.set({
          [key]: {
            ...state,
            tabId,
            timestamp: Date.now()
          }
        });
      } catch (err) {
        console.warn('[StateManager] Failed to save state:', err);
      }
    }, this.debounceMs);

    this.debounceTimers.set(key, timer);
  }

  async saveStateImmediate(tabId, state) {
    if (!tabId || typeof chrome === 'undefined' || !chrome.storage?.local) {
      return;
    }
    const key = this.getStateKey(tabId);
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.debounceTimers.delete(key);
    }
    try {
      await chrome.storage.local.set({
        [key]: {
          ...state,
          tabId,
          timestamp: Date.now()
        }
      });
    } catch (err) {
      console.warn('[StateManager] Failed to save state immediately:', err);
    }
  }

  async clearState(tabId) {
    if (!tabId || typeof chrome === 'undefined' || !chrome.storage?.local) {
      return;
    }
    const key = this.getStateKey(tabId);
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.debounceTimers.delete(key);
    }
    try {
      await chrome.storage.local.remove([key, `stego_download_${tabId}`]);
    } catch (err) {
      console.warn('[StateManager] Failed to clear state:', err);
    }
  }
}

const StateManager = new StateManagerClass();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StateManagerClass, StateManager };
}
if (typeof globalThis !== 'undefined') {
  globalThis.StateManager = StateManager;
}
