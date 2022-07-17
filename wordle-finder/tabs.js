function changeTabs(e) {
  var target = e.target;
  var parent = target.parentNode;
  var grandparent = parent.parentNode;

  // Remove all current selected tabs
  parent.querySelectorAll('[aria-selected="true"]').forEach(function (t) {
    return t.setAttribute('aria-selected', false);
  });

  // Set this tab as selected
  target.setAttribute('aria-selected', true);

  // Hide all tab panels
  grandparent.querySelectorAll('[role="tabpanel"]').forEach(function (p) {
    return p.setAttribute('hidden', true);
  });

  // Show the selected panel
  var panel = grandparent.parentNode
    .querySelector('#' + target.getAttribute('aria-controls'));
  panel.removeAttribute('hidden');
  panel.parentNode.scrollTop = 0;
  var tabName = panel.getAttribute('aria-labelledby');
  gtag('event', 'changeTab', {
    event_category: 'user_action',
    event_label: tabName
  });
}

function updateTabContent(tabId, html) {
  var tab = document.getElementById(tabId)
  if (tab) {
    tab.innerHTML = html;
  }
}

function initTabs() {
  var tabs = document.querySelectorAll('[role="tab"]');
  var tabList = document.querySelector('[role="tablist"]');

  // Add a click event handler to each tab
  tabs.forEach(function (tab) {
    tab.addEventListener('click', changeTabs);
  });
}
