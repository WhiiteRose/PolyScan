/**
 * PolyScan — Frontend Application
 * Loads top10.json and renders an interactive comparison dashboard
 */

// ── State ───────────────────────────────────────────────────────────────────
let DATA = null;
let currentSort = { key: 'compositeScore', dir: 'desc' };
let expandedWallet = null;

// ── Column definitions ──────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'rank',                label: '#',            type: 'rank',    sortable: true,  width: '36px' },
  { key: 'userName',            label: 'Trader',       type: 'trader',  sortable: true },
  { key: 'compositeScore',      label: 'Score',        type: 'score',   sortable: true,  width: '120px' },
  { key: 'metrics.roiPct',      label: 'ROI %',        type: 'pct',     sortable: true },
  { key: 'metrics.winRate',     label: 'Win Rate',     type: 'pct',     sortable: true },
  { key: 'metrics.dayPnl',     label: 'PnL 1D',       type: 'money',   sortable: true },
  { key: 'metrics.weekPnl',    label: 'PnL 7D',       type: 'money',   sortable: true },
  { key: 'metrics.monthPnl',   label: 'PnL 30D',      type: 'money',   sortable: true },
  { key: 'metrics.totalPnl',   label: 'PnL All',      type: 'money',   sortable: true },
  { key: 'metrics.totalVolume', label: 'Volume',       type: 'money',   sortable: true },
  { key: 'metrics.activePositions',  label: 'Active Pos.',  type: 'num', sortable: true },
  { key: 'metrics.diversification',  label: 'Markets',      type: 'num', sortable: true },
  { key: 'metrics.medianPositionSize', label: 'Med. Size',  type: 'money', sortable: true },
  { key: 'metrics.consistencyScore',   label: 'Consistency', type: 'pct', sortable: true },
  { key: 'leaderboardRanks',   label: 'LB Ranks (D/W/M/A)', type: 'ranks', sortable: false },
  { key: '_copy',              label: 'Wallet',       type: 'copy',    sortable: false },
];

// ── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const res = await fetch('data/top10.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
    showContent();
  } catch (err) {
    showError(err.message);
  }
}

function showContent() {
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('content').style.display = 'block';

  // Update header metadata
  const date = new Date(DATA.generatedAt);
  document.getElementById('update-time').textContent = date.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  document.getElementById('candidates-count').textContent = DATA.totalCandidatesAnalyzed;
  document.getElementById('status-badge').textContent = '● Live';

  // Render scoring weights
  renderWeights();

  // Render table
  renderTableHeader();
  renderTableBody();

  // Setup legend toggle
  setupLegendToggle();

  // Setup detail panel close
  document.getElementById('detail-close-btn').addEventListener('click', closeDetail);
}

function showError(msg) {
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('error-state').style.display = 'block';
  document.getElementById('error-message').textContent = msg;
  document.getElementById('status-badge').textContent = '● Error';
  document.getElementById('status-badge').className = 'meta-value';
  document.getElementById('status-badge').style.color = 'var(--red)';
}

// ── Scoring Legend ──────────────────────────────────────────────────────────
function renderWeights() {
  const grid = document.getElementById('weights-grid');
  if (!DATA.scoringWeights) return;
  const labels = {
    roiPct: 'ROI %',
    monthPnl: 'PnL (30 days)',
    weekPnl: 'PnL (7 days)',
    consistency: 'Consistency',
    winRate: 'Win Rate',
    activity: 'Activity Level',
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
  const panel = document.getElementById('scoring-legend');
  const toggle = document.getElementById('legend-toggle');
  toggle.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
  });
  // Start collapsed
  panel.classList.add('collapsed');
}

// ── Table Header ────────────────────────────────────────────────────────────
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

