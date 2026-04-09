/**
 * PolyScan — Frontend Application v3.0
 * Loads leaderboard.json and renders an interactive multi-category dashboard
 */

// ── State ────────────────────────────────────────────────────────────────────
let DATA            = null;
let currentCategory = 'OVERALL';
let currentSort     = { key: 'compositeScore', dir: 'desc' };
let expandedWallet  = null;

// ── Column definitions ───────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'rank',                      label: '#',                   type: 'rank',   sortable: true,  width: '36px' },
  { key: 'userName',                  label: 'Trader',              type: 'trader', sortable: true },
  { key: 'compositeScore',            label: 'Score',               type: 'score',  sortable: true,  width: '120px' },
  { key: 'metrics.roiPct',            label: 'ROI %',               type: 'pct',    sortable: true },
  { key: 'metrics.winRate',           label: 'Win Rate',            type: 'pct',    sortable: true },
  { key: 'metrics.dayPnl',            label: 'PnL 1D',              type: 'money',  sortable: true },
  { key: 'metrics.weekPnl',           label: 'PnL 7D',              type: 'money',  sortable: true },
  { key: 'metrics.monthPnl',          label: 'PnL 30D',             type: 'money',  sortable: true },
  { key: 'metrics.totalPnl',          label: 'PnL All',             type: 'money',  sortable: true },
  { key: 'metrics.totalVolume',       label: 'Volume',              type: 'money',  sortable: true },
  { key: 'metrics.activePositions',   label: 'Active Pos.',         type: 'num',    sortable: true },
  { key: 'metrics.diversification',   label: 'Markets',             type: 'num',    sortable: true },
  { key: 'metrics.medianPositionSize',label: 'Med. Size',           type: 'money',  sortable: true },
  { key: 'metrics.consistencyScore',  label: 'Consistency',         type: 'pct',    sortable: true },
  { key: 'leaderboardRanks',          label: 'LB Ranks (D/W/M/A)', type: 'ranks',  sortable: false },
  { key: '_copy',                     label: 'Wallet',              type: 'copy',   sortable: false },
];

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const res = await fetch('data/leaderboard.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
    showContent();
  } catch (err) {
    showError(err.message);
  }
}

// ── Helpers to get current category data ─────────────────────────────────────
function getCatData() {
  return DATA.categories?.[currentCategory] || null;
}

function getCatTraders() {
  return getCatData()?.traders || [];
}

// ── Render ───────────────────────────────────────────────────────────────────
function showContent() {
  document.getElementById('loading-state').style.display        = 'none';
  document.getElementById('content').style.display              = 'block';
  document.getElementById('category-tabs-wrapper').style.display = 'block';

  const date = new Date(DATA.generatedAt);
  document.getElementById('update-time').textContent = date.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  document.getElementById('candidates-count').textContent = DATA.totalCandidatesAnalyzed;
  document.getElementById('status-badge').textContent     = '● Live';
  startNextRefreshCountdown(new Date(DATA.generatedAt));

  renderWeights();
  renderCategoryTabs();
  renderTableHeader();
  renderTableBody();
  updateCategoryMeta();

  setupLegendToggle();
  document.getElementById('detail-close-btn').addEventListener('click', closeDetail);
}

function showError(msg) {
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('error-state').style.display   = 'block';
  document.getElementById('error-message').textContent   = msg;
  document.getElementById('status-badge').textContent    = '● Error';
  document.getElementById('status-badge').style.color    = 'var(--red)';
}

// ── Category tabs ─────────────────────────────────────────────────────────────
function renderCategoryTabs() {
  const container = document.getElementById('category-tabs');
  container.innerHTML = '';

  for (const [id, cat] of Object.entries(DATA.categories)) {
    const btn = document.createElement('button');
    btn.className   = 'cat-tab' + (id === currentCategory ? ' active' : '');
    btn.dataset.cat = id;
    btn.innerHTML   = `
      <span class="cat-tab-icon">${cat.icon}</span>
      ${cat.label}
      <span class="cat-tab-count">${cat.traders?.length ?? 0}</span>`;
    btn.addEventListener('click', () => selectCategory(id));
    container.appendChild(btn);
  }
}

