import Chart from 'chart.js/auto';

const LIVE_REFRESH_MS = 60000;
const PAGE_KEY = 'analytics';

/** @type {Map<string, { shortName: string, name: string, icon: string, path: string }>} */
let appMeta = new Map();

/** @type {Array<{ date: string, page: string, peak: number, sum: number, samples: number, avg: number }>} */
let analyticsRows = [];

/** @type {Chart | null} */
let siteChart = null;
/** @type {Chart | null} */
let appChart = null;

let rankDays = 7;

function labelForPage(page) {
  if (page === '_total') return 'Entire site';
  if (page === 'home') return 'Home';
  if (page === 'os') return 'Heyming OS';
  const meta = appMeta.get(page);
  if (meta) return meta.shortName || meta.name || page;
  return page;
}

function pathForPage(page) {
  const meta = appMeta.get(page);
  if (!meta || !meta.path) return null;
  const p = meta.path;
  return p.startsWith('./') ? '/' + p.slice(2) : p;
}

async function loadRegistry() {
  try {
    const res = await fetch('/apps-registry.json', { cache: 'default' });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data)) return;
    const map = new Map();
    for (const app of data) {
      if (!app || !app.id) continue;
      map.set(app.id, {
        shortName: app.shortName || app.name || app.id,
        name: app.name || app.id,
        icon: app.icon || '',
        path: app.path || ''
      });
    }
    appMeta = map;
  } catch {
    // Registry is optional for labels.
  }
}

function ensurePresence() {
  return window.heymingPresence && typeof window.heymingPresence.isConfigured === 'function'
    ? window.heymingPresence
    : null;
}

/** @returns {string | null} User-facing reason charts cannot load, or null when ready. */
function presenceBlockReason() {
  const api = ensurePresence();
  if (!api) return 'Couldn’t load presence data. Try reloading the page.';
  if (!api.isConfigured()) return 'Presence isn’t set up on this site yet.';
  if (typeof api.fetchAnalytics !== 'function') {
    return 'Couldn’t load presence data. Try reloading the page.';
  }
  return null;
}

function waitForPresence(maxMs = 8000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (!presenceBlockReason()) {
        resolve(ensurePresence());
        return;
      }
      if (Date.now() - start >= maxMs) {
        resolve(ensurePresence());
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function brandColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function chartDefaults() {
  Chart.defaults.color = brandColor('--text-2', '#555555');
  Chart.defaults.borderColor = brandColor('--hairline', '#e5e5e0');
  Chart.defaults.font.family = brandColor(
    '--font-ui',
    "system-ui, -apple-system, 'Segoe UI', Roboto, Verdana, sans-serif"
  );
}

/**
 * @param {Array<{ date: string, page: string, peak: number, avg: number }>} rows
 * @param {string} page
 */
function seriesForPage(rows, page) {
  const byDate = rows
    .filter((r) => r.page === page)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    labels: byDate.map((r) => r.date),
    peak: byDate.map((r) => r.peak),
    avg: byDate.map((r) => Math.round(r.avg * 100) / 100)
  };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ labels: string[], peak: number[], avg: number[] }} series
 * @param {Chart | null} existing
 */
function renderLineChart(canvas, series, existing) {
  const peak = brandColor('--accent-blue', '#1a73e8');
  const avg = brandColor('--accent-green', '#34a853');
  const hairline = brandColor('--hairline', '#e5e5e0');

  const data = {
    labels: series.labels,
    datasets: [
      {
        label: 'Peak',
        data: series.peak,
        borderColor: peak,
        backgroundColor: 'transparent',
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
        fill: false
      },
      {
        label: 'Average',
        data: series.avg,
        borderColor: avg,
        backgroundColor: 'transparent',
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
        fill: false
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'circle' }
      },
      tooltip: {
        callbacks: {
          label(ctx) {
            const v = ctx.parsed.y;
            return `${ctx.dataset.label}: ${Number.isInteger(v) ? v : v.toFixed(2)}`;
          }
        }
      }
    },
    scales: {
      x: {
        ticks: {
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8
        },
        grid: { display: false }
      },
      y: {
        beginAtZero: true,
        ticks: {
          precision: 0
        },
        grid: { color: hairline }
      }
    }
  };

  if (existing) {
    existing.destroy();
  }
  return new Chart(canvas, { type: 'line', data, options });
}

