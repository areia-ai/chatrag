# Security

## Reporting

Email **hello@chatrag.ai** with `security` in the subject. Say what you found,
how to reproduce it, and what someone could do with it.

Don't open a public issue for anything that could be used against a running
deployment before it's fixed. There's no bounty; you get credit in the release
notes if you want it.

## What's worth reporting

ChatRAG is self-hosted, so every deployment is run by someone else. The reports
that matter are the ones that let a stranger reach data or actions they
shouldn't on a correctly configured install:

- One user, or one organization in multi-tenant mode, reading or changing
  another's chats, documents, or settings.
- Bypassing Supabase Row Level Security through an API route.
- Running MCP tools without the approval step.
- Forging WhatsApp webhooks or controlling the Baileys service without its
  `API_KEY`.
- The usual web classes (injection, SSRF, auth bypass) where they lead to
  someone else's data.

## Not a vulnerability

Running without the secrets the docs tell you to set: the Supabase service role
key exposed to the browser, the config UI (`npm run config`) reachable from the
internet, the Baileys service deployed without `API_KEY`. Those are deployment
mistakes, not bugs in ChatRAG.

## Supported versions

Only the latest release on `main` gets fixes.
