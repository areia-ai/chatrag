# WhatsApp Integration (Baileys)

**Status:** ✅ **PRODUCTION-READY**  
**Last Updated:** January 8, 2026

---

## Overview

ChatRAG integrates with WhatsApp using [Baileys](https://baileys.wiki/), an open-source library that emulates the WhatsApp Web API. This allows you to deploy a lightweight service that connects your ChatRAG AI assistant to WhatsApp, enabling real-time messaging with your users.

Unlike official WhatsApp Business API solutions that charge per conversation, this integration works with any WhatsApp account (Personal or Business) and incurs no per-message fees.

### Technology Stack

| Component | Technology |
|-----------|------------|
| Wrapper Library | [Baileys](https://baileys.wiki/) (WhatsApp Web API emulation) |
| Runtime | Node.js |
| Deployment | [Fly.io](https://fly.io/docs/), [Railway](https://docs.railway.com/), [Render](https://render.com/docs), or [Koyeb](https://www.koyeb.com/docs) |
| Integration | Webhooks & REST API |
| Session Storage | Persistent Volumes (recommended) or Local File System |

---

## Features

- **Multi-Device Support:** Use WhatsApp on your phone while ChatRAG handles messages independently via the multi-device protocol.
- **Session Persistence:** Sessions are saved to persistent storage, ensuring connection survival across deployments and restarts.
- **QR Code Authentication:** Simple setup by scanning a QR code from your phone (Settings -> Linked Devices).
- **Auto-Reconnection:** Automatically attempts to reconnect if the connection drops.
- **Webhook Delivery:** Reliable message delivery to ChatRAG with status tracking.
- **Message Queue:** Built-in queue handles message bursts to prevent rate-limiting.
- **Media Support:** Send and receive images and text (video support varies by underlying LLM).

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                   ChatRAG (Next.js)                    │
│  ┌───────────────┐                                     │
│  │ Webhook API   │ <────── (Incoming Messages) ──────┐ │
│  └───────┬───────┘                                   │ │
│          │                                           │ │
│          │ (Outgoing Responses)                      │ │
│          ▼                                           │ │
└──────────┼───────────────────────────────────────────┼─┘
           │ REST API (HTTPS)                          │
           ▼                                           │
┌──────────────────────────────────────────────────────┼─┐
│           Baileys Service (Node.js)                  │ │
│  ┌───────────────┐    ┌───────────────────────────┐  │ │
│  │ API Server    │    │ Baileys Core              │  │ │
│  │ (Express)     │────┤ (WhatsApp Web Emulation)  │  │ │
│  └───────────────┘    └─────────────┬─────────────┘  │ │
│                                     │                │ │
│                                     ▼                │ │
│                              ┌─────────────┐         │ │
│                              │ WhatsApp    │         │ │
│                              │ Servers     │         │ │
│                              └─────────────┘         │ │
└────────────────────────────────────────────────────────┘
```

The integration consists of two parts:
1.  **Baileys Service:** A standalone Node.js app (included in `baileys-whatsapp/`) that maintains the persistent WebSocket connection to WhatsApp.
2.  **ChatRAG Core:** Connects to the Baileys service to send messages and receives incoming user messages via webhooks.

---

## Quick Start

The Baileys service is included in the ChatRAG monorepo at `baileys-whatsapp/`. You do not need to clone a separate repository.

### Prerequisites

1.  **WhatsApp Account:** A valid WhatsApp account (can be personal or business) on a mobile device.
2.  **Hosting Account:** Fly.io, Railway, Render, or Koyeb account for deploying the service.
3.  **ChatRAG Instance:** A running ChatRAG deployment (local or production).

---

## Deployment Guides

### Option 1: Fly.io (Recommended)

Fly.io is recommended because it offers persistent volumes, which are critical for saving authentication sessions.

1.  **Install Fly CLI:** `curl -L https://fly.io/install.sh | sh`
2.  **Navigate to Directory:** `cd baileys-whatsapp`
3.  **Launch App:**
    ```bash
    flyctl launch
    # Follow prompts:
    # - App Name: choose a unique name (e.g., chatrag-whatsapp)
    # - Region: select closest to you
    # - Postgres: No
    # - Redis: No
    ```
4.  **Create Persistent Volume:**
    This volume stores your session credentials so you don't have to rescan the QR code on every restart.
    ```bash
    flyctl volumes create baileys_data --size 1 --region <your-region>
    ```
    *Ensure your `fly.toml` includes:*
    ```toml
    [mounts]
      source = "baileys_data"
      destination = "/app/baileys_auth_info"
      processes = ["app"]
    ```
5.  **Deploy:**
    ```bash
    flyctl deploy
    ```

### Option 2: Railway

1.  Create a new project on [Railway](https://railway.app).
2.  Connect your ChatRAG GitHub repository.
3.  **Root Directory:** Set to `baileys-whatsapp`.
4.  **Build Command:** `yarn install && yarn build`
5.  **Start Command:** `node lib/server.js`

### Option 3: Render

1.  Create a new Web Service on [Render](https://render.com).
2.  Connect your repo.
3.  **Root Directory:** `baileys-whatsapp`.
4.  **Build Command:** `yarn install && yarn build`.
5.  **Start Command:** `node lib/server.js`.

### Option 4: Koyeb

1.  Create a new App on [Koyeb](https://koyeb.com).
2.  **Root Directory:** `baileys-whatsapp`.
3.  **Build Command:** `yarn install && yarn build`.
4.  **Run Command:** `node lib/server.js`.

---

## Configuration

### 1. ChatRAG (Main App) Configuration

In your ChatRAG `.env.local` or production environment variables, configure the connection:

```bash
# Enable WhatsApp Integration
NEXT_PUBLIC_WHATSAPP_ENABLED=true

# Provider Settings
WHATSAPP_PROVIDER=flyio  # Options: flyio, koyeb, railway, render
FLYIO_BAILEYS_URL=https://your-app-name.fly.dev  # The URL of your deployed Baileys service
FLYIO_API_KEY=your-api-key  # Must match API_KEY in the Baileys service

# Webhook Configuration (How Baileys talks to ChatRAG)
WHATSAPP_WEBHOOK_URL=https://your-chatrag-domain.com
WHATSAPP_WEBHOOK_SECRET=your-secure-secret  # Must match the secret in Baileys service env vars if set
```

### 2. Baileys Service Configuration

Set these environment variables in your deployment platform (Fly.io, Railway, etc.):

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Service port | `8080` (or provider default) |
| `WEBHOOK_URL` | Full URL to ChatRAG webhook | `https://your-chatrag-domain.com/api/whatsapp/webhook` |
| `API_KEY` | Bearer token ChatRAG must send on every request except `/health`. Must match `FLYIO_API_KEY` | (Required in production) |
| `WEBHOOK_SECRET` | Signs webhooks to ChatRAG. Must match `WHATSAPP_WEBHOOK_SECRET`. ChatRAG also registers it at runtime; webhooks are not sent without one | (Recommended) |
| `USE_PAIRING_CODE` | Use code instead of QR | `false` |
| `PHONE_NUMBER` | Phone # if using Pairing Code | (Required if `USE_PAIRING_CODE=true`) |

---

## Troubleshooting

### QR Code Not Generating
- **Check URL:** Verify `FLYIO_BAILEYS_URL` (or equivalent) in ChatRAG config matches your deployed service URL.
- **Check Logs:** View logs (`flyctl logs`, Railway logs) to ensure the service started successfully.

### Messages Not Delivered to ChatRAG
- **Public URL:** Ensure `WHATSAPP_WEBHOOK_URL` is publicly accessible.
    - *Local Dev:* Use [ngrok](https://ngrok.com) (`ngrok http 3000`) and set that as your webhook URL.
- **Secret Match:** Verify `WHATSAPP_WEBHOOK_SECRET` is identical in both ChatRAG and the Baileys service.

### Connection Drops / Frequent Logouts
- **Persistence:** Ensure you are using **Persistent Volumes** (essential for Fly.io). Without this, the `/app/baileys_auth_info` folder is wiped on restart, deleting your session.
- **Alive Keep:** Ensure your hosting provider doesn't put the app to sleep aggressively (Fly.io scales to 0 if not configured otherwise; ensure min_machines > 0).

---

## Local Development

You can run the Baileys service locally for testing:

1.  **Navigate & Install:**
    ```bash
    cd baileys-whatsapp
    yarn install
    ```
2.  **Start Service:**
    ```bash
    yarn dev
    # Running on http://localhost:8000
    ```
3.  **Expose ChatRAG:**
    Use [ngrok](https://ngrok.com) to expose your main ChatRAG app (running on 3000):
    ```bash
    ngrok http 3000
    ```
4.  **Configure ChatRAG:**
    Set `WHATSAPP_WEBHOOK_URL=https://<your-ngrok-id>.ngrok-free.app` in Config UI.
