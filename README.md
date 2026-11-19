# Zhouyou Map Workspace

This branch contains the workspace commands, the [implementation plan](PLAN.md), the [Warm Days preview](preview-warm/README.md), and an Overture data inspection script. The production web app lives on the [`main` branch](https://github.com/Eldonwyd/zhouyou-app/tree/main).

## Run the web app from this workspace

Use Node.js 24 or later. From the workspace root, clone the web app into `web/` once, then install its dependencies.

```powershell
git clone --branch main --single-branch https://github.com/Eldonwyd/zhouyou-app.git web
npm --prefix web install
npm run dev
```

Open the address printed in the terminal. The development server provides the web app and the AI API on the same port. Use `npm run build` followed by `npm start` to run the production build on port 4173. For AI provider settings, copy `web/.env.example` to `web/.env.local` and use the [web app README](https://github.com/Eldonwyd/zhouyou-app/blob/main/README.md) as a reference.

Run `npm run dev:phone` to preview on a phone connected to the same Wi-Fi. Keep the computer and server running, then open the LAN address shown in the terminal. Voice recording and offline caching on a phone require a trusted HTTPS origin.

Travel records and media are stored in the current browser. Export a ZIP backup from the profile page to move them to another device, browser, or site address.

## Workspace commands

- `npm run test:maps` validates the packaged geographic boundaries.
- `npm run test:city-record`, `npm run test:mobile`, and `npm run test:theme` check browser workflows.
- `npm run test:planner` runs the AI planner test suite.
- `node preview-warm/server.mjs` starts the independent preview on port 5180.

Commit workspace documentation, scripts, and the independent preview from this directory. Commit web app changes from the separate `web/` checkout. The two checkouts track `workspace` and `main` on GitHub, respectively.
