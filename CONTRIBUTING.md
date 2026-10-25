# Contributing

Thanks for looking. ChatRAG is open in full: the Next.js app, the config UI,
the voice agent, and the WhatsApp service.

## Pull requests are open

There's no contributor license agreement to sign. ChatRAG is MIT-licensed, and
by opening a pull request you agree that your contribution is released under
the same [MIT License](LICENSE) as the rest of the project. Make sure it's
yours to give: code you wrote, or code under a license compatible with MIT,
with its notice kept.

Every pull request is read and decided on its own merits. For anything bigger
than a fix, open an issue first so we can agree on the approach before you put
the work in.

## Where things go

- **Issues** are for bugs, setup trouble, and feature proposals.
- **[Discord](https://discord.gg/nneEjqteT)** is for questions, help from other
  builders, and showing what you made.
- **Security** reports go to the address in [SECURITY.md](SECURITY.md), not a
  public issue.
- **Forks** are welcome, including commercial ones. The MIT License covers
  that. It doesn't cover the ChatRAG name or logo, so if you publish or sell
  your own version, give it its own name. See [TRADEMARKS.md](TRADEMARKS.md).

## Before you open a pull request

[AGENTS.md](AGENTS.md) is the working guide for anyone, human or AI agent,
changing this code. It covers the layout, the conventions, and the places that
must stay in sync (models are listed in five files). Read it first, then run:

```bash
npm run lint
```

```bash
npx tsc --noEmit
```

```bash
npm run build
```

If you touched `voice-agent/` or `baileys-whatsapp/`, build that package too.

Local setup is in the [README](README.md#-quick-start). Never commit secrets,
real phone numbers, or customer data. Use placeholder values in tests and docs.
