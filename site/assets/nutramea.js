// Header disclosure and subscribe validation. Nothing else runs on this page.
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.getElementById('menu-toggle');
    var nav = document.getElementById('site-nav');

    if (toggle && nav) {
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

    var form = document.getElementById('subscribe-form');

    if (form) {
      var email = form.querySelector('#email');
      var error = form.querySelector('#email-error');

      form.addEventListener('submit', function (event) {
        var valid = email.value.trim() !== '' && email.checkValidity();
        email.setAttribute('aria-invalid', String(!valid));
        error.hidden = valid;

        if (!valid) {
          event.preventDefault();
          email.focus();
        }
      });

      email.addEventListener('input', function () {
        if (email.getAttribute('aria-invalid') === 'true' && email.checkValidity()) {
          email.setAttribute('aria-invalid', 'false');
          error.hidden = true;
        }
      });
    }
  });
})();
