// Header disclosure and subscribe form. Nothing else runs on these pages.
(function () {
  'use strict';

  function setupMenu() {
    var toggle = document.getElementById('menu-toggle');
    var nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;

    var openIcon = toggle.querySelector('[data-icon="open"]');
    var closeIcon = toggle.querySelector('[data-icon="close"]');

    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      nav.setAttribute('data-open', String(open));
      openIcon.hidden = open;
      closeIcon.hidden = !open;
    });
  }

  function setupSubscribe() {
    var form = document.getElementById('subscribe-form');
    if (!form) return;

    var email = form.querySelector('#email');
    var error = form.querySelector('#email-error');
    var status = form.querySelector('#subscribe-status');
    var button = form.querySelector('#subscribe-button');
    var buttonLabel = button.textContent;

    function show(state, message) {
      status.hidden = false;
      status.setAttribute('data-state', state);
      status.textContent = message;
    }

    function finish() {
      button.disabled = false;
      button.textContent = buttonLabel;
    }

    email.addEventListener('input', function () {
      if (email.getAttribute('aria-invalid') === 'true' && email.checkValidity()) {
        email.setAttribute('aria-invalid', 'false');
        error.hidden = true;
      }
    });

    form.addEventListener('submit', function (event) {
      var valid = email.value.trim() !== '' && email.checkValidity();
      email.setAttribute('aria-invalid', String(!valid));
      error.hidden = valid;

      if (!valid) {
        event.preventDefault();
        status.hidden = true;
        email.focus();
        return;
      }

      // Without fetch the browser posts the form itself, which still works.
      if (!window.fetch) return;

      event.preventDefault();
      button.disabled = true;
      button.textContent = button.getAttribute('data-sending');
      show('sending', button.getAttribute('data-sending'));

      fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email: email.value.trim() })
      })
        .then(function (response) {
          if (!response.ok) throw new Error(String(response.status));
          show('ok', status.getAttribute('data-ok'));
          form.reset();
        })
        .catch(function () {
          show('failed', status.getAttribute('data-failed'));
        })
        .then(finish);
    });
  }

  // Nothing is requested from YouTube until someone presses play.
  function setupPlayers() {
    var buttons = document.querySelectorAll('.play');

    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener('click', function () {
        var frame = document.createElement('iframe');
        frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(button.getAttribute('data-video')) + '?autoplay=1';
        frame.title = button.getAttribute('data-title');
        frame.allow = 'accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen';
        frame.allowFullscreen = true;
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        button.parentNode.replaceChild(frame, button);
        frame.focus();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    setupMenu();
    setupSubscribe();
    setupPlayers();
  });
})();