function selectCategory(id) {
  if (id === currentCategory) return;
  currentCategory = id;
  expandedWallet  = null;
  document.getElementById('detail-panel').style.display = 'none';

  // Update active tab
  for (const btn of document.querySelectorAll('.cat-tab')) {
    btn.classList.toggle('active', btn.dataset.cat === id);
  }

  updateCategoryMeta();
  renderTableBody();
}

function updateCategoryMeta() {
  const cat = getCatData();
  document.getElementById('scored-count').textContent = cat?.scoredCount ?? '—';
}

// ── Scoring legend ────────────────────────────────────────────────────────────
function renderWeights() {
  const grid = document.getElementById('weights-grid');
  if (!DATA.scoringWeights) return;
  const labels = {
    roiPct:              'ROI %',
    monthPnl:            'PnL (30 days)',
    weekPnl:             'PnL (7 days)',
    dayPnl:              'PnL (24h)',
    consistency:         'Consistency',
    winRate:             'Win Rate',
    activity:            'Activity Level',
    budgetCompatibility: 'Budget Fit',
  };
  for (const [key, pct] of Object.entries(DATA.scoringWeights)) {
    const chip = document.createElement('div');
    chip.className = 'weight-chip';
    chip.innerHTML = `<span class="weight-pct">${pct}</span><span class="weight-name">${labels[key] || key}</span>`;
    grid.appendChild(chip);
  }
}

function setupLegendToggle() {
  const panel  = document.getElementById('scoring-legend');
  const toggle = document.getElementById('legend-toggle');
  toggle.addEventListener('click', () => panel.classList.toggle('collapsed'));
  panel.classList.add('collapsed');
}

// ── Table header ──────────────────────────────────────────────────────────────
function renderTableHeader() {
  const tr = document.getElementById('table-header');
  tr.innerHTML = '';
  for (const col of COLUMNS) {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.width) th.style.width = col.width;
    if (['money', 'pct', 'num', 'score'].includes(col.type)) th.className = 'num';

    if (col.sortable) {
      th.addEventListener('click', () => sortBy(col.key));
      if (currentSort.key === col.key) {
        th.classList.add(currentSort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      }
    }

    tr.appendChild(th);
  }
}

