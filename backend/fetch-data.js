/**
 * PolyScan — Polymarket Copy Trading Data Fetcher & Scorer
 * 
 * 1. Fetches leaderboard across multiple periods (DAY/WEEK/MONTH/ALL)
 * 2. Deduplicates candidates into a pool
 * 3. Enriches each candidate with position data
 * 4. Calculates composite score optimized for small-budget copy trading
 * 5. Outputs top 10 to data/top10.json
 */

const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const DATA_API = 'https://data-api.polymarket.com';
const DELAY_MS = 500;           // ms between API calls (be respectful)
const POOL_LIMIT = 50;          // max results per leaderboard query
const TOP_N = 10;               // final output count
const POSITIONS_LIMIT = 200;    // max positions to fetch per trader

// ── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJSON(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 429 && i < retries) {
          console.warn(`  Rate limited, waiting ${(i + 1) * 2}s...`);
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

// ── Step 1: Build candidate pool from leaderboard ───────────────────────────
async function fetchLeaderboardPool() {
  const queries = [
    { period: 'DAY',   orderBy: 'PNL' },
    { period: 'WEEK',  orderBy: 'PNL' },
    { period: 'MONTH', orderBy: 'PNL' },
    { period: 'ALL',   orderBy: 'PNL' },
    { period: 'MONTH', orderBy: 'VOL' },
    { period: 'ALL',   orderBy: 'VOL' },
  ];

  const candidates = new Map();

  for (const { period, orderBy } of queries) {
    const url = `${DATA_API}/v1/leaderboard?category=OVERALL&timePeriod=${period}&orderBy=${orderBy}&limit=${POOL_LIMIT}`;
    console.log(`  Fetching ${period} by ${orderBy}...`);

    try {
      const data = await fetchJSON(url);
      for (const t of data) {
        const w = t.proxyWallet;
        if (!candidates.has(w)) {
          candidates.set(w, {
            wallet: w,
            userName: t.userName || w,
            profileImage: t.profileImage || '',
            verified: !!t.verifiedBadge,
            xUsername: t.xUsername || '',
            leaderboard: { day: null, week: null, month: null, all: null },
          });
        }

        const c = candidates.get(w);
        const key = period.toLowerCase();

        // Keep the best data for this period (prioritize PNL ranking)
        if (!c.leaderboard[key] || orderBy === 'PNL') {
          c.leaderboard[key] = {
            rank: parseInt(t.rank),
            pnl: t.pnl,
            vol: t.vol,
          };
        } else {
          // Merge volume data if we only had PNL before
          if (c.leaderboard[key].vol === undefined || c.leaderboard[key].vol === 0) {
            c.leaderboard[key].vol = t.vol;
          }
        }

        // Prefer human-readable usernames
        if (t.userName && !t.userName.startsWith('0x')) {
          c.userName = t.userName;
        }
        if (t.profileImage) c.profileImage = t.profileImage;
        if (t.xUsername) c.xUsername = t.xUsername;
      }
    } catch (err) {
      console.error(`  ✗ Error fetching ${period}/${orderBy}: ${err.message}`);
    }

    await sleep(DELAY_MS);
  }

  return candidates;
}

// ── Step 2: Enrich candidates with position data ────────────────────────────
async function enrichWithPositions(candidates) {
  let i = 0;
  const total = candidates.size;

  for (const [wallet, data] of candidates) {
    i++;
    const label = data.userName.length > 20
      ? data.userName.slice(0, 17) + '...'
      : data.userName;
    process.stdout.write(`  [${i}/${total}] ${label}...`);

    try {
      const positions = await fetchJSON(
        `${DATA_API}/positions?user=${wallet}&sizeThreshold=0&limit=${POSITIONS_LIMIT}&sortBy=CASHPNL`
      );

      data.positions = Array.isArray(positions)
        ? positions.map(p => ({
            title: p.title || 'Unknown Market',
            slug: p.slug || '',
            eventSlug: p.eventSlug || p.slug || '',
            outcome: p.outcome || '?',
            size: p.size || 0,
            avgPrice: p.avgPrice || 0,
            currentValue: p.currentValue || 0,
            initialValue: p.initialValue || 0,
            cashPnl: p.cashPnl || 0,
            percentPnl: p.percentPnl || 0,
            realizedPnl: p.realizedPnl || 0,
            curPrice: p.curPrice || 0,
            redeemable: !!p.redeemable,
            endDate: p.endDate || null,
            icon: p.icon || '',
          }))
        : [];

      console.log(` ${data.positions.length} positions`);
    } catch (err) {
      console.log(` ✗ ${err.message}`);
      data.positions = [];
    }

    await sleep(DELAY_MS);
  }
}

