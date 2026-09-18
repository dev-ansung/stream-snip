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

test('findPrimaryVideo prioritizes video with matching expectedDuration', () => {
  const fakeVideos = [
    { paused: false, currentTime: 15, duration: 1500, videoWidth: 1920, videoHeight: 1080 },
    { paused: true, currentTime: 0, duration: 13985.033, videoWidth: 640, videoHeight: 360 }
  ];

  global.document = {
    querySelectorAll: (selector) => {
      if (selector === 'video') return fakeVideos;
      return [];
    }
  };

  const matched = findPrimaryVideo(13985);
  assert.equal(matched, fakeVideos[1]);

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

test('startSync and stopSync manage listener lifecycle on demand', () => {
  const { startSync, stopSync, isSyncActive } = require('../content/content.js');
  const addedEvents = [];
  const removedEvents = [];

  const fakeVideo = {
    tagName: 'VIDEO',
    duration: 120,
    addEventListener: (ev) => addedEvents.push(ev),
    removeEventListener: (ev) => removedEvents.push(ev)
  };

  global.document = {
    querySelectorAll: (sel) => {
      if (sel === 'video') return [fakeVideo];
      return [];
    }
  };

  assert.equal(isSyncActive(), false);

  startSync(120);
  assert.equal(isSyncActive(), true);
  assert.ok(addedEvents.includes('seeked'));
  assert.ok(addedEvents.includes('seeking'));

  stopSync();
  assert.equal(isSyncActive(), false);
  assert.ok(removedEvents.includes('seeked'));
  assert.ok(removedEvents.includes('seeking'));

  delete global.document;
});

test('getCleanTitle cleans illegal filename characters and limits length', () => {
  const { getCleanTitle } = require('../content/content.js');
  assert.equal(
    getCleanTitle('My Awesome Video: Episode 1? [1080p]'),
    'My-Awesome-Video-Episode-1-[1080p]'
  );
  assert.equal(getCleanTitle(''), '');
});

test('reportTitleChange sends PAGE_TITLE_CHANGED message via chrome.runtime', () => {
  const { reportTitleChange } = require('../content/content.js');
  let dispatched = null;
  global.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        dispatched = msg;
        return true;
      }
    }
  };
  global.document = {
    title: 'Brand New Stream Title'
  };
  global.location = {
    href: 'https://example.com/watch?v=123'
  };

  reportTitleChange();

  assert.ok(dispatched);
  assert.equal(dispatched.type, 'PAGE_TITLE_CHANGED');
  assert.equal(dispatched.title, 'Brand New Stream Title');
  assert.equal(dispatched.cleanTitle, 'Brand-New-Stream-Title');
  assert.equal(dispatched.url, 'https://example.com/watch?v=123');

  delete global.chrome;
  delete global.document;
  delete global.location;
});

test('startTitleObserver and stopTitleObserver manage observer lifecycle', () => {
  const { startTitleObserver, stopTitleObserver } = require('../content/content.js');
  let observedTarget = null;
  let disconnected = false;

  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb;
    }
    observe(target) {
      observedTarget = target;
    }
    disconnect() {
      disconnected = true;
    }
  }

  global.MutationObserver = FakeMutationObserver;
  global.document = {
    title: 'Test Title',
    querySelector: (sel) => (sel === 'title' ? { tagName: 'TITLE' } : null)
  };

  startTitleObserver();
  assert.ok(observedTarget);
  assert.equal(observedTarget.tagName, 'TITLE');

  stopTitleObserver();
  assert.equal(disconnected, true);

  delete global.MutationObserver;
  delete global.document;
});
