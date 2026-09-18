const test = require('node:test');
const assert = require('node:assert/strict');
const { findAllVideos, findPrimaryVideo, handleVideoSeek } = require('../content/content.js');

test('findAllVideos traverses DOM and Shadow DOM roots', () => {
  const normalVideo = { tagName: 'VIDEO', id: 'v1' };
  const shadowVideo = { tagName: 'VIDEO', id: 'v2' };
  const shadowHost = {
    shadowRoot: {
      querySelectorAll: (sel) => {
        if (sel === 'video') return [shadowVideo];
        return [];
      }
    }
  };

  const fakeRoot = {
    querySelectorAll: (sel) => {
      if (sel === 'video') return [normalVideo];
      if (sel === '*') return [shadowHost];
      return [];
    }
  };

  const results = findAllVideos(fakeRoot);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, 'v1');
  assert.equal(results[1].id, 'v2');
});

test('findPrimaryVideo prioritizes actively playing video', () => {
  const fakeVideos = [
    { paused: true, currentTime: 0, videoWidth: 1920, videoHeight: 1080 },
    { paused: false, currentTime: 15, videoWidth: 640, videoHeight: 360 }
  ];

  global.document = {
    querySelectorAll: (selector) => {
      if (selector === 'video') return fakeVideos;
      return [];
    }
  };

  const primary = findPrimaryVideo();
  assert.equal(primary, fakeVideos[1]);

  delete global.document;
});

test('handleVideoSeek sends TAB_MEDIA_SEEK message via chrome.runtime', () => {
  let dispatched = null;
  global.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        dispatched = msg;
        return true;
      }
    }
  };

  const video = {
    videoWidth: 1280,
    videoHeight: 720,
    currentTime: 42.5,
    duration: 300,
    paused: false
  };

  handleVideoSeek(video);

  assert.ok(dispatched);
  assert.equal(dispatched.type, 'TAB_MEDIA_SEEK');
  assert.equal(dispatched.currentTime, 42.5);
  assert.equal(dispatched.duration, 300);

  delete global.chrome;
});

test('handleVideoSeek does not discard paused or zero-dimension video', () => {
  let dispatched = null;
  global.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        dispatched = msg;
        return true;
      }
    }
  };

  const pausedZeroDimVideo = {
    videoWidth: 0,
    videoHeight: 0,
    currentTime: 19.3,
    duration: 0,
    paused: true
  };

  handleVideoSeek(pausedZeroDimVideo);

  assert.ok(dispatched);
  assert.equal(dispatched.type, 'TAB_MEDIA_SEEK');
  assert.equal(dispatched.currentTime, 19.3);
  assert.equal(dispatched.paused, true);

  delete global.chrome;
});