// ── Step 3: Calculate metrics ───────────────────────────────────────────────
function calculateMetrics(data) {
  const positions = data.positions || [];
  const lb = data.leaderboard;

  // ── Win rate (from positions with non-zero PnL)
  const posWithPnl = positions.filter(p => Math.abs(p.cashPnl) > 0.01);
  const wins = posWithPnl.filter(p => p.cashPnl > 0).length;
  const winRate = posWithPnl.length >= 3
    ? (wins / posWithPnl.length) * 100
    : 0; // Need minimum 3 positions for meaningful win rate

  // ── Average position size
  const initialValues = positions
    .map(p => Math.abs(p.initialValue || 0))
    .filter(v => v > 0.01);
  const avgPositionSize = initialValues.length > 0
    ? initialValues.reduce((a, b) => a + b, 0) / initialValues.length
    : 0;

  // ── Median position size (more robust than average for whales)
  const sortedSizes = [...initialValues].sort((a, b) => a - b);
  const medianPositionSize = sortedSizes.length > 0
    ? sortedSizes[Math.floor(sortedSizes.length / 2)]
    : 0;

  // ── Diversification: unique markets
  const uniqueMarkets = new Set(positions.map(p => p.eventSlug).filter(Boolean));

  // ── ROI calculation (PnL / Volume)
  const bestVol = lb.all?.vol || lb.month?.vol || lb.week?.vol || 0;
  const bestPnl = lb.all?.pnl || 0;
  const roiPct = bestVol > 0 ? (bestPnl / bestVol) * 100 : 0;

  // ── Monthly ROI
  const monthVol = lb.month?.vol || 0;
  const monthPnl = lb.month?.pnl || 0;
  const monthRoi = monthVol > 0 ? (monthPnl / monthVol) * 100 : 0;

  // ── Consistency: present in how many period leaderboards
  const periodsPresent = ['day', 'week', 'month', 'all']
    .filter(p => lb[p] !== null).length;
  const consistencyScore = (periodsPresent / 4) * 100;

  // ── Active positions (not yet redeemable, non-zero size)
  const activePositions = positions.filter(p => !p.redeemable && p.size > 0.001);

  // ── Total unrealized PnL
  const unrealizedPnl = activePositions.reduce((sum, p) => sum + (p.cashPnl || 0), 0);

  // ── Period PnLs
  const dayPnl = lb.day?.pnl || 0;
  const weekPnl = lb.week?.pnl || 0;

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
    dayPnl:             round2(dayPnl),
    weekPnl:            round2(weekPnl),
    monthPnl:           round2(monthPnl),
    totalPnl:           round2(bestPnl),
    totalVolume:        round2(bestVol),
    dayRank:            lb.day?.rank || null,
    weekRank:           lb.week?.rank || null,
    monthRank:          lb.month?.rank || null,
    allRank:            lb.all?.rank || null,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ── Step 4: Composite scoring ───────────────────────────────────────────────
function calculateCompositeScore(metrics, poolMetrics) {
  let score = 0;

  // ROI % (25%) — normalized against pool max
  const roiNorm = poolMetrics.maxRoi > 0
    ? Math.max(0, Math.min(metrics.roiPct / poolMetrics.maxRoi, 1))
    : 0;
  score += roiNorm * 25;

  // Month PnL (20%) — log-scale normalization (handles huge range)
  if (metrics.monthPnl > 0 && poolMetrics.maxMonthPnl > 0) {
    const logNorm = Math.log10(1 + metrics.monthPnl) / Math.log10(1 + poolMetrics.maxMonthPnl);
    score += Math.min(logNorm, 1) * 20;
  }

  // Week PnL (15%)
  if (metrics.weekPnl > 0 && poolMetrics.maxWeekPnl > 0) {
    const logNorm = Math.log10(1 + metrics.weekPnl) / Math.log10(1 + poolMetrics.maxWeekPnl);
    score += Math.min(logNorm, 1) * 15;
  }

  // Consistency (15%)
  score += (metrics.consistencyScore / 100) * 15;

  // Win rate (10%) — requires minimum positions
  if (metrics.winsCount + metrics.lossesCount >= 3) {
    score += (metrics.winRate / 100) * 10;
  }

  // Activity level (10%) — sweet spot 5-25 active positions
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

  // Budget compatibility (5%) — slight penalty for median position > $5000
  const median = metrics.medianPositionSize;
  let budgetScore = 1;
  if (median > 5000) {
    budgetScore = Math.max(0.2, 1 - (median - 5000) / 50000);
  }
  score += budgetScore * 5;

  return round2(score);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       PolyScan — Data Fetcher v1.0       ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Started: ${new Date().toISOString()}\n`);

  // Step 1: Build pool
  console.log('─── Step 1/4: Fetching leaderboard pool ───');
  const candidates = await fetchLeaderboardPool();
  console.log(`  ✓ Pool: ${candidates.size} unique candidates\n`);

  // Step 2: Enrich
  console.log('─── Step 2/4: Enriching with positions ────');
  await enrichWithPositions(candidates);

  // Step 3: Calculate metrics
  console.log('\n─── Step 3/4: Calculating metrics ─────────');
  const allMetrics = [];
  for (const [, data] of candidates) {
    data._metrics = calculateMetrics(data);
    allMetrics.push(data._metrics);
  }

  // Calculate pool-wide stats for normalization
  const poolMetrics = {
    maxRoi: Math.max(...allMetrics.map(m => m.roiPct).filter(v => isFinite(v) && v > 0), 1),
    maxMonthPnl: Math.max(...allMetrics.map(m => m.monthPnl).filter(v => v > 0), 1),
    maxWeekPnl: Math.max(...allMetrics.map(m => m.weekPnl).filter(v => v > 0), 1),
  };
  console.log(`  Pool normalization: maxROI=${poolMetrics.maxRoi}%, maxMonthPnL=$${poolMetrics.maxMonthPnl}, maxWeekPnL=$${poolMetrics.maxWeekPnl}`);

  // Step 4: Score & rank
  console.log('\n─── Step 4/4: Scoring & ranking ───────────');
  const scored = [];
  for (const [, data] of candidates) {
    const compositeScore = calculateCompositeScore(data._metrics, poolMetrics);

    // Skip traders with 0 score or no meaningful data
    if (compositeScore <= 0) continue;
    // Skip traders with negative all-time PnL
    if (data._metrics.totalPnl < 0) continue;

    scored.push({
      wallet: data.wallet,
      userName: data.userName,
      profileImage: data.profileImage,
      verified: data.verified,
      xUsername: data.xUsername,
      leaderboard: data.leaderboard,
      metrics: data._metrics,
      compositeScore,
      positions: data.positions,
    });
  }

  // Sort by composite score descending
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  // Take top N
  const top = scored.slice(0, TOP_N).map((t, i) => ({
    rank: i + 1,
    compositeScore: t.compositeScore,
    wallet: t.wallet,
    userName: t.userName,
    profileImage: t.profileImage,
    verified: t.verified,
    xUsername: t.xUsername,
    polymarketUrl: `https://polymarket.com/profile/${t.wallet}`,
    leaderboard: t.leaderboard,
    metrics: t.metrics,
    // Include top 20 positions by absolute PnL
    positions: (t.positions || [])
      .filter(p => p.size > 0.001)
      .sort((a, b) => Math.abs(b.cashPnl) - Math.abs(a.cashPnl))
      .slice(0, 20),
  }));

  // ── Output ──────────────────────────────────────────────────────────────
  const output = {
    generatedAt: new Date().toISOString(),
    totalCandidatesAnalyzed: candidates.size,
    scoringWeights: {
      roiPct: '25%',
      monthPnl: '20%',
      weekPnl: '15%',
      consistency: '15%',
      winRate: '10%',
      activity: '10%',
      budgetCompatibility: '5%',
    },
    traders: top,
  };

  const outDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'top10.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  // Print summary
  const elapsed = formatDuration(Date.now() - startTime);
  console.log(`\n  ✓ Scored ${scored.length} valid candidates`);
  console.log(`  ✓ Top ${TOP_N} saved to data/top10.json\n`);
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  #   Name                Score   ROI%     WinRate  MonthPnL       Positions  Budget ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════════════╣');
  for (const t of top) {
    const name = t.userName.padEnd(18).slice(0, 18);
    const score = String(t.compositeScore).padStart(6);
    const roi = (t.metrics.roiPct.toFixed(1) + '%').padStart(7);
    const wr = (t.metrics.winRate.toFixed(0) + '%').padStart(5);
    const mpnl = ('$' + abbreviateNum(t.metrics.monthPnl)).padStart(12);
    const pos = String(t.metrics.activePositions).padStart(5);
    const avgBudget = ('$' + abbreviateNum(t.metrics.medianPositionSize)).padStart(8);
    console.log(`║  ${String(t.rank).padStart(2)}  ${name}  ${score}  ${roi}    ${wr}   ${mpnl}      ${pos}   ${avgBudget} ║`);
  }
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\n  Done in ${elapsed}.`);
}

function abbreviateNum(n) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
}

main().catch(err => {
  console.error('\n✗ Fatal error:', err);
  process.exit(1);
});
