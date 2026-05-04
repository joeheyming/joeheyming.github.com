/**
 * First-run GNOME-style setup wizard (DOM in os/index.html).
 */
import { saveUsername, saveHostname } from './config.js';

export class SetupWizardController {
  /** @param {object} heymingOS — HeymingOS instance */
  constructor(heymingOS) {
    this.os = heymingOS;
  }

  show() {
    const wizard = document.getElementById('os-setup-wizard');
    if (!wizard) {
      this.os._showDesktop();
      return;
    }
    wizard.classList.remove('hidden');

    const stepWelcome = document.getElementById('os-setup-step-welcome');
    const stepUser = document.getElementById('os-setup-step-user');
    const stepDone = document.getElementById('os-setup-step-done');
    const startBtn = document.getElementById('os-setup-start');
    const backBtn = document.getElementById('os-setup-back');
    const confirmBtn = /** @type {HTMLButtonElement|null} */ (
      document.getElementById('os-setup-confirm')
    );
    const finishBtn = document.getElementById('os-setup-finish');
    const usernameInput = /** @type {HTMLInputElement|null} */ (
      document.getElementById('os-setup-username')
    );
    const hostnameInput = /** @type {HTMLInputElement|null} */ (
      document.getElementById('os-setup-hostname')
    );
    const preview = document.getElementById('os-setup-preview');
    const previewHome = document.getElementById('os-setup-preview-home');
    const previewPrompt = document.getElementById('os-setup-preview-prompt');
    const usernameError = document.getElementById('os-setup-username-error');
    const usernameHint = document.getElementById('os-setup-username-hint');
    const hostnameError = document.getElementById('os-setup-hostname-error');
    const hostnameHint = document.getElementById('os-setup-hostname-hint');
    const doneUser = document.getElementById('os-setup-done-user');
    const dots = [0, 1, 2].map((i) => document.getElementById(`os-setup-dot-${i}`));

    if (
      !stepWelcome ||
      !stepUser ||
      !stepDone ||
      !startBtn ||
      !backBtn ||
      !confirmBtn ||
      !finishBtn ||
      !usernameInput ||
      !hostnameInput ||
      !preview ||
      !previewHome ||
      !previewPrompt ||
      !usernameError ||
      !usernameHint ||
      !hostnameError ||
      !hostnameHint ||
      !doneUser
    ) {
      console.warn('[SetupWizard] Missing DOM nodes; skipping wizard wiring');
      this.os._showDesktop();
      return;
    }

    const setStep = (idx) => {
      [stepWelcome, stepUser, stepDone].forEach((s, i) => {
        if (s) s.classList.toggle('hidden', i !== idx);
      });
      dots.forEach((d, i) => {
        if (!d) return;
        d.classList.toggle('active', i === idx);
        d.classList.toggle('completed', i < idx);
      });
    };

    const validateField = (input, errorEl, hintEl, regex, errorMsg) => {
      const raw = input.value.trim().toLowerCase();
      const clean = raw.replace(regex, '');
      if (raw && raw !== clean) {
        errorEl.textContent = errorMsg;
        errorEl.classList.remove('hidden');
        hintEl.classList.add('hidden');
      } else {
        errorEl.classList.add('hidden');
        hintEl.classList.remove('hidden');
      }
      return clean;
    };

    const validate = () => {
      const user = validateField(
        usernameInput,
        usernameError,
        usernameHint,
        /[^a-z0-9._-]/g,
        'Only lowercase a-z, 0-9, dots, dashes, and underscores.'
      );
      const host = validateField(
        hostnameInput,
        hostnameError,
        hostnameHint,
        /[^a-z0-9-]/g,
        'Only lowercase a-z, 0-9, and dashes.'
      );
      if (user && host) {
        preview.classList.remove('hidden');
        previewHome.textContent = `/home/${user}`;
        previewPrompt.textContent = `${user}@${host}:~$`;
      } else if (user) {
        preview.classList.remove('hidden');
        previewHome.textContent = `/home/${user}`;
        previewPrompt.textContent = `${user}@...:~$`;
      } else {
        preview.classList.add('hidden');
      }
      confirmBtn.disabled = !user || !host;
      return { user, host };
    };

    if (!usernameInput.value) usernameInput.value = 'joe';
    if (!hostnameInput.value) hostnameInput.value = 'heyming-os';
    validate();
    setTimeout(() => startBtn.focus(), 0);

    startBtn.addEventListener('click', () => {
      setStep(1);
      usernameInput.focus();
      usernameInput.select();
    });

    backBtn.addEventListener('click', () => {
      setStep(0);
    });

    usernameInput.addEventListener('input', validate);
    hostnameInput.addEventListener('input', validate);
    const onEnter = (e) => {
      if (e.key === 'Enter' && !confirmBtn.disabled) confirmBtn.click();
    };
    usernameInput.addEventListener('keydown', onEnter);
    hostnameInput.addEventListener('keydown', onEnter);

    confirmBtn.addEventListener('click', () => {
      const { user, host } = validate();
      if (!user || !host) return;

      saveUsername(user);
      saveHostname(host);

      doneUser.textContent = user;
      setStep(2);

      if (this.os.fileSystemDB) {
        this.os.fileSystemDB.initializeWithScaffolding(user).catch(() => {});
      }
    });

    finishBtn.addEventListener('click', () => {
      wizard.style.animation = 'fadeOut 0.4s ease-in forwards';
      setTimeout(() => {
        wizard.classList.add('hidden');
        wizard.style.animation = '';
        this.os._showDesktop();
        this.os.desktop.refresh();
      }, 400);
    });
  }
}
