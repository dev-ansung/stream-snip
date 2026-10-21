/**
 * SettingsController component for StegoClip Side Panel.
 * Handles sniffer settings persistence, extension reloading,
 * and diagnostic terminal logs inspection.
 */

const SettingsController = (() => {
  const SETTINGS_KEY = 'stegoclip_settings';

  // DOM Elements
  const settingMinSize = /** @type {HTMLInputElement | null} */ (
    document.getElementById('settingMinSize')
  );
  const settingStegoStrip = /** @type {HTMLInputElement | null} */ (
    document.getElementById('settingStegoStrip')
  );
  const settingDefaultFormat = /** @type {HTMLSelectElement | null} */ (
    document.getElementById('settingDefaultFormat')
  );
  const settingMp3Bitrate = /** @type {HTMLSelectElement | null} */ (
    document.getElementById('settingMp3Bitrate')
  );
  const settingConcurrency = /** @type {HTMLSelectElement | null} */ (
    document.getElementById('settingConcurrency')
  );

  const btnReloadExtension = document.getElementById('btnReloadExtension');
  const logTerminal = document.getElementById('logTerminal');
  const btnRefreshLogs = document.getElementById('btnRefreshLogs');
  const btnCopyLogs = document.getElementById('btnCopyLogs');
  const btnClearLogs = document.getElementById('btnClearLogs');

  async function loadSettings() {
    try {
      const data = await chrome.storage.local.get([SETTINGS_KEY]);
      const settings = /** @type {Record<string, any>} */ (data[SETTINGS_KEY] || {});
      if (settingMinSize && settings.minSize !== undefined) settingMinSize.value = settings.minSize;
      if (settingStegoStrip && settings.stegoStrip !== undefined)
        settingStegoStrip.checked = settings.stegoStrip;
      if (settingDefaultFormat && settings.defaultFormat)
        settingDefaultFormat.value = settings.defaultFormat;
      if (settingMp3Bitrate && settings.mp3Bitrate) settingMp3Bitrate.value = settings.mp3Bitrate;
      if (settingConcurrency && settings.concurrency)
        settingConcurrency.value = settings.concurrency;
    } catch {}
  }

  async function saveSettings() {
    try {
      const settings = {
        minSize: settingMinSize ? parseInt(settingMinSize.value, 10) || 50 : 50,
        stegoStrip: settingStegoStrip ? settingStegoStrip.checked : true,
        defaultFormat: settingDefaultFormat ? settingDefaultFormat.value : 'mp4',
        mp3Bitrate: settingMp3Bitrate ? settingMp3Bitrate.value : '192',
        concurrency: settingConcurrency ? settingConcurrency.value : '5'
      };
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.info('Settings saved.');
      }
    } catch {}
  }

  async function loadDiagnosticLogs() {
    if (!logTerminal) return;
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_LOGS' }, resolve);
      });
      if (!res || !Array.isArray(res.logs) || res.logs.length === 0) {
        logTerminal.innerHTML = '<div class="log-empty">No sniffer logs recorded yet.</div>';
        return;
      }
      logTerminal.innerHTML = '';
      res.logs.forEach((entry) => {
        const line = document.createElement('div');
        line.className = 'log-line';

        const timeSpan = document.createElement('span');
        timeSpan.className = 'log-time';
        const d = new Date(entry.timestamp);
        timeSpan.textContent =
          d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');

        const badge = document.createElement('span');
        const catLower = (entry.category || 'info').toLowerCase();
        badge.className = `log-badge badge-${catLower}`;
        badge.textContent = `[${entry.category || 'INFO'}]`;

        const msgSpan = document.createElement('span');
        msgSpan.className = 'log-msg';
        msgSpan.textContent = entry.message || '';

        line.appendChild(timeSpan);
        line.appendChild(badge);
        line.appendChild(msgSpan);
        logTerminal.appendChild(line);
      });
      logTerminal.scrollTop = logTerminal.scrollHeight;
    } catch (err) {
      console.warn('[StegoClip:Popup] Failed to load diagnostic logs:', err);
    }
  }

  async function clearLogs() {
    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' }, resolve);
      });
      await loadDiagnosticLogs();
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.info('Logs cleared.');
      }
    } catch {
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.error('Failed to clear logs.');
      }
    }
  }

  async function copyLogs() {
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_LOGS' }, resolve);
      });
      if (!res || !Array.isArray(res.logs) || res.logs.length === 0) {
        if (typeof UiFeedback !== 'undefined') {
          UiFeedback.warning('No logs to copy.');
        }
        return;
      }
      const text = res.logs
        .map((l) => `[${new Date(l.timestamp).toISOString()}] [${l.category}] ${l.message}`)
        .join('\n');
      await navigator.clipboard.writeText(text);
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.success('Diagnostic logs copied to clipboard!');
      }
    } catch {
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.error('Failed to copy logs.');
      }
    }
  }

  function reloadExtension() {
    if (btnReloadExtension) btnReloadExtension.disabled = true;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.reload) {
        chrome.runtime.reload();
      }
    } catch (err) {
      console.warn('[StegoClip:Popup] Failed to reload extension:', err);
      if (btnReloadExtension) btnReloadExtension.disabled = false;
    }
  }

  function init() {
    [
      settingMinSize,
      settingStegoStrip,
      settingDefaultFormat,
      settingMp3Bitrate,
      settingConcurrency
    ].forEach((el) => {
      if (el) {
        el.addEventListener('change', () => {
          saveSettings();
        });
      }
    });

    if (btnReloadExtension) {
      btnReloadExtension.addEventListener('click', reloadExtension);
    }

    if (btnRefreshLogs) {
      btnRefreshLogs.addEventListener('click', async () => {
        await loadDiagnosticLogs();
        if (typeof UiFeedback !== 'undefined') {
          UiFeedback.info('Logs refreshed.');
        }
      });
    }

    if (btnClearLogs) {
      btnClearLogs.addEventListener('click', clearLogs);
    }

    if (btnCopyLogs) {
      btnCopyLogs.addEventListener('click', copyLogs);
    }

    loadSettings();
  }

  return {
    init,
    loadSettings,
    saveSettings,
    loadDiagnosticLogs,
    clearLogs,
    copyLogs,
    reloadExtension
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SettingsController;
}
