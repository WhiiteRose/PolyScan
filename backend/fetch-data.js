/**
 * PolyScan — Polymarket Copy Trading Data Fetcher & Scorer v3.0
 *
 * 1. Fetches leaderboard per category (OVERALL, POLITICS, SPORTS, CRYPTO, …)
 * 2. Builds a global deduplicated candidate pool
 * 3. Enriches each unique trader with position data (fetched once)
 * 4. Scores traders per-category using category-specific leaderboard data
 * 5. Outputs top 10 per category to data/leaderboard.json
 */

const fs = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────────────────────────
const DATA_API      = 'https://data-api.polymarket.com';
const DELAY_MS      = 400;   // ms between API calls (rate-limit friendly)
const POOL_LIMIT    = 100;   // max results per leaderboard query
const TOP_N         = 10;    // final output count per category
const POSITIONS_LIMIT = 200; // max positions to fetch per trader

const CATEGORIES = [
  { id: 'OVERALL',    label: 'Overall',    icon: '🌐' },
  { id: 'POLITICS',   label: 'Politique',  icon: '🗳️' },
  { id: 'SPORTS',     label: 'Sport',      icon: '⚽' },
  { id: 'CRYPTO',     label: 'Crypto',     icon: '₿' },
  { id: 'FINANCE',    label: 'Finance',    icon: '💹' },
  { id: 'CULTURE',    label: 'Culture',    icon: '🎭' },
  { id: 'WEATHER',    label: 'Weather',    icon: '🌤️' },
  { id: 'ECONOMICS',  label: 'Economics',  icon: '📈' },
  { id: 'TECH',       label: 'Tech',       icon: '💻' },
  { id: 'MENTIONS',   label: 'Mentions',   icon: '💬' },
];

const PERIOD_QUERIES = [
  { period: 'DAY',   orderBy: 'PNL' },
  { period: 'WEEK',  orderBy: 'PNL' },
  { period: 'MONTH', orderBy: 'PNL' },
  { period: 'ALL',   orderBy: 'PNL' },
  { period: 'DAY',   orderBy: 'VOL' },
  { period: 'WEEK',  orderBy: 'VOL' },
  { period: 'MONTH', orderBy: 'VOL' },
  { period: 'ALL',   orderBy: 'VOL' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJSON(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 429 && i < retries) {
          console.warn(`  Rate limited, waiting ${(i + 1) * 2}s…`);
          await sleep((i + 1) * 2000);
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      if (i === retries) throw err;
      await sleep(1000);
    }
  }
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function abbreviateNum(n) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
}

// ── Step 1: Build global candidate pool across all categories ─────────────────
// globalPool: Map<wallet, { wallet, userName, profileImage, verified, xUsername,
//                            categoryLb: { [catId]: { day, week, month, all } } }>
async function buildGlobalPool() {
  const globalPool = new Map();

  for (const cat of CATEGORIES) {
    console.log(`\n  ── ${cat.icon}  ${cat.label} (${cat.id})`);
    let added = 0;

    for (const { period, orderBy } of PERIOD_QUERIES) {
      const url = `${DATA_API}/v1/leaderboard?category=${cat.id}&timePeriod=${period}&orderBy=${orderBy}&limit=${POOL_LIMIT}`;
      process.stdout.write(`     ${period}/${orderBy}… `);

      try {
        const data = await fetchJSON(url);
        if (!Array.isArray(data) || data.length === 0) {
          console.log('(empty)');
          await sleep(DELAY_MS);
          continue;
        }

        for (const t of data) {
          const w = t.proxyWallet;
          if (!w) continue;

          if (!globalPool.has(w)) {
            globalPool.set(w, {
              wallet:       w,
              userName:     t.userName || w,
              profileImage: t.profileImage || '',
              verified:     !!t.verifiedBadge,
              xUsername:    t.xUsername || '',
              categoryLb:   {},
            });
            added++;
          }

          const c = globalPool.get(w);

          // Ensure this category slot exists
          if (!c.categoryLb[cat.id]) {
            c.categoryLb[cat.id] = { day: null, week: null, month: null, all: null };
          }

          const lb  = c.categoryLb[cat.id];
          const key = period.toLowerCase();

          // PNL-ordered rank takes priority over VOL-ordered rank
          if (!lb[key] || orderBy === 'PNL') {
            lb[key] = { rank: parseInt(t.rank), pnl: t.pnl, vol: t.vol };
          } else if (!lb[key].vol) {
            lb[key].vol = t.vol;
          }

          // Prefer human-readable profile info
          if (t.userName && !t.userName.startsWith('0x')) c.userName = t.userName;
          if (t.profileImage) c.profileImage = t.profileImage;
          if (t.xUsername)    c.xUsername    = t.xUsername;
        }

        console.log(`${data.length} traders`);
      } catch (err) {
        console.log(`✗ ${err.message}`);
      }

      await sleep(DELAY_MS);
    }

    console.log(`     → ${added} new unique traders added`);
  }

  return globalPool;
}

