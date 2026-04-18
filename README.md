# CipherStack

Node-based **cascade encryption** UI for the Vyro hackathon (CipherStack / CipherStack problem). Users build a **linear pipeline** of at least **three** cipher nodes, configure each instance, **reorder** or **insert** nodes, then **encrypt** or **decrypt** while viewing **per-node input and output**.

## Tech stack

- [Vite](https://vitejs.dev/) + [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- Pure cipher logic in `src/ciphers/` and `src/lib/` (easy to unit test)
- [Vitest](https://vitest.dev/) for round-trip and pipeline tests

## Cipher behavior (design notes)

- **Caesar** — shifts **A–Z** and **a–z** only; other characters unchanged. `shift` is an integer (decrypt uses the inverse shift).
- **Vigenère** — classic tabula recta on letters only; non-letters pass through and **do not** advance the key index. Keyword must contain at least one letter (non-letters in the keyword are stripped).
- **XOR (UTF-8 → Base64)** — UTF-8 encodes the incoming string, XORs with a **repeating UTF-8 key**, outputs **standard Base64**. Decrypt decodes Base64 then XORs with the same key and UTF-8 decodes. This keeps the pipeline as a string chain even after binary mixing.
- **Extras** (do not count toward the “3 configurable types” rule): **Reverse string**, **Base64 (UTF-8)** encode/decode as separate node types.

## Requirements checklist

| Requirement | How it is met |
|---------------|----------------|
| ≥ 3 **configurable** cipher **types** in the library | Caesar, Vigenère, XOR (extras labeled separately). |
| Pipeline needs **≥ 3 nodes** to run | Run is disabled until the pipeline validates; executor enforces the same minimum. |
| Encrypt forward + **decrypt in reverse** with inverses | `runForward` / `runBackward` in `src/lib/executor.ts`. |
| Intermediate I/O per node | After each run, each card shows last **input/output** for that node. |
| README + run instructions | This file. |

## Scripts (PowerShell)

```powershell
cd D:\vyro-hackathon-cursor   # or your clone path
npm install
npm run dev      # development server
npm run build    # typecheck + production bundle to dist/
npm run preview  # serve dist locally
npm run test     # Vitest
```

## Deploy

The app is static after `npm run build`.

- **Netlify:** this repo includes [`netlify.toml`](netlify.toml) (`publish = dist`). Connect the Git repo in the Netlify UI and deploy.
- **Vercel / Cloudflare Pages:** set build command `npm run build` and output directory `dist`.

After the first deploy, set your live URL in the repo description and replace the line below.

**Deployed URL:** _add after first deploy_

## Project layout

- `src/ciphers/` — cipher definitions + `registry.ts`
- `src/lib/executor.ts` — pipeline runner and `MIN_PIPELINE_NODES`
- `src/App.tsx` — UI (palette, pipeline, I/O panel)
- `src/ciphers/ciphers.test.ts` — round-trip tests