function setStatus(id, message, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('is-error');
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.classList.toggle('is-error', Boolean(isError));
}

async function refreshLive() {
  const api = ensurePresence();
  const totalEl = document.getElementById('live-total');
  const listEl = document.getElementById('live-list');
  const blocked = presenceBlockReason();
  if (blocked) {
    if (totalEl) totalEl.textContent = 'offline';
    if (listEl) {
      listEl.innerHTML = '';
      const li = document.createElement('li');
      li.className = 'live-empty';
      li.textContent = blocked;
      listEl.appendChild(li);
    }
    return;
  }

  try {
    const counts = await api.fetchCounts(PAGE_KEY);
    const entries = Object.entries(counts || {}).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
    // fetchCounts excludes self on current page; add 1 for this viewer on the site total.
    let total = 0;
    for (const [, n] of entries) total += n;
    total += 1;

    if (totalEl) {
      totalEl.textContent = total === 1 ? '1 person here' : `${total} people here`;
    }

    if (!listEl) return;
    if (!entries.length) {
      listEl.innerHTML = '<li class="live-empty">Just you right now.</li>';
      return;
    }

    listEl.innerHTML = '';
    for (const [page, n] of entries) {
      const li = document.createElement('li');
      li.className = 'live-item';
      const name = document.createElement('span');
      name.className = 'live-item-name';
      const href = pathForPage(page);
      if (href && page !== PAGE_KEY) {
        const a = document.createElement('a');
        a.href = href;
        a.textContent = labelForPage(page);
        name.appendChild(a);
      } else {
        name.textContent = labelForPage(page);
      }
      const count = document.createElement('span');
      count.className = 'live-item-count';
      count.textContent = String(n);
      li.appendChild(name);
      li.appendChild(count);
      listEl.appendChild(li);
    }
  } catch (err) {
    console.warn('[analytics] live fetch failed', err);
    if (totalEl) totalEl.textContent = 'unavailable';
    if (listEl) {
      listEl.innerHTML = '<li class="live-empty">Could not load live presence.</li>';
    }
  }
}

function populateAppSelect(rows) {
  const select = document.getElementById('app-select');
  if (!select) return;

  const pages = [...new Set(rows.map((r) => r.page).filter((p) => p && p !== '_total'))].sort(
    (a, b) => labelForPage(a).localeCompare(labelForPage(b))
  );

  select.innerHTML = '';
  if (!pages.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No app data yet';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  for (const page of pages) {
    const opt = document.createElement('option');
    opt.value = page;
    opt.textContent = labelForPage(page);
    select.appendChild(opt);
  }

  // Prefer a popular app if present.
  const preferred = ['doom', 'watch', 'stepmania', 'home', 'os'];
  const pick = preferred.find((p) => pages.includes(p)) || pages[0];
  select.value = pick;
  select.disabled = false;
}

function renderSiteChart() {
  const canvas = document.getElementById('site-chart');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const series = seriesForPage(analyticsRows, '_total');
  if (!series.labels.length) {
    setStatus('site-chart-status', 'No site-wide history yet. Check back in a few days.', false);
    if (siteChart) {
      siteChart.destroy();
      siteChart = null;
    }
    return;
  }
  setStatus('site-chart-status', '');
  siteChart = renderLineChart(canvas, series, siteChart);
}

function renderAppChart() {
  const canvas = document.getElementById('app-chart');
  const select = document.getElementById('app-select');
  if (!(canvas instanceof HTMLCanvasElement) || !select) return;
  const page = select.value;
  if (!page) {
    setStatus('app-chart-status', 'Pick an app to chart.', false);
    return;
  }
  const series = seriesForPage(analyticsRows, page);
  if (!series.labels.length) {
    setStatus('app-chart-status', `No history for ${labelForPage(page)} yet.`, false);
    if (appChart) {
      appChart.destroy();
      appChart = null;
    }
    return;
  }
  setStatus('app-chart-status', '');
  appChart = renderLineChart(canvas, series, appChart);
}