// ── Table body ────────────────────────────────────────────────────────────────
function renderTableBody() {
  const tbody  = document.getElementById('table-body');
  tbody.innerHTML = '';

  const traders = [...getCatTraders()];

  traders.sort((a, b) => {
    const va = getNestedValue(a, currentSort.key);
    const vb = getNestedValue(b, currentSort.key);
    const m  = currentSort.dir === 'asc' ? 1 : -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * m;
    return String(va).localeCompare(String(vb)) * m;
  });

  for (const trader of traders) {
    const tr = document.createElement('tr');
    tr.className = 'data-row';
    if (trader.wallet === expandedWallet) tr.classList.add('active');

    tr.addEventListener('click', (e) => {
      if (e.target.closest('.btn-copy-small')) return;
      toggleDetail(trader);
    });

    for (const col of COLUMNS) {
      const td = document.createElement('td');

      switch (col.type) {
        case 'rank':
          td.className = `rank-cell rank-${trader.rank}`;
          td.textContent = trader.rank;
          break;
        case 'trader':
          td.innerHTML = renderTraderCell(trader);
          break;
        case 'score':
          td.className = 'score-cell';
          td.innerHTML = renderScoreBar(trader.compositeScore);
          break;
        case 'money': {
          td.className = 'num';
          const val = getNestedValue(trader, col.key);
          td.innerHTML = formatMoney(val);
          break;
        }
        case 'pct': {
          td.className = 'num';
          const val = getNestedValue(trader, col.key);
          td.innerHTML = formatPct(val);
          break;
        }
        case 'num': {
          td.className = 'num';
          const val = getNestedValue(trader, col.key);
          td.textContent = val != null ? val.toLocaleString() : '—';
          break;
        }
        case 'ranks':
          td.innerHTML = renderRankBadges(trader.leaderboard);
          break;
        case 'copy':
          td.innerHTML = renderCopyButton(trader.wallet);
          break;
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

// ── Cell renderers ────────────────────────────────────────────────────────────
function renderTraderCell(trader) {
  const img   = trader.profileImage
    ? `<img class="trader-avatar" src="${trader.profileImage}" alt="" onerror="this.style.display='none'">`
    : '<div class="trader-avatar"></div>';
  const badge  = trader.verified ? '<span class="badge-verified" title="Verified">✓</span>' : '';
  const name   = escapeHtml(trader.userName);
  const wallet = trader.wallet.slice(0, 6) + '…' + trader.wallet.slice(-4);
  return `
    <div class="trader-info">
      ${img}
      <div>
        <div class="trader-name">${name}${badge}</div>
        <div class="trader-wallet">${wallet}</div>
      </div>
    </div>`;
}

function renderScoreBar(score) {
  const pct   = Math.min((score / 100) * 100, 100);
  const hue   = Math.round((pct / 100) * 120);
  const color = `hsl(${hue}, 70%, 50%)`;
  return `
    <div class="score-bar-container">
      <div class="score-bar">
        <div class="score-bar-fill" style="width:${pct}%; background:${color};"></div>
      </div>
      <span class="score-value" style="color:${color};">${score}</span>
    </div>`;
}

function renderRankBadges(lb) {
  const periods = [
    { key: 'day', label: 'D' }, { key: 'week',  label: 'W' },
    { key: 'month', label: 'M' }, { key: 'all', label: 'A' },
  ];
  return '<div class="rank-badges">' + periods.map(p => {
    const d = lb?.[p.key];
    return d?.rank
      ? `<span class="rank-badge has-rank" title="${p.label}: #${d.rank}">${p.label}${d.rank}</span>`
      : `<span class="rank-badge" title="Not in top ${p.label}">—</span>`;
  }).join('') + '</div>';
}

function renderCopyButton(wallet) {
  return `<button class="btn-copy-small" onclick="event.stopPropagation(); copyWallet(this, '${wallet}')" title="Copy wallet for Polycop">📋 Copy</button>`;
}

function formatMoney(val) {
  if (val == null || isNaN(val)) return '<span class="pnl-zero">—</span>';
  const cls    = val > 0 ? 'pnl-positive' : val < 0 ? 'pnl-negative' : 'pnl-zero';
  const prefix = val > 0 ? '+' : '';
  const abs    = Math.abs(val);
  let fmt;
  if (abs >= 1_000_000) fmt = '$' + (val / 1_000_000).toFixed(2) + 'M';
  else if (abs >= 1_000) fmt = '$' + (val / 1_000).toFixed(1) + 'K';
  else                   fmt = '$' + val.toFixed(2);
  return `<span class="${cls}">${prefix}${fmt}</span>`;
}

function formatPct(val) {
  if (val == null || isNaN(val)) return '<span class="pnl-zero">—</span>';
  const cls    = val > 0 ? 'pnl-positive' : val < 0 ? 'pnl-negative' : 'pnl-zero';
  const prefix = val > 0 ? '+' : '';
  return `<span class="${cls}">${prefix}${val.toFixed(1)}%</span>`;
}

// ── Sorting ───────────────────────────────────────────────────────────────────
function sortBy(key) {
  if (currentSort.key === key) {
    currentSort.dir = currentSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    currentSort.key = key;
    currentSort.dir = 'desc';
  }
  renderTableHeader();
  renderTableBody();
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function toggleDetail(trader) {
  if (expandedWallet === trader.wallet) { closeDetail(); return; }
  expandedWallet = trader.wallet;
  showDetail(trader);
  renderTableBody();
}

function showDetail(trader) {
  const panel = document.getElementById('detail-panel');
  panel.style.display = 'block';

  document.getElementById('detail-name').textContent = `#${trader.rank} — ${trader.userName}`;

  const copyBtn = document.getElementById('detail-copy-btn');
  copyBtn.onclick = () => copyWallet(copyBtn, trader.wallet);

  const profileLink = document.getElementById('detail-profile-link');
  profileLink.href  = trader.polymarketUrl;

  const twitterLink = document.getElementById('detail-twitter-link');
  if (trader.xUsername) {
    twitterLink.href         = `https://x.com/${trader.xUsername}`;
    twitterLink.style.display = '';
  } else {
    twitterLink.style.display = 'none';
  }

  const meta = document.getElementById('detail-meta');
  const m    = trader.metrics;
  meta.className = 'detail-stats-grid';
  meta.innerHTML = [
    stat('Score',            trader.compositeScore,  ''),
    stat('ROI',              m.roiPct + '%',         pnlClass(m.roiPct)),
    stat('Win Rate',         m.winRate + '%',        ''),
    stat('Wins / Losses',   `${m.winsCount} / ${m.lossesCount}`, ''),
    stat('PnL 24h',          fmtUsd(m.dayPnl),      pnlClass(m.dayPnl)),
    stat('PnL 7j',           fmtUsd(m.weekPnl),     pnlClass(m.weekPnl)),
    stat('PnL 30j',          fmtUsd(m.monthPnl),    pnlClass(m.monthPnl)),
    stat('PnL All-time',     fmtUsd(m.totalPnl),    pnlClass(m.totalPnl)),
    stat('Volume',           fmtUsd(m.totalVolume),  ''),
    stat('Active Pos.',      m.activePositions,      ''),
    stat('Marchés',          m.diversification,      ''),
    stat('Taille médiane',   fmtUsd(m.medianPositionSize), ''),
    trader.xUsername ? stat('𝕏 Twitter', `@${trader.xUsername}`, '') : '',
  ].filter(Boolean).join('');

  const positions = trader.positions || [];
  document.getElementById('detail-positions-count').textContent = `(${positions.length})`;

  const tbody = document.getElementById('detail-positions-body');
  tbody.innerHTML = '';

  if (positions.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="8" style="color:var(--text-muted);text-align:center;padding:20px;">No position data available</td>';
    tbody.appendChild(tr);
  } else {
    for (const p of positions) {
      const tr        = document.createElement('tr');
      const marketUrl = p.eventSlug ? `https://polymarket.com/event/${p.eventSlug}` : '#';
      tr.innerHTML = `
        <td><a href="${marketUrl}" target="_blank" title="${escapeHtml(p.title)}">${truncate(p.title, 40)}</a></td>
        <td>${p.outcome}</td>
        <td class="num">${p.size.toFixed(2)}</td>
        <td class="num">${p.avgPrice.toFixed(3)}</td>
        <td class="num">${p.curPrice.toFixed(3)}</td>
        <td class="num">${formatMoney(p.cashPnl)}</td>
        <td class="num">${formatPct(p.percentPnl)}</td>
        <td>${p.endDate ? new Date(p.endDate).toLocaleDateString('fr-FR') : '—'}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeDetail() {
  expandedWallet = null;
  document.getElementById('detail-panel').style.display = 'none';
  renderTableBody();
}

function stat(label, value, cls) {
  if (value === '' || value == null) return '';
  return `<div class="detail-stat">
    <span class="detail-stat-label">${label}</span>
    <span class="detail-stat-value ${cls}">${value}</span>
  </div>`;
}

function pnlClass(v) { return v > 0 ? 'pnl-positive' : v < 0 ? 'pnl-negative' : 'pnl-zero'; }

function fmtUsd(v) {
  if (v == null || isNaN(v)) return '—';
  const abs    = Math.abs(v);
  const prefix = v >= 0 ? '' : '-';
  if (abs >= 1_000_000) return prefix + '$' + (abs / 1_000_000).toFixed(2) + 'M';
  if (abs >= 1_000)     return prefix + '$' + (abs / 1_000).toFixed(1) + 'K';
  return prefix + '$' + abs.toFixed(2);
}

// ── Clipboard ─────────────────────────────────────────────────────────────────
function copyWallet(btn, wallet) {
  navigator.clipboard.writeText(wallet).then(() => {
    btn.classList.add('copied');
    const original = btn.textContent;
    btn.textContent = '✓ Copied!';
    showToast(`Wallet copié: ${wallet.slice(0, 8)}…${wallet.slice(-4)}`);
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.textContent = original;
    }, 2000);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = wallet;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Wallet copié!');
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimeout;
function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-text').textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

// ── Next Refresh Countdown ────────────────────────────────────────────────────
function startNextRefreshCountdown(generatedAt) {
  const el = document.getElementById('next-refresh');
  function update() {
    const now  = new Date();
    const next = new Date(generatedAt);
    next.setUTCHours(6, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const diff = next - now;
    if (diff <= 0) { el.textContent = 'Imminent'; return; }
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    el.textContent = `${h}h ${String(m).padStart(2, '0')}m`;
  }
  update();
  setInterval(update, 60_000);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, len) {
  if (!str) return '—';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

window.copyWallet = copyWallet;
