# PolyScan

**Polymarket Copy Trading Scanner** — Identifies the top 10 most interesting traders to copy on Polymarket, updated daily.

## 🎯 Purpose

PolyScan analyzes the Polymarket leaderboard and individual trader positions to find the best wallets for copy trading via [Polycop](https://t.me/PolyCop_BOT). It calculates a composite score based on:

| Weight | Metric              | Why it matters                               |
|--------|---------------------|----------------------------------------------|
| 25%    | ROI %               | Capital efficiency — crucial for small budgets |
| 20%    | PnL (30 days)       | Recent performance                           |
| 15%    | PnL (7 days)        | Short-term momentum                          |
| 15%    | Consistency         | Present in leaderboard across multiple periods |
| 10%    | Win Rate            | % of profitable positions                    |
| 10%    | Activity Level      | Sweet spot of 5-25 active positions          |
| 5%     | Budget Compatibility | Slight penalty for huge average position sizes |

## 🚀 Quick Start

### 1. Generate data
```bash
cd backend
npm install
cd ..
node backend/fetch-data.js
```

### 2. View the dashboard
Open `index.html` in your browser, or serve it locally:
```bash
npx -y serve .
```

### 3. Copy a wallet
Click the 📋 button next to any trader to copy their wallet address, then paste it into Polycop.

## 🔄 Auto-Updates

The GitHub Action (`.github/workflows/update-data.yml`) runs daily at **8:00 AM Paris time** and commits the updated `data/top10.json`. You can also trigger it manually from the Actions tab.

## 📁 Project Structure

```
PolyScan/
├── backend/
│   ├── fetch-data.js     # Data fetcher & scoring engine
│   └── package.json
├── data/
│   └── top10.json        # Generated daily (committed by bot)
├── .github/workflows/
│   └── update-data.yml   # Daily cron job
├── index.html            # Dashboard interface
├── style.css             # Styles
├── app.js                # Frontend logic
└── README.md
```

## ⚠️ Disclaimer

This tool is for informational purposes only. Copy trading on prediction markets carries significant risks including but not limited to:

- **Execution latency** — you may get worse prices than the copied trader
- **Slippage** — especially in low-liquidity markets
- **Past performance ≠ future results** — a trader's history doesn't guarantee future success
- **Market risk** — prediction markets can be highly volatile

Always do your own research (DYOR) and never invest more than you can afford to lose.

## 📜 License

This project is licensed under the [MIT License](LICENSE).