// ── Step 2: Enrich candidates with position data (fetched once per trader) ───
async function enrichWithPositions(globalPool) {
  let i = 0;
  const total = globalPool.size;

  for (const [wallet, data] of globalPool) {
    i++;
    const label = (data.userName.length > 20
      ? data.userName.slice(0, 17) + '…'
      : data.userName).padEnd(20);
    process.stdout.write(`  [${String(i).padStart(4)}/${total}] ${label} `);

    try {
      const positions = await fetchJSON(
        `${DATA_API}/positions?user=${wallet}&sizeThreshold=0&limit=${POSITIONS_LIMIT}&sortBy=CASHPNL`
      );

      data.positions = Array.isArray(positions)
        ? positions.map(p => ({
            title:        p.title        || 'Unknown Market',
            slug:         p.slug         || '',
            eventSlug:    p.eventSlug    || p.slug || '',
            outcome:      p.outcome      || '?',
            size:         p.size         || 0,
            avgPrice:     p.avgPrice     || 0,
            currentValue: p.currentValue || 0,
            initialValue: p.initialValue || 0,
            cashPnl:      p.cashPnl      || 0,
            percentPnl:   p.percentPnl   || 0,
            realizedPnl:  p.realizedPnl  || 0,
            curPrice:     p.curPrice     || 0,
            redeemable:   !!p.redeemable,
            endDate:      p.endDate      || null,
            icon:         p.icon         || '',
          }))
        : [];

      console.log(`${data.positions.length} pos`);
    } catch (err) {
      console.log(`✗ ${err.message}`);
      data.positions = [];
    }

    await sleep(DELAY_MS);
  }
}

// ── Step 3: Calculate metrics for a trader given a category leaderboard ──────
function calculateMetrics(positions, lb) {
  // Win rate
  const posWithPnl = positions.filter(p => Math.abs(p.cashPnl) > 0.01);
  const wins       = posWithPnl.filter(p => p.cashPnl > 0).length;
  const winRate    = posWithPnl.length >= 3
    ? (wins / posWithPnl.length) * 100
    : 0;

  // Position sizes
  const initialValues = positions.map(p => Math.abs(p.initialValue || 0)).filter(v => v > 0.01);
  const avgPositionSize = initialValues.length > 0
    ? initialValues.reduce((a, b) => a + b, 0) / initialValues.length
    : 0;
  const sortedSizes        = [...initialValues].sort((a, b) => a - b);
  const medianPositionSize = sortedSizes.length > 0
    ? sortedSizes[Math.floor(sortedSizes.length / 2)]
    : 0;

  // Diversification
  const uniqueMarkets = new Set(positions.map(p => p.eventSlug).filter(Boolean));

  // ROI
  const bestVol = lb.all?.vol || lb.month?.vol || lb.week?.vol || 0;
  const bestPnl = lb.all?.pnl || 0;
  const roiPct  = bestVol > 0 ? (bestPnl / bestVol) * 100 : 0;

  // Monthly ROI
  const monthVol = lb.month?.vol || 0;
  const monthPnl = lb.month?.pnl || 0;
  const monthRoi = monthVol > 0 ? (monthPnl / monthVol) * 100 : 0;

  // Consistency across periods
  const periodsPresent  = ['day', 'week', 'month', 'all'].filter(p => lb[p] !== null).length;
  const consistencyScore = (periodsPresent / 4) * 100;

  // Active positions
  const activePositions = positions.filter(p => !p.redeemable && p.size > 0.001);
  const unrealizedPnl   = activePositions.reduce((s, p) => s + (p.cashPnl || 0), 0);

  return {
    roiPct:             round2(roiPct),
    monthRoi:           round2(monthRoi),
    winRate:            round2(winRate),
    winsCount:          wins,
    lossesCount:        posWithPnl.length - wins,
    avgPositionSize:    round2(avgPositionSize),
    medianPositionSize: round2(medianPositionSize),
    activePositions:    activePositions.length,
    totalPositions:     positions.length,
    diversification:    uniqueMarkets.size,
    consistencyScore:   round2(consistencyScore),
    unrealizedPnl:      round2(unrealizedPnl),
    dayPnl:             round2(lb.day?.pnl   || 0),
    weekPnl:            round2(lb.week?.pnl  || 0),
    monthPnl:           round2(monthPnl),
    totalPnl:           round2(bestPnl),
    totalVolume:        round2(bestVol),
    dayRank:            lb.day?.rank   || null,
    weekRank:           lb.week?.rank  || null,
    monthRank:          lb.month?.rank || null,
    allRank:            lb.all?.rank   || null,
  };
}

