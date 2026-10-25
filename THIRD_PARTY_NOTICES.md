# Third-party notices

ChatRAG is MIT-licensed. This repository also contains, or installs, software
from other projects under their own licenses.

## Included in this repository

- **`baileys-whatsapp/`** is a copy of
  [Baileys](https://github.com/WhiskeySockets/Baileys), copyright Rajeh
  Taher/WhiskeySockets, under the MIT License. Its license is in
  [`baileys-whatsapp/LICENSE`](baileys-whatsapp/LICENSE). ChatRAG adds
  `server.ts`, an HTTP wrapper around it.

## Installed by npm, not included here

Everything under `node_modules` comes from the npm registry under its own
license. Most are MIT, Apache-2.0, ISC, or BSD. Two need a mention if you
redistribute built artifacts, such as a Docker image:

- **sharp** downloads prebuilt **libvips** binaries, which are LGPL-3.0-or-later.
- **`@ffmpeg-installer/ffmpeg`** (used by `voice-agent/`) downloads prebuilt
  **FFmpeg** binaries. Depending on the platform these are LGPL-2.1 or GPL-3.0.

Neither is part of this repository's source. If you ship an image or bundle
that contains them, you take on their license terms for that distribution.