// ── Table Body ──────────────────────────────────────────────────────────────
function renderTableBody() {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';

  const traders = [...DATA.traders];

  // Sort
  traders.sort((a, b) => {
    const va = getNestedValue(a, currentSort.key);
    const vb = getNestedValue(b, currentSort.key);
    const mult = currentSort.dir === 'asc' ? 1 : -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult;
    return String(va).localeCompare(String(vb)) * mult;
  });

  // Re-assign visual rank after sort
  for (const trader of traders) {
    const tr = document.createElement('tr');
    tr.className = 'data-row';
    if (trader.wallet === expandedWallet) tr.classList.add('active');

    tr.addEventListener('click', (e) => {
      // Don't expand if clicking copy button
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

// ── Cell Renderers ──────────────────────────────────────────────────────────
function renderTraderCell(trader) {
  const img = trader.profileImage
    ? `<img class="trader-avatar" src="${trader.profileImage}" alt="" onerror="this.style.display='none'">`
    : '<div class="trader-avatar"></div>';
  const badge = trader.verified ? '<span class="badge-verified" title="Verified">✓</span>' : '';
  const name = escapeHtml(trader.userName);
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
  const maxScore = 100;
  const pct = Math.min((score / maxScore) * 100, 100);
  const hue = Math.round((pct / 100) * 120); // 0=red, 120=green
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
    { key: 'day',   label: 'D' },
    { key: 'week',  label: 'W' },
    { key: 'month', label: 'M' },
    { key: 'all',   label: 'A' },
  ];
  return '<div class="rank-badges">' + periods.map(p => {
    const data = lb[p.key];
    if (data && data.rank) {
      return `<span class="rank-badge has-rank" title="${p.label}: #${data.rank}">${p.label}${data.rank}</span>`;
    }
    return `<span class="rank-badge" title="Not in top 50 for ${p.label}">—</span>`;
  }).join('') + '</div>';
}

function renderCopyButton(wallet) {
  return `<button class="btn-copy-small" onclick="event.stopPropagation(); copyWallet(this, '${wallet}')" title="Copy wallet for Polycop">📋 Copy</button>`;
}

function formatMoney(val) {
  if (val == null || isNaN(val)) return '<span class="pnl-zero">—</span>';
  const cls = val > 0 ? 'pnl-positive' : val < 0 ? 'pnl-negative' : 'pnl-zero';
  const prefix = val > 0 ? '+' : '';
  const abs = Math.abs(val);
  let formatted;
  if (abs >= 1_000_000) formatted = '$' + (val / 1_000_000).toFixed(2) + 'M';
  else if (abs >= 1_000) formatted = '$' + (val / 1_000).toFixed(1) + 'K';
  else formatted = '$' + val.toFixed(2);
  return `<span class="${cls}">${prefix}${formatted}</span>`;
}

function formatPct(val) {
  if (val == null || isNaN(val)) return '<span class="pnl-zero">—</span>';
  const cls = val > 0 ? 'pnl-positive' : val < 0 ? 'pnl-negative' : 'pnl-zero';
  const prefix = val > 0 ? '+' : '';
  return `<span class="${cls}">${prefix}${val.toFixed(1)}%</span>`;
}

// ── Sorting ─────────────────────────────────────────────────────────────────
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

// ── Detail Panel ────────────────────────────────────────────────────────────
function toggleDetail(trader) {
  if (expandedWallet === trader.wallet) {
    closeDetail();
    return;
  }
  expandedWallet = trader.wallet;
  showDetail(trader);
  renderTableBody(); // Re-render to mark active row
}

function showDetail(trader) {
  const panel = document.getElementById('detail-panel');
  panel.style.display = 'block';

  // Header
  document.getElementById('detail-name').textContent =
    `#${trader.rank} — ${trader.userName}`;

  // Copy button
  const copyBtn = document.getElementById('detail-copy-btn');
  copyBtn.onclick = () => copyWallet(copyBtn, trader.wallet);

  // Profile link
  const profileLink = document.getElementById('detail-profile-link');
  profileLink.href = trader.polymarketUrl;

  // Meta stats
  const meta = document.getElementById('detail-meta');
  const m = trader.metrics;
  meta.innerHTML = [
    stat('Wallet', trader.wallet.slice(0, 10) + '…' + trader.wallet.slice(-6), ''),
    stat('Score', trader.compositeScore, ''),
    stat('ROI', m.roiPct + '%', m.roiPct >= 0 ? 'pnl-positive' : 'pnl-negative'),
    stat('Win Rate', m.winRate + '%', ''),
    stat('Wins / Losses', `${m.winsCount} / ${m.lossesCount}`, ''),
    stat('PnL (Day)', fmtUsd(m.dayPnl), pnlClass(m.dayPnl)),
    stat('PnL (Week)', fmtUsd(m.weekPnl), pnlClass(m.weekPnl)),
    stat('PnL (Month)', fmtUsd(m.monthPnl), pnlClass(m.monthPnl)),
    stat('PnL (All)', fmtUsd(m.totalPnl), pnlClass(m.totalPnl)),
    stat('Volume (All)', fmtUsd(m.totalVolume), ''),
    stat('Active Positions', m.activePositions, ''),
    stat('Markets', m.diversification, ''),
    stat('Avg Pos. Size', fmtUsd(m.avgPositionSize), ''),
    stat('Median Pos. Size', fmtUsd(m.medianPositionSize), ''),
    trader.xUsername ? stat('𝕏', `@${trader.xUsername}`, '') : '',
  ].join('');

  // Positions table
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
      const tr = document.createElement('tr');
      const marketUrl = p.eventSlug
        ? `https://polymarket.com/event/${p.eventSlug}`
        : '#';
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

  // Scroll to detail
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeDetail() {
  expandedWallet = null;
  document.getElementById('detail-panel').style.display = 'none';
  renderTableBody();
}

function stat(label, value, cls) {
  return `<div class="detail-stat"><span class="detail-stat-label">${label}</span><span class="detail-stat-value ${cls}">${value}</span></div>`;
}

function pnlClass(v) {
  return v > 0 ? 'pnl-positive' : v < 0 ? 'pnl-negative' : 'pnl-zero';
}

function fmtUsd(v) {
  if (v == null || isNaN(v)) return '—';
  const abs = Math.abs(v);
  const prefix = v >= 0 ? '' : '-';
  if (abs >= 1_000_000) return prefix + '$' + (abs / 1_000_000).toFixed(2) + 'M';
  if (abs >= 1_000)     return prefix + '$' + (abs / 1_000).toFixed(1) + 'K';
  return prefix + '$' + abs.toFixed(2);
}

// ── Clipboard ───────────────────────────────────────────────────────────────
function copyWallet(btn, wallet) {
  navigator.clipboard.writeText(wallet).then(() => {
    btn.classList.add('copied');
    const original = btn.textContent;
    btn.textContent = '✓ Copied!';
    showToast(`Wallet copied: ${wallet.slice(0, 8)}…${wallet.slice(-4)}`);
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.textContent = original;
    }, 2000);
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = wallet;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Wallet copied!');
  });
}

// ── Toast ───────────────────────────────────────────────────────────────────
let toastTimeout;
function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-text').textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

// ── Utilities ───────────────────────────────────────────────────────────────
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

// Expose copyWallet globally for inline onclick
window.copyWallet = copyWallet;
