# 🎙️ Earthora Farms Voice Ordering Agent Server

A standalone Node.js + TypeScript Fastify server providing real-time voice-driven ordering, multi-language speech AI, grounded knowledge base Q&A, and Razorpay Payment Link delivery for **Earthora Farms**.

---

## 🌟 Features & Overview

- **Telephony Integration**: Connected to **Tata SmartFlo** via HTTP webhooks and dual-way WebSocket audio streams.
- **Multilingual Support**: Supports **English, Hindi (`hi-IN`), and Gujarati (`gu-IN`)** with initial greeting language detection.
- **AI Stack & Primary Provider**: Powered by **Sarvam AI** (`saarika` for STT, `bulbul` for TTS) with **Anthropic Claude 3.5 Sonnet** (or `sarvam-2b`) for LLM tool calling.
- **Automatic Fallback Strategy**:
  - Automatically fails over to local PC services via Cloudflare Tunnel on 429 rate limits or 5xx errors:
    - **STT**: `faster-whisper` (`large-v3` model)
    - **TTS**: `Piper` (`hi_IN-hemant-medium`, `gu_IN-bhagat-medium`)
    - **LLM**: `Ollama` (`qwen2.5:7b` or `gemma3:4b`)
  - Includes an automatic 60-second health check loop that restores primary Sarvam AI when available.
- **Grounded Knowledge Base**: Grounded site content Q&A preventing hallucinated health or policy claims.
- **Automated Payment & Notifications**: Generates 24-hour Razorpay Payment Links delivered via Tata SmartFlow SMS and WhatsApp.
- **Auto-Expiry Cron**: 15-minute background cron (`node-cron`) executing `cancel_expired_voice_orders()`.

---

## 🔑 Environment Variables Reference

Copy `.env.example` to `.env` in `voice-agent-server/`:

| Variable | Description | Where to find |
|---|---|---|
| `PORT` | Server listening port (default: `8080`) | Local config / Railway |
| `SMARTFLO_WEBHOOK_SECRET` | Secret token matching Tata SmartFlo header signature | Tata SmartFlo Dashboard |
| `SARVAM_API_KEY` | Subscription key for Sarvam STT & TTS | [Sarvam AI Portal](https://dashboard.sarvam.ai) |
| `SARVAM_USE_LLM` | Set `true` to use Sarvam's `sarvam-2b` gateway instead of Claude | Optional (default: `false`) |
| `ANTHROPIC_API_KEY` | API Key for Claude 3.5 Sonnet LLM tool calling | [Anthropic Console](https://console.anthropic.com) |
| `LOCAL_STT_URL` | Tunnel/local URL for `faster-whisper` (port 8001) | Cloudflare Tunnel output |
| `LOCAL_TTS_URL` | Tunnel/local URL for `Piper` TTS (port 8002) | Cloudflare Tunnel output |
| `LOCAL_LLM_URL` | Tunnel/local URL for `Ollama` (port 11434) | Cloudflare Tunnel output |
| `LOCAL_LLM_MODEL` | Ollama model name (default: `qwen2.5:7b`) | Ollama CLI |
| `RAZORPAY_KEY_ID` | Razorpay Key ID | Razorpay Dashboard → API Keys |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret | Razorpay Dashboard → API Keys |
| `RAZORPAY_WEBHOOK_SECRET` | Secret configured for `payment_link.*` webhooks | Razorpay Dashboard → Webhooks |
| `WEBSITE_URL` | Public store domain (e.g. `https://earthorafarms.com`) | Store deployment |
| `SMARTFLOW_API_KEY` | Tata SmartFlow SMS API bearer token | Tata SmartFlow Dashboard |
| `SMARTFLOW_SENDER_ID` | Tata SmartFlow SMS Sender ID | Tata SmartFlow Dashboard |
| `SMARTFLOW_BASE_URL` | Tata SmartFlow API base URL | Tata SmartFlow Dashboard |
| `TATA_WHATSAPP_API_KEY` | Optional Tata WhatsApp API key | Tata Dashboard |
| `META_WHATSAPP_TOKEN` | Optional Meta WhatsApp Cloud API Token | Meta Developers Dashboard |
| `META_WHATSAPP_PHONE_NUMBER_ID` | Optional Meta Phone Number ID | Meta Developers Dashboard |
| `VITE_SUPABASE_URL` | Shared Supabase database URL | Supabase Dashboard → Settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service role secret key | Supabase Dashboard → Settings |

---

## 🛠️ Local Development Setup

### 1. Installation & Environment
```bash
# Navigate to voice-agent-server folder
cd voice-agent-server

# Install dependencies
npm install

# Copy environment template and fill in keys
cp .env.example .env
```

### 2. Start Local PC Fallback Services
In separate terminal windows (or your local development machine):

```bash
# 1. Start faster-whisper STT (Port 8001)
pip install faster-whisper flask
python ../local-services/whisper-server.py

# 2. Start Piper TTS (Port 8002)
pip install flask
python ../local-services/piper-server.py

# 3. Start Ollama LLM (Port 11434)
ollama run qwen2.5:7b
```

### 3. Expose Fallback Ports via Cloudflare Tunnel
Expose local PC ports so your deployed Railway voice server can reach them if Sarvam rate limits:
```bash
cloudflared tunnel --url http://localhost:8001
cloudflared tunnel --url http://localhost:8002
cloudflared tunnel --url http://localhost:11434
```
Paste the generated HTTPS tunnel URLs into `LOCAL_STT_URL`, `LOCAL_TTS_URL`, and `LOCAL_LLM_URL` in `.env`.

### 4. Run Knowledge Base Seeder
Populate qualitative product Q&A and site facts into Supabase:
```bash
# Run from repository root
npm run seed:knowledge
```

### 5. Start Development Voice Server
```bash
npm run dev
```

---

## 🚀 Railway Deployment Guide

1. **GitHub Setup**: Push `voice-agent-server/` to GitHub (or select subfolder root).
2. **Create Railway Project**:
   - Go to [Railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
   - Set **Root Directory** to `voice-agent-server`.
3. **Configure Environment Variables**:
   - Add all environment variables listed above in the Railway Dashboard.
4. **Deploy & Webhook Registration**:
   - Railway provides a public URL (e.g. `https://voice-agent.up.railway.app`).
   - **Tata SmartFlo**: Configure webhook target to `https://voice-agent.up.railway.app/webhooks/smartflo/incoming-call`.
   - **Razorpay Dashboard**: Register webhook endpoint to `https://voice-agent.up.railway.app/webhooks/razorpay` for events `payment_link.paid`, `payment_link.expired`, and `payment_link.cancelled`.

---

## 🧪 Testing & Verification

### 1. Health & Provider Status Endpoint
Check service status and current AI provider failover state:
```bash
curl http://localhost:8080/health
```
Response:
```json
{
  "status": "ok",
  "service": "Earthora Voice Agent Server",
  "telephonyProvider": "Tata SmartFlo",
  "providers": {
    "speechProvider": "sarvam",
    "llmProvider": "anthropic",
    "isSarvamDegraded": false,
    "degradedSince": null
  }
}
```

### 2. SmartFlo Incoming Webhook Test
```bash
curl -X POST http://localhost:8080/webhooks/smartflo/incoming-call \
  -H "Content-Type: application/json" \
  -H "Authorization: your-smartflo-webhook-secret" \
  -d '{"call_id": "test_call_101", "caller_phone": "9876543210"}'
```
