import js from '@eslint/js';
import globals from 'globals';

export default [
  // Ignore vendor bundles, test coverage, and dependencies
  {
    ignores: ['**/node_modules/**', 'lib/hls.min.js', 'lib/mux.min.js', 'coverage/**', 'dist/**']
  },

  // Base recommended rules for all JS
  js.configs.recommended,

  // General options
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-debugger': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      eqeqeq: ['warn', 'smart'],
      'no-var': 'error',
      'prefer-const': 'warn'
    }
  },

  // Service Worker (MV3 Background Script)
  {
    files: ['background/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        ...globals.webextensions,
        chrome: 'readonly'
      }
    },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'Service workers do not have access to window.' },
        { name: 'document', message: 'Service workers do not have access to document.' },
        { name: 'localStorage', message: 'Use chrome.storage instead of localStorage in MV3.' }
      ]
    }
  },

  // Offscreen Document script (Browser Window with Chrome APIs)
  {
    files: ['offscreen/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: 'readonly',
        muxjs: 'readonly',
        StegoDecoder: 'readonly',
        StegoDownloader: 'readonly',
        StegoTransmuxer: 'readonly'
      }
    }
  },

  // Popup & UI scripts (Browser Window with Chrome APIs)
  {
    files: ['popup/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: 'readonly',
        Hls: 'readonly',
        muxjs: 'readonly',
        StegoDecoder: 'readonly',
        StegoTime: 'readonly',
        StegoParser: 'readonly',
        StegoDownloader: 'readonly',
        StegoFragmentLoader: 'readonly',
        StegoTransmuxer: 'readonly'
      }
    }
  },

  // Libraries in lib/
  {
    files: ['lib/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        globalThis: 'readonly',
        chrome: 'readonly',
        Hls: 'readonly',
        muxjs: 'readonly',
        StegoDecoder: 'readonly',
        StegoTime: 'readonly',
        StegoParser: 'readonly',
        StegoDownloader: 'readonly',
        StegoFragmentLoader: 'readonly',
        StegoTransmuxer: 'readonly'
      }
    }
  },

  // Tests
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        Hls: 'readonly',
        muxjs: 'readonly'
      }
    },
    rules: {
      'no-console': 'off'
    }
  }
];
