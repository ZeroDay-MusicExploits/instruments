// ZERO DAY · MUSIC EXPLOITS — gate de mail (verificación por código).
// Un solo módulo compartido por index.html y las 5 landings (antes vivía
// duplicado: una copia en index.html y otra en ZD-Instrumento.dc.html, y se
// habían desincronizado — una tenía /resolve y la otra el typo /re-designsolve
// en el endpoint de chequeo de MX). Mismo comportamiento de siempre:
// demoMode activo, código visible en pantalla, hook window.ZD_SEND_CODE,
// chequeo de MX contra dns.google, localStorage 'zd-web-verified' y
// checkbox de aviso de C2. No toca el adaptador C2 ni window.ZD_M.
(function () {
  'use strict';

  var DISPOSABLE = ['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'emailondeck.com', 'mohmal.com'];
  var TYPOS = { 'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gnail.com': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'outlok.com': 'outlook.com', 'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com' };
  var RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/;
  var STORAGE_KEY = 'zd-web-verified';

  async function hasMx(domain) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, 4000);
    try {
      var r = await fetch('https://dns.google/resolve?name=' + encodeURIComponent(domain) + '&type=MX', { signal: ctl.signal });
      var j = await r.json();
      if (j.Status === 3) return false;
      return !!(j.Answer && j.Answer.length) || null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  function initGate(root) {
    var mode = root.getAttribute('data-mode') || 'single';
    var panels = {
      email: root.querySelector('[data-gate-panel="email"]'),
      code: root.querySelector('[data-gate-panel="code"]'),
      done: root.querySelector('[data-gate-panel="done"]')
    };
    var steps = {
      email: root.querySelector('[data-step-indicator="email"]'),
      code: root.querySelector('[data-step-indicator="code"]'),
      done: root.querySelector('[data-step-indicator="done"]')
    };
    var emailInput = panels.email.querySelector('input[name="email"]');
    var newsInput = panels.email.querySelector('input[name="news"]');
    var codeInput = panels.code.querySelector('input[name="code"]');
    var submitEmailBtn = panels.email.querySelector('[data-gate-submit-email]');
    var resendBtn = panels.code.querySelector('[data-gate-resend]');
    var changeEmailBtn = panels.code.querySelector('[data-gate-change-email]');
    var resetBtn = panels.done.querySelector('[data-gate-reset]');
    var demoBox = panels.code.querySelector('[data-gate-demo]');
    var demoCodeEl = panels.code.querySelector('[data-gate-demo-code]');

    var pending = null; // { code, exp }
    var demo = '';
    var attempts = 0;
    var cooldownTimer = null;
    var email = '';

    function setStep(name) {
      ['email', 'code', 'done'].forEach(function (k) {
        if (panels[k]) panels[k].hidden = k !== name;
        if (steps[k]) {
          steps[k].classList.remove('step--current', 'step--done');
          var order = { email: 0, code: 1, done: 2 };
          if (k === name) steps[k].classList.add('step--current');
          else if (order[k] < order[name]) steps[k].classList.add('step--done');
        }
      });
    }

    function showError(panel, msg) {
      var err = panel.querySelector('[data-gate-error]');
      var info = panel.querySelector('[data-gate-info]');
      if (info) info.hidden = true;
      if (err) { err.hidden = !msg; err.textContent = msg || ''; }
    }
    function showInfo(panel, msg) {
      var err = panel.querySelector('[data-gate-error]');
      var info = panel.querySelector('[data-gate-info]');
      if (err) err.hidden = true;
      if (info) { info.hidden = !msg; info.textContent = msg || ''; }
    }

    function setEmailEcho() {
      root.querySelectorAll('[data-gate-email-echo]').forEach(function (el) { el.textContent = email; });
    }

    function startCooldown() {
      var left = 30;
      clearInterval(cooldownTimer);
      updateResend(left);
      cooldownTimer = setInterval(function () {
        left -= 1;
        if (left <= 0) { clearInterval(cooldownTimer); updateResend(0); return; }
        updateResend(left);
      }, 1000);
    }
    function updateResend(left) {
      if (!resendBtn) return;
      resendBtn.disabled = left > 0;
      resendBtn.textContent = left > 0 ? 'Reenviar en ' + left + 's' : 'Reenviar código';
    }

    async function sendCode(addr) {
      var code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
      pending = { code: code, exp: Date.now() + 10 * 60 * 1000 };
      var sent = false;
      if (typeof window.ZD_SEND_CODE === 'function') {
        try {
          await window.ZD_SEND_CODE(addr, code);
          sent = true;
        } catch (e) {
          throw new Error('No pudimos enviar el mail. Probá de nuevo en un momento.');
        }
      }
      demo = sent ? '' : code;
      if (demoBox) {
        demoBox.hidden = !demo;
        if (demoCodeEl) demoCodeEl.textContent = demo;
      }
      startCooldown();
    }

    panels.email.addEventListener('submit', async function (e) {
      e.preventDefault();
      var addr = emailInput.value.trim().toLowerCase();
      var domain = addr.split('@')[1] || '';
      if (!RE.test(addr)) return showError(panels.email, 'Ese mail no tiene un formato válido.');
      if (TYPOS[domain]) return showError(panels.email, '¿Quisiste decir ' + addr.split('@')[0] + '@' + TYPOS[domain] + '?');
      if (DISPOSABLE.indexOf(domain) !== -1) return showError(panels.email, 'No aceptamos mails temporales. Usá uno propio.');
      submitEmailBtn.disabled = true;
      submitEmailBtn.textContent = 'VERIFICANDO…';
      showError(panels.email, '');
      var mx = await hasMx(domain);
      if (mx === false) {
        submitEmailBtn.disabled = false;
        submitEmailBtn.textContent = 'ENVIARME EL CÓDIGO';
        return showError(panels.email, 'El dominio ' + domain + ' no recibe mails.');
      }
      try {
        await sendCode(addr);
      } catch (err) {
        submitEmailBtn.disabled = false;
        submitEmailBtn.textContent = 'ENVIARME EL CÓDIGO';
        return showError(panels.email, err.message);
      }
      email = addr;
      attempts = 0;
      submitEmailBtn.disabled = false;
      submitEmailBtn.textContent = 'ENVIARME EL CÓDIGO';
      codeInput.value = '';
      setEmailEcho();
      setStep('code');
      if (mx === null) showInfo(panels.code, 'No pudimos chequear el dominio; el código confirma que el mail es tuyo.');
      codeInput.focus();
    });

    panels.code.addEventListener('submit', function (e) {
      e.preventDefault();
      var code = codeInput.value.trim();
      if (!pending) return showError(panels.code, 'Pedí un código nuevo.');
      if (Date.now() > pending.exp) return showError(panels.code, 'El código venció. Pedí uno nuevo.');
      if (attempts >= 5) return showError(panels.code, 'Demasiados intentos. Pedí un código nuevo.');
      if (code !== pending.code) {
        attempts += 1;
        return showError(panels.code, 'Código incorrecto. Te quedan ' + (5 - attempts) + ' intentos.');
      }
      pending = null;
      demo = '';
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ email: email, news: !!newsInput.checked, at: new Date().toISOString() }));
      } catch (e2) {}
      showError(panels.code, '');
      setEmailEcho();
      setStep('done');
    });

    if (resendBtn) {
      resendBtn.addEventListener('click', async function () {
        if (resendBtn.disabled) return;
        try {
          await sendCode(email);
          codeInput.value = '';
          attempts = 0;
          showError(panels.code, '');
          showInfo(panels.code, 'Te mandamos un código nuevo.');
        } catch (err) {
          showError(panels.code, err.message);
        }
      });
    }

    if (changeEmailBtn) {
      changeEmailBtn.addEventListener('click', function () {
        pending = null;
        showError(panels.code, '');
        setStep('email');
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        email = '';
        emailInput.value = '';
        codeInput.value = '';
        showError(panels.email, '');
        setStep('email');
      });
    }

    // Restaurar verificación previa sin pedir el código de nuevo.
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && saved.email) {
        email = saved.email;
        setEmailEcho();
        setStep('done');
        return;
      }
    } catch (e) {}
    setStep('email');
  }

  document.querySelectorAll('[data-mail-gate]').forEach(initGate);
})();
