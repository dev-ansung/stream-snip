import js from '@eslint/js';
import globals from 'globals';

export default [
  // Ignore vendor bundles, test coverage, and dependencies
  {
    ignores: [
      '**/node_modules/**',
      'lib/hls.min.js',
      'lib/mux.min.js',
      'lib/lame.min.js',
      'coverage/**',
      'dist/**'
    ]
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
        chrome: 'readonly',
        StegoConstants: 'readonly',
        StegoTime: 'readonly'
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

  // Popup & UI scripts (Browser Window with Chrome APIs)
  {
    files: ['popup/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.node,
        chrome: 'readonly',
        Hls: 'readonly',
        muxjs: 'readonly',
        lamejs: 'readonly',
        StegoConstants: 'readonly',
        StegoDecoder: 'readonly',
        StegoTime: 'readonly',
        StegoParser: 'readonly',
        StegoDownloader: 'readonly',
        StegoFragmentLoader: 'readonly',
        StegoTransmuxer: 'readonly',
        StegoMp3Encoder: 'readonly',
        StegoBytes: 'readonly',
        UiFeedback: 'readonly',
        PlayerController: 'readonly',
        StateManager: 'readonly'
      }
    }
  },

  // Content scripts (Webpage context with WebExtensions messaging)
  {
    files: ['content/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.node,
        chrome: 'readonly',
        StegoConstants: 'readonly',
        StegoTime: 'readonly'
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
        lamejs: 'readonly',
        StegoDecoder: 'readonly',
        StegoTime: 'readonly',
        StegoParser: 'readonly',
        StegoDownloader: 'readonly',
        StegoFragmentLoader: 'readonly',
        StegoTransmuxer: 'readonly',
        StegoMp3Encoder: 'readonly',
        StegoBytes: 'readonly',
        StegoConstants: 'readonly'
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
  },

  // Build & maintenance scripts
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-console': 'off'
    }
  }
];