function dayCutoff(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return (
    String(y).padStart(4, '0') +
    '-' +
    String(m).padStart(2, '0') +
    '-' +
    String(day).padStart(2, '0')
  );
}

function renderRankTable() {
  const body = document.getElementById('rank-body');
  if (!body) return;

  const cutoff = dayCutoff(rankDays);
  /** @type {Map<string, { sumAvg: number, peak: number, days: number }>} */
  const byPage = new Map();

  for (const row of analyticsRows) {
    if (row.page === '_total') continue;
    if (row.date < cutoff) continue;
    let entry = byPage.get(row.page);
    if (!entry) {
      entry = { sumAvg: 0, peak: 0, days: 0 };
      byPage.set(row.page, entry);
    }
    entry.sumAvg += row.avg;
    entry.peak = Math.max(entry.peak, row.peak);
    entry.days += 1;
  }

  const ranked = [...byPage.entries()]
    .map(([page, e]) => ({
      page,
      avg: e.days > 0 ? e.sumAvg / e.days : 0,
      peak: e.peak,
      days: e.days
    }))
    .sort((a, b) => b.avg - a.avg || b.peak - a.peak || a.page.localeCompare(b.page))
    .slice(0, 15);

  body.innerHTML = '';
  if (!ranked.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.textContent = 'No ranking data for this window yet.';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  ranked.forEach((row, i) => {
    const tr = document.createElement('tr');
    const cells = [
      String(i + 1),
      labelForPage(row.page),
      row.avg < 10 ? row.avg.toFixed(2) : String(Math.round(row.avg * 10) / 10),
      String(row.peak),
      String(row.days)
    ];
    cells.forEach((text, idx) => {
      const td = document.createElement('td');
      if (idx === 1) {
        const href = pathForPage(row.page);
        if (href) {
          const a = document.createElement('a');
          a.href = href;
          a.textContent = text;
          td.appendChild(a);
        } else {
          td.textContent = text;
        }
      } else {
        td.textContent = text;
      }
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

async function loadAnalyticsHistory() {
  const api = ensurePresence();
  const blocked = presenceBlockReason();
  if (blocked || !api) {
    setStatus('site-chart-status', blocked || 'Presence unavailable.', true);
    setStatus('app-chart-status', blocked || 'Presence unavailable.', true);
    const body = document.getElementById('rank-body');
    if (body) {
      body.innerHTML = '';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = blocked || 'Presence unavailable.';
      tr.appendChild(td);
      body.appendChild(tr);
    }
    return;
  }

  try {
    analyticsRows = await api.fetchAnalytics();
    populateAppSelect(analyticsRows);
    renderSiteChart();
    renderAppChart();
    renderRankTable();
  } catch (err) {
    console.warn('[analytics] history fetch failed', err);
    setStatus('site-chart-status', 'Could not load presence history.', true);
    setStatus('app-chart-status', 'Could not load presence history.', true);
    const body = document.getElementById('rank-body');
    if (body) {
      body.innerHTML = '<tr><td colspan="5">Could not load presence history.</td></tr>';
    }
  }
}

function wireUi() {
  const select = document.getElementById('app-select');
  if (select) {
    select.addEventListener('change', () => {
      renderAppChart();
      if (typeof window.trackEvent === 'function') {
        window.trackEvent('analytics_app_select', 'Presence', select.value);
      }
    });
  }

  document.querySelectorAll('.range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const days = Number(btn.getAttribute('data-days')) || 7;
      rankDays = days;
      document
        .querySelectorAll('.range-btn')
        .forEach((b) => b.classList.toggle('is-active', b === btn));
      renderRankTable();
      if (typeof window.trackEvent === 'function') {
        window.trackEvent('analytics_rank_range', 'Presence', String(days));
      }
    });
  });
}

async function boot() {
  chartDefaults();
  wireUi();
  await loadRegistry();

  // Presence scripts are loaded in index.html.
  const api = await waitForPresence();
  if (api && typeof api.start === 'function') {
    api.start(PAGE_KEY);
  }
  await Promise.all([refreshLive(), loadAnalyticsHistory()]);

  setInterval(() => {
    refreshLive();
  }, LIVE_REFRESH_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshLive();
  });
}

boot();
