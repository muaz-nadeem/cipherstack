# CipherStack

Cascading cipher playground for the Vyro hackathon. Build a pipeline of cipher nodes, configure each node, then run encrypt/decrypt and inspect intermediate results.

## Why this tech stack

- **React + TypeScript**: fast UI iteration with type safety for cipher configs and node state.
- **Vite**: quick local dev startup and simple static production build.
- **Vitest**: lightweight unit tests for cipher round-trips and pipeline behavior.
- **Modular cipher layer** (`src/ciphers/`, `src/lib/`): keeps encryption logic isolated from UI so it stays easy to test and extend.

## Run locally (PowerShell)

```powershell
cd D:\vyro-hackathon-cursor
npm install
npm run dev
```

## Other useful scripts (PowerShell)

```powershell
npm run test
npm run build
npm run preview
```

## Deployed URL

**Deployed URL:** https://cipherstack-xi.vercel.app
