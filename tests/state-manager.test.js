const test = require('node:test');
const assert = require('node:assert/strict');
const { StateManagerClass } = require('../popup/state-manager.js');

test('StateManager generates correct tab-isolated state key', () => {
  const sm = new StateManagerClass();
  assert.equal(sm.getStateKey(42), 'stego_popup_state_42');
});

test('StateManager loads and clears tab state using mocked chrome.storage.local', async () => {
  const fakeStore = {};
  global.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          keys.forEach((k) => {
            if (fakeStore[k]) res[k] = fakeStore[k];
          });
          return res;
        },
        set: async (obj) => {
          Object.assign(fakeStore, obj);
        },
        remove: async (keys) => {
          keys.forEach((k) => delete fakeStore[k]);
        }
      }
    }
  };

  const sm = new StateManagerClass({ debounceMs: 10 });
  fakeStore['stego_popup_state_99'] = { streamUrl: 'https://example.com/test.m3u8', isFull: true };

  const loaded = await sm.loadState(99);
  assert.deepEqual(loaded, { streamUrl: 'https://example.com/test.m3u8', isFull: true });

  await sm.clearState(99);
  const cleared = await sm.loadState(99);
  assert.equal(cleared, null);

  delete global.chrome;
});

test('StateManager persists and restores isUserCustomFilename flag', async () => {
  const fakeStore = {};
  global.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          keys.forEach((k) => {
            if (fakeStore[k]) res[k] = fakeStore[k];
          });
          return res;
        },
        set: async (obj) => {
          Object.assign(fakeStore, obj);
        },
        remove: async (keys) => {
          keys.forEach((k) => delete fakeStore[k]);
        }
      }
    }
  };

  const sm = new StateManagerClass({ debounceMs: 5 });
  sm.saveState(101, {
    streamUrl: 'https://example.com/live.m3u8',
    filename: 'Custom_User_Name_10_00-15_00',
    userCustomBaseName: 'Custom_User_Name',
    isUserCustomFilename: true
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  const state = await sm.loadState(101);
  assert.equal(state.isUserCustomFilename, true);
  assert.equal(state.userCustomBaseName, 'Custom_User_Name');
  assert.equal(state.filename, 'Custom_User_Name_10_00-15_00');

  delete global.chrome;
});

test('StateManager saveStateImmediate persists immediately without debounce delay', async () => {
  const fakeStore = {};
  global.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          keys.forEach((k) => {
            if (fakeStore[k]) res[k] = fakeStore[k];
          });
          return res;
        },
        set: async (obj) => {
          Object.assign(fakeStore, obj);
        },
        remove: async (keys) => {
          keys.forEach((k) => delete fakeStore[k]);
        }
      }
    }
  };

  const sm = new StateManagerClass({ debounceMs: 5000 });
  await sm.saveStateImmediate(202, {
    streamUrl: 'https://example.com/immediate.m3u8',
    headers: { Referer: 'https://example.com' }
  });

  // State must be accessible immediately without waiting for 5000ms debounce
  const state = await sm.loadState(202);
  assert.ok(state);
  assert.equal(state.streamUrl, 'https://example.com/immediate.m3u8');
  assert.equal(state.headers.Referer, 'https://example.com');

  delete global.chrome;
});