// ── Step 4: Composite scoring ─────────────────────────────────────────────────
// Weights: ROI 25% | MonthPnL 18% | WeekPnL 14% | DayPnL 8%
//          Consistency 10% | WinRate 10% | Activity 10% | Budget 5% = 100%
function calculateCompositeScore(metrics, poolMetrics) {
  let score = 0;

  const roiNorm = poolMetrics.maxRoi > 0
    ? Math.max(0, Math.min(metrics.roiPct / poolMetrics.maxRoi, 1))
    : 0;
  score += roiNorm * 25;

  if (metrics.monthPnl > 0 && poolMetrics.maxMonthPnl > 0) {
    const n = Math.log10(1 + metrics.monthPnl) / Math.log10(1 + poolMetrics.maxMonthPnl);
    score += Math.min(n, 1) * 18;
  }

  if (metrics.weekPnl > 0 && poolMetrics.maxWeekPnl > 0) {
    const n = Math.log10(1 + metrics.weekPnl) / Math.log10(1 + poolMetrics.maxWeekPnl);
    score += Math.min(n, 1) * 14;
  }

  if (metrics.dayPnl > 0 && poolMetrics.maxDayPnl > 0) {
    const n = Math.log10(1 + metrics.dayPnl) / Math.log10(1 + poolMetrics.maxDayPnl);
    score += Math.min(n, 1) * 8;
  }

  score += (metrics.consistencyScore / 100) * 10;

  if (metrics.winsCount + metrics.lossesCount >= 3) {
    score += (metrics.winRate / 100) * 10;
  }

  const activity = metrics.activePositions;
  let activityScore;
  if (activity >= 5 && activity <= 25) {
    activityScore = 1;
  } else if (activity < 5) {
    activityScore = activity / 5;
  } else {
    activityScore = Math.max(0, 1 - (activity - 25) / 75);
  }
  score += activityScore * 10;

  const median = metrics.medianPositionSize;
  let budgetScore = 1;
  if (median > 5000) budgetScore = Math.max(0.2, 1 - (median - 5000) / 50000);
  score += budgetScore * 5;

  return round2(score);
}

