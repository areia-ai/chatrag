# Deploying the ChatRAG Voice Agent to Fly.io

> **Quick Start Guide** for deploying the voice agent as an always-on worker process.

---

## Prerequisites

| Service | Purpose | Sign Up |
|---------|---------|---------|
| **Fly.io** | Hosting | [fly.io/app/sign-up](https://fly.io/app/sign-up) |
| **LiveKit Cloud** | Real-time audio | [cloud.livekit.io](https://cloud.livekit.io) |
| **AssemblyAI** | Speech-to-text | [assemblyai.com](https://www.assemblyai.com) |
| **Resemble.ai** | Text-to-speech | [app.resemble.ai](https://app.resemble.ai) |
| **Groq** (recommended) | LLM responses | [console.groq.com](https://console.groq.com) |

### Install Fly CLI

```bash
# macOS
brew install flyctl

# macOS/Linux (alternative)
curl -L https://fly.io/install.sh | sh
```

---

## Deployment Steps

### 1. Navigate to voice-agent directory

```bash
cd voice-agent
```

### 2. Authenticate with Fly.io

```bash
fly auth login
```

### 3. Update the app name

Edit `fly.toml` and change `app = 'chatrag-voice-agent'` to something globally unique.

### 4. Create the application

```bash
fly apps create --name your-unique-app-name
```

### 5. Set environment secrets

```bash
fly secrets set \
  LIVEKIT_URL=wss://your-project.livekit.cloud \
  LIVEKIT_API_KEY=your_livekit_api_key \
  LIVEKIT_API_SECRET=your_livekit_api_secret \
  ASSEMBLYAI_API_KEY=your_assemblyai_key \
  RESEMBLE_API_KEY=your_resemble_key \
  RESEMBLE_VOICE_ID=your_voice_id \
  RESEMBLE_STREAM_URL=https://f.cluster.resemble.ai/stream \
  CHATRAG_INTERNAL_API_URL=https://your-app.vercel.app/api/internal/voice-rag \
  CHATRAG_INTERNAL_API_KEY=your_internal_api_key \
  GROQ_API_KEY=your_groq_key \
  VOICE_AGENT_LLM_PROVIDER=groq \
  VOICE_AGENT_MODEL=llama-3.3-70b-versatile
```

### 6. Deploy

```bash
fly deploy
```

### 7. Verify deployment

```bash
fly status
fly logs
```

**Expected healthy logs:**
```
Voice Agent starting...
[Agent] Silero VAD loaded successfully
[VoicePipeline] Using Groq API with model: llama-3.3-70b-versatile
[LiveKit] Connected to room: chatrag-voice
```

---

## Architecture

The Voice Agent runs as a **worker process** (not a web server). It connects outbound to LiveKit Cloud:

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   Browser/App   │◄─────►│  LiveKit Cloud  │◄─────►│   Voice Agent   │
│   (Frontend)    │       │   (Signaling)   │       │   (Fly.io)      │
└─────────────────┘       └─────────────────┘       └────────┬────────┘
                                                             │
                                                             ▼
                                                    ┌─────────────────┐
                                                    │  ChatRAG API    │
                                                    │  (Vercel/etc)   │
                                                    └─────────────────┘
```

---

## Cost

| Component | Configuration | Monthly Cost |
|-----------|---------------|--------------|
| Compute | `shared-cpu-1x` @ 512MB | ~$3.19 |
| Bandwidth | Minimal (audio via LiveKit) | ~$0.50 |
| **Total** | | **~$3-4/month** |

---

## Available Regions

Choose a `primary_region` in `fly.toml` close to your users:

| Code | Location |
|------|----------|
| `iad` | Virginia, US |
| `sjc` | California, US |
| `lhr` | London, UK |
| `fra` | Frankfurt, DE |
| `nrt` | Tokyo, JP |
| `syd` | Sydney, AU |

---

## Common Commands

```bash
# View logs
fly logs

# Check status
fly status

# Update a secret
fly secrets set GROQ_API_KEY=new_value

# Restart
fly machine restart

# SSH into container
fly ssh console
```

---

## Troubleshooting

### "failed to retrieve region info"

The container is missing CA certificates. Ensure `Dockerfile` includes:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
```

### "MISSING OR PLACEHOLDER CONFIGURATION"

Environment secrets were not set. Run `fly secrets list` to verify, then re-run `fly secrets set`.

### Agent keeps restarting

1. Check for missing secrets
2. Consider increasing memory to `1024mb` in `fly.toml`
3. Check logs for JavaScript errors

---

## Frontend Configuration

The frontend does **NOT** connect directly to Fly.io. Both connect to LiveKit Cloud:

```bash
# Set these in your Next.js environment
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
```

---

## More Information

For the complete, detailed guide, see: [`VOICE_AGENT_FLY_IO_GUIDE.md`](./VOICE_AGENT_FLY_IO_GUIDE.md)
