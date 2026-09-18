/**
 * Non-blocking accessible toast notification system for StegoClip.
 */

class UiFeedbackManager {
  constructor(container = null) {
    this.container = container;
  }

  getContainer() {
    if (!this.container && typeof document !== 'undefined') {
      this.container = document.getElementById('toastContainer');
    }
    return this.container;
  }

  show(message, type = 'info', duration = 4000) {
    const container = this.getContainer();
    if (!container) {
      if (type === 'error') {
        console.error(`[UiFeedback]: ${message}`);
      } else {
        console.info(`[UiFeedback ${type}]: ${message}`);
      }
      return null;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');

    const icons = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    };

    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.textContent = icons[type] || 'ℹ️';

    const msgSpan = document.createElement('span');
    msgSpan.className = 'toast-message';
    msgSpan.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close');

    toast.appendChild(iconSpan);
    toast.appendChild(msgSpan);
    toast.appendChild(closeBtn);

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      toast.classList.add('toast-hiding');
      setTimeout(() => {
        if (toast.parentNode === container) {
          container.removeChild(toast);
        }
      }, 250);
    };

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });

    toast.addEventListener('click', dismiss);
    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(dismiss, duration);
    }
    return toast;
  }

  info(msg, duration) {
    return this.show(msg, 'info', duration);
  }

  success(msg, duration) {
    return this.show(msg, 'success', duration);
  }

  warning(msg, duration) {
    return this.show(msg, 'warning', duration);
  }

  error(msg, duration) {
    return this.show(msg, 'error', duration);
  }
}

const UiFeedback = new UiFeedbackManager();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { UiFeedbackManager, UiFeedback };
}
if (typeof globalThis !== 'undefined') {
  globalThis.UiFeedback = UiFeedback;
}
