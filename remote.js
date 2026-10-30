// Keyboard access shared by every page.
//
// Arrow keys move focus between controls in any browser and at any window
// size. A button, link, or closed select does not keep the arrow. Space,
// Enter, and a remote OK activate a select or autocomplete; arrows never do.
// Up and Down leave a number, a slider, or a one-line field. Left and Right
// still edit those. A game surface keeps its arrows. Play and Pause hit the
// play control.
(function () {
  'use strict';

  if (window.heymingRemote) return;

  var MEDIA_KEYS = {
    MediaPlay: 'play',
    MediaPlayPause: 'toggle',
    MediaPause: 'pause'
  };

  // Vendor keyCodes that do not overlap a letter. 19 is both Pause and ArrowUp.
  var MEDIA_CODES = { 179: 'toggle', 415: 'play', 10252: 'toggle' };

  function mediaAction(event) {
    if (MEDIA_KEYS[event.key]) return MEDIA_KEYS[event.key];
    if (event.key && event.key !== 'Unidentified') return '';
    return MEDIA_CODES[event.keyCode] || '';
  }

  function typing(target) {
    if (!target || !target.tagName) return false;
    var tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return !!target.isContentEditable;
  }

  function hidden(el) {
    if (!el || el.hidden || el.disabled) return true;
    if (el.closest && el.closest('[hidden]')) return true;
    var style = getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden';
  }

  function playLabel(el) {
    var idClass = (el.id || '') + ' ' + (el.className || '');
    if (
      /(?:^|[\s_-])(btn-play|play-btn|playbtn|btnplay|play-pause|playpause|pause-btn|btn-pause|pausebtn)(?:$|[\s_-])/i.test(
        idClass
      )
    ) {
      return true;
    }
    var label = (
      (el.getAttribute('aria-label') || '') +
      ' ' +
      (el.getAttribute('title') || '')
    ).trim();
    if (/^(?:play|pause)(?:\s*\/\s*(?:play|pause))?$/i.test(label)) return true;
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length > 48) return false;
    return /^(?:[\s▶►⏸⏯⏩⏪🎵]*)(play|pause)(?:\s*\/\s*(play|pause))?\s*$/i.test(text);
  }

  function collectControls(root, out) {
    var nodes = root.querySelectorAll('button, a[href], [role="button"]');
    for (var i = 0; i < nodes.length; i += 1) out.push(nodes[i]);
    var all = root.querySelectorAll('*');
    for (var j = 0; j < all.length; j += 1) {
      if (all[j].shadowRoot) collectControls(all[j].shadowRoot, out);
    }
  }

  function findPlayControl() {
    var controls = [];
    collectControls(document, controls);
    var focused = document.activeElement;
    if (focused && controls.indexOf(focused) !== -1 && playLabel(focused) && !hidden(focused)) {
      return focused;
    }
    for (var i = 0; i < controls.length; i += 1) {
      if (playLabel(controls[i]) && !hidden(controls[i])) return controls[i];
    }
    return null;
  }

  function onKeyDown(event) {
    if (event.defaultPrevented || typing(event.target)) return;
    var action = mediaAction(event);
    if (!action) return;
    var play = findPlayControl();
    if (!play) return;
    event.preventDefault();
    play.click();
  }

  function onActivate(event) {
    if (event.defaultPrevented || event.repeat) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // A key that starts inside a shadow input retargets to the host.
    // Space and Enter still belong to that input. OK on the host itself
    // (the remote focuses the host) opens the widget.
    var path = typeof event.composedPath === 'function' ? event.composedPath() : null;
    var inner = path && path.length ? path[0] : event.target;
    if (!inner || inner.nodeType !== 1) return;
    var tag = inner.tagName;
    if (
      tag === 'BUTTON' ||
      tag === 'A' ||
      tag === 'INPUT' ||
      tag === 'SELECT' ||
      tag === 'TEXTAREA' ||
      tag === 'SUMMARY'
    ) {
      return;
    }
    if (inner.isContentEditable) return;
    var el = event.target;
    if (!el || el.nodeType !== 1 || typeof el.getAttribute !== 'function') return;
    var tabindex = el.getAttribute('tabindex');
    if (tabindex === null || tabindex.trim() === '' || Number(tabindex) < 0) return;
    event.preventDefault();
    el.click();
  }

  /**
   * True when a page shortcut should leave this arrow alone.
   * A button, link, field, or widget qualifies. The page background does not:
   * a game or a player still receives arrows from there.
   *
   * @param {KeyboardEvent} event
   * @returns {boolean}
   */
  function arrowsMoveFocus(event) {
    if (!/^arrow/i.test(event.key || '')) return false;
    var el = eventTargetElement(event);
    if (!el || !el.tagName) return false;
    var tag = el.tagName;
    if (tag === 'BODY' || tag === 'HTML') return false;
    if (
      tag === 'BUTTON' ||
      tag === 'A' ||
      tag === 'INPUT' ||
      tag === 'SELECT' ||
      tag === 'TEXTAREA' ||
      tag === 'SUMMARY' ||
      el.isContentEditable
    ) {
      return true;
    }
    var tabindex = el.getAttribute && el.getAttribute('tabindex');
    return tabindex !== null && tabindex !== '' && Number(tabindex) >= 0;
  }

  function eventTargetElement(event) {
    var path = typeof event.composedPath === 'function' ? event.composedPath() : null;
    var el = path && path.length ? path[0] : event.target;
    if (!el || el.nodeType !== 1) return null;
    return el;
  }

  function isFocusable(el) {
    if (!el || el.disabled || el.hidden) return false;
    if (el.closest && el.closest('[hidden], [inert]')) return false;
    var tag = el.tagName;
    if (tag === 'INPUT' && el.type === 'hidden') return false;
    var tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && Number(tabindex) < 0) return false;
    var native =
      tag === 'BUTTON' ||
      tag === 'A' ||
      tag === 'INPUT' ||
      tag === 'SELECT' ||
      tag === 'TEXTAREA' ||
      tag === 'SUMMARY';
    if (!native && (tabindex === null || tabindex === '')) return false;
    var style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function focusableList() {
    var nodes = document.querySelectorAll(
      'button, a[href], input, select, textarea, summary, [tabindex]'
    );
    var out = [];
    for (var i = 0; i < nodes.length; i += 1) {
      if (isFocusable(nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  /**
   * Move focus to the nearest control in this arrow's direction.
   * With no layout boxes, fall back to tab order.
   */
  function moveFocus(from, key) {
    var list = focusableList();
    var index = list.indexOf(from);
    if (index < 0) return;
    var origin = from.getBoundingClientRect();
    var vertical = key === 'ArrowUp' || key === 'ArrowDown';
    var forward = key === 'ArrowDown' || key === 'ArrowRight';
    var best = null;
    var bestScore = Infinity;
    if (origin.width >= 2 && origin.height >= 2) {
      for (var i = 0; i < list.length; i += 1) {
        var el = list[i];
        if (el === from) continue;
        var rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        var ahead = vertical
          ? forward
            ? rect.top >= origin.bottom - 4
            : rect.bottom <= origin.top + 4
          : forward
          ? rect.left >= origin.right - 4
          : rect.right <= origin.left + 4;
        if (!ahead) continue;
        var primary = vertical
          ? forward
            ? rect.top - origin.bottom
            : origin.top - rect.bottom
          : forward
          ? rect.left - origin.right
          : origin.left - rect.right;
        var secondary = vertical
          ? rect.left + rect.width / 2 - (origin.left + origin.width / 2)
          : rect.top + rect.height / 2 - (origin.top + origin.height / 2);
        var score = Math.max(0, primary) + Math.abs(secondary) * 0.15;
        if (score < bestScore) {
          bestScore = score;
          best = el;
        }
      }
    }
    if (!best) {
      var next = index + (forward ? 1 : -1);
      if (next >= 0 && next < list.length) best = list[next];
    }
    if (best) best.focus();
  }

  // A closed select changes its value on an arrow and never shows the list.
  // Move focus instead. Space, Enter, and a remote OK still open it.
  function nativePicker(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'SELECT') return !el.multiple && !(el.size > 1);
    if (el.tagName !== 'INPUT') return false;
    var type = (el.type || '').toLowerCase();
    return (
      type === 'date' ||
      type === 'time' ||
      type === 'datetime-local' ||
      type === 'month' ||
      type === 'week' ||
      type === 'color'
    );
  }

  function singleLineText(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    var type = (el.type || 'text').toLowerCase();
    return (
      type === 'text' ||
      type === 'search' ||
      type === 'email' ||
      type === 'url' ||
      type === 'tel' ||
      type === 'password'
    );
  }

  function plainArrow(event) {
    return (
      /^arrow/i.test(event.key || '') &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    );
  }

  function takeArrow(event, el) {
    event.preventDefault();
    event.stopPropagation();
    moveFocus(el, event.key);
  }

  // Page shortcuts listen on document or window and preventDefault every
  // arrow. Stop those for a real control, and move focus here, because a
  // normal browser does not move focus on arrows. A game board is a div or
  // canvas, so it still receives the arrow.
  document.addEventListener(
    'keydown',
    function (event) {
      if (!plainArrow(event)) return;
      var el = eventTargetElement(event);
      if (!el) return;
      var tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || nativePicker(el)) {
        takeArrow(event, el);
        return;
      }
      if (
        tag === 'INPUT' &&
        (el.type === 'range' || el.type === 'number') &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        // Up and Down would spin the number or the slider and cancel
        // focus movement. Left and Right still edit it.
        takeArrow(event, el);
      }
    },
    true
  );

  // A custom menu and a text field handle their own arrows first. If they
  // did not claim the key, move focus. An open menu sets heymingNavigate
  // when an arrow should leave it.
  document.addEventListener('keydown', function (event) {
    if (!plainArrow(event) || event.defaultPrevented) return;
    var el = eventTargetElement(event);
    if (!el) return;
    var custom = el.tagName.indexOf('-') !== -1;
    var leaveField = singleLineText(el) && (event.key === 'ArrowUp' || event.key === 'ArrowDown');
    if (!event.heymingNavigate && !custom && !leaveField) return;
    if (custom) {
      var tabindex = el.getAttribute('tabindex');
      if (tabindex === null || tabindex === '' || Number(tabindex) < 0) return;
    }
    takeArrow(event, el);
  });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keydown', onActivate);

  var style = document.createElement('style');
  // Keyboard focus is visible everywhere. A component that already styles
  // :focus-visible keeps its own ring; this only fills the gap.
  style.textContent = ':focus-visible{outline:3px solid #ffbf47;outline-offset:3px;}';
  document.head.appendChild(style);

  window.heymingRemote = {
    arrowsMoveFocus: arrowsMoveFocus,
    moveFocus: function (event) {
      var el = eventTargetElement(event);
      if (!el || !plainArrow(event)) return;
      takeArrow(event, el);
    }
  };
})();
