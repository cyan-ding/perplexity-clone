# Inquiry

Minimal Electron wrapper for `perplexity-clone.jsx`.

## Setup

1. Add your key to `.env`:

   ```sh
   PERPLEXITY_API_KEY=pplx-your-key-here
   ```

2. Install dependencies:

   ```sh
   npm install
   ```

3. Run the Mac desktop app in development:

   ```sh
   npm run dev
   ```

## Standalone Mac App

Build a Finder-launchable `.app`:

```sh
npm run dist
```

Then open:

```sh
open release/mac*/Inquiry.app
```

You can drag `Inquiry.app` into `/Applications`.

For a DMG installer instead:

```sh
npm run dist:dmg
```

The packaged app reads your key from the bundled `.env`. It also checks:

```sh
~/Library/Application Support/Inquiry/.env
```