// ── Step 5: Score and rank traders for one category ───────────────────────────
function rankCategory(globalPool, categoryId) {
  // Only traders who appear in this category's leaderboard
  const eligible = [...globalPool.values()].filter(c => c.categoryLb[categoryId]);
  if (eligible.length === 0) return null;

  // Calculate metrics for each trader using this category's leaderboard data
  for (const c of eligible) {
    c._catMetrics = c._catMetrics || {};
    c._catMetrics[categoryId] = calculateMetrics(
      c.positions || [],
      c.categoryLb[categoryId]
    );
  }

  const allMetrics = eligible.map(c => c._catMetrics[categoryId]);
  const poolMetrics = {
    maxRoi:      Math.max(...allMetrics.map(m => m.roiPct).filter(v => isFinite(v) && v > 0), 1),
    maxMonthPnl: Math.max(...allMetrics.map(m => m.monthPnl).filter(v => v > 0), 1),
    maxWeekPnl:  Math.max(...allMetrics.map(m => m.weekPnl).filter(v => v > 0), 1),
    maxDayPnl:   Math.max(...allMetrics.map(m => m.dayPnl).filter(v => v > 0), 1),
  };

  const scored = [];
  for (const c of eligible) {
    const metrics       = c._catMetrics[categoryId];
    if (metrics.totalPnl < 0) continue;          // skip negative all-time PnL
    const compositeScore = calculateCompositeScore(metrics, poolMetrics);
    if (compositeScore <= 0) continue;
    scored.push({ ...c, metrics, compositeScore });
  }

  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  return {
    scoredCount: scored.length,
    traders: scored.slice(0, TOP_N).map((t, i) => ({
      rank:           i + 1,
      compositeScore: t.compositeScore,
      wallet:         t.wallet,
      userName:       t.userName,
      profileImage:   t.profileImage,
      verified:       t.verified,
      xUsername:      t.xUsername,
      polymarketUrl:  `https://polymarket.com/profile/${t.wallet}`,
      leaderboard:    t.categoryLb[categoryId],
      metrics:        t.metrics,
      positions:      (t.positions || [])
        .filter(p => p.size > 0.001)
        .sort((a, b) => Math.abs(b.cashPnl) - Math.abs(a.cashPnl))
        .slice(0, 20),
    })),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    PolyScan — Data Fetcher v3.0 (cats)   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Started: ${new Date().toISOString()}\n`);

  // Step 1: Build global pool
  console.log('─── Step 1/4: Fetching leaderboards (all categories) ───');
  const globalPool = await buildGlobalPool();
  console.log(`\n  ✓ Global pool: ${globalPool.size} unique candidates\n`);

  // Step 2: Enrich with positions (once per trader)
  console.log('─── Step 2/4: Enriching with positions ─────────────────');
  await enrichWithPositions(globalPool);

  // Step 3: Score per category
  console.log('\n─── Step 3/4: Scoring per category ────────────────────');
  const categoriesOutput = {};
  for (const cat of CATEGORIES) {
    const result = rankCategory(globalPool, cat.id);
    if (!result) {
      console.log(`  ⚠ ${cat.label}: no data, skipping`);
      continue;
    }
    categoriesOutput[cat.id] = {
      label:       cat.label,
      icon:        cat.icon,
      scoredCount: result.scoredCount,
      traders:     result.traders,
    };
    console.log(`  ✓ ${cat.icon} ${cat.label}: ${result.traders.length} traders (from ${result.scoredCount} scored)`);
  }

  // Step 4: Output
  console.log('\n─── Step 4/4: Writing output ───────────────────────────');
  const scoringWeights = {
    roiPct: '25%', monthPnl: '18%', weekPnl: '14%', dayPnl: '8%',
    consistency: '10%', winRate: '10%', activity: '10%', budgetCompatibility: '5%',
  };

  const output = {
    generatedAt:             new Date().toISOString(),
    totalCandidatesAnalyzed: globalPool.size,
    scoringWeights,
    categories:              categoriesOutput,
  };

  const outDir  = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'leaderboard.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  // ── Print summary ──────────────────────────────────────────────────────────
  const elapsed = formatDuration(Date.now() - startTime);
  console.log(`\n  ✓ Saved to data/leaderboard.json\n`);

  for (const cat of CATEGORIES) {
    const catData = categoriesOutput[cat.id];
    if (!catData) continue;
    console.log(`\n${cat.icon}  ${cat.label.toUpperCase()}`);
    console.log('╔══════════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║  #   Name                Score   ROI%     WinRate  MonthPnL       Positions  Budget ║');
    console.log('╠══════════════════════════════════════════════════════════════════════════════════════╣');
    for (const t of catData.traders) {
      const name     = t.userName.padEnd(18).slice(0, 18);
      const score    = String(t.compositeScore).padStart(6);
      const roi      = (t.metrics.roiPct.toFixed(1) + '%').padStart(7);
      const wr       = (t.metrics.winRate.toFixed(0) + '%').padStart(5);
      const mpnl     = ('$' + abbreviateNum(t.metrics.monthPnl)).padStart(12);
      const pos      = String(t.metrics.activePositions).padStart(5);
      const budget   = ('$' + abbreviateNum(t.metrics.medianPositionSize)).padStart(8);
      console.log(`║  ${String(t.rank).padStart(2)}  ${name}  ${score}  ${roi}    ${wr}   ${mpnl}      ${pos}   ${budget} ║`);
    }
    console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');
  }

  console.log(`\n  Done in ${elapsed}.`);
}

main().catch(err => {
  console.error('\n✗ Fatal error:', err);
  process.exit(1);
});
