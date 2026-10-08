<p align="center"><img src="docs/banner.svg" alt="tradIA cloud" width="100%"></p>
<h1 align="center">TradIA Cloud</h1>
<p align="center"><a href="README.md">Español</a> · <a href="AVISO-LEGAL.md#disclaimer-english">Disclaimer</a> · <a href="LICENSE">MIT License</a></p>
<p align="center"><b>A crypto trading agent that lives in <i>your own cloud</i>, with your keys and your rules.</b><br>
Android app · Cloudflare Workers · GitHub Actions · several free AIs with consensus · exchanges via ccxt</p>

---

> [!IMPORTANT]
> **TradIA Cloud is NOT an exchange, broker, wallet or investment service.** It is free software that
> *links* your own exchange account to your own cloud. It never receives, holds or moves anyone's money.
> Not financial advice. Read the [disclaimer](AVISO-LEGAL.md#disclaimer-english).

> The app is currently in Spanish.

## What is an agent?

A bot follows fixed rules. An **agent** pursues the goal you give it and decides how, inside limits it cannot cross:

- **Observes** every 30 min: balances, prices, RSI/MACD, global markets (BTC, ETH, stocks, gold, oil) and last-24h headlines.
- **Reasons** by asking **several free AIs** at once (Groq, Gemini, OpenRouter, Cerebras, Mistral, or keyless Kilo/LLM7/OVH). They vote; the **consensus** wins, and a tie means wait.
- **Acts**: proposes orders you approve/edit/cancel, or executes them if you allow it.
- **Respects limits**: max amount per trade, **never sells at a loss** (default), **🪙 Accumulate**: coins like BTC it buys but never sells on its own.
- **Reports** every cycle, every AI vote and every order.

## Built for sharing: everyone uses THEIR cloud and THEIR keys

The app ships **empty**: no keys or accounts from anyone, including the author. Each person installs their own
copy on free GitHub + Cloudflare accounts; exchange keys live only as encrypted secrets of their private repo.

## AI models

All free and OpenAI-compatible; the cloud picks the best chat models available to your key automatically.
Groq ([gpt-oss-120b](https://huggingface.co/openai/gpt-oss-120b), [Qwen](https://huggingface.co/Qwen)) ·
[Gemini flash](https://ai.google.dev/gemini-api/docs/models) · [OpenRouter `:free`](https://openrouter.ai/models?max_price=0) ·
[Cerebras](https://inference-docs.cerebras.ai/models/overview) · [Mistral](https://docs.mistral.ai/getting-started/models/) ·
keyless: [Kilo](https://kilo.ai) (Nemotron, Laguna), [LLM7](https://llm7.io), [OVH](https://endpoints.ai.cloud.ovh.net).
See the full table in the [Spanish README](README.md#modelos-de-ia).

## Install

1. Install the APK from [Releases](../../releases) on Android.
2. Tap **Crear mi nube** and follow the wizard (GitHub token with `repo` + `workflow`, Cloudflare token "Edit Cloudflare Workers", optional AI key, exchange API key **without withdrawals**).
3. The app creates `your-user/tradia-nube` (private) from this template, deploys your Worker and runs the first cycle **in simulation**.

Exchanges: Hyperliquid and MEXC (no KYC), Crypto.com, Kraken, Coinbase, Bitstamp, Gate, or any ccxt id.
Binance/Bybit/OKX/KuCoin/Bitget are not offered because they block the US servers GitHub Actions runs on.

## Development

- `runner/` Python engine: `cd runner && python -m unittest discover -s tests`
- `worker/` Cloudflare Worker (TypeScript + KV)
- `app/android/` WebView app; UI tests: `cd app/pruebas && npm i && node ui.test.js`

MIT © 2026 TradIA Cloud contributors. Crypto trading is risky: only use money you can afford to lose.
