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
