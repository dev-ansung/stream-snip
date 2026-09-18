const test = require('node:test');
const assert = require('node:assert/strict');
const { isLikelyMainVideo, findPrimaryVideo, handleVideoSeek } = require('../content/content.js');

test('isLikelyMainVideo correctly identifies primary playback videos', () => {
  // 1. Tiny video with 0 duration and paused
  const tinyVideo = { videoWidth: 100, videoHeight: 50, paused: true, currentTime: 0, duration: 2 };
  assert.equal(isLikelyMainVideo(tinyVideo), false);

  // 2. Standard dimension video (e.g. 1280x720)
  const regularVideo = {
    videoWidth: 1280,
    videoHeight: 720,
    paused: true,
    currentTime: 0,
    duration: 120
  };
  assert.equal(isLikelyMainVideo(regularVideo), true);

  // 3. Actively playing video
  const playingVideo = { videoWidth: 0, videoHeight: 0, paused: false, currentTime: 5 };
  assert.equal(isLikelyMainVideo(playingVideo), true);

  // 4. Video with meaningful duration
  const longVideo = {
    videoWidth: 0,
    videoHeight: 0,
    paused: true,
    currentTime: 0,
    duration: 3600
  };
  assert.equal(isLikelyMainVideo(longVideo), true);
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
