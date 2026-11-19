# Zhouyou Map

Zhouyou Map is a browser-based travel journal, footprint map, and AI itinerary planner. It uses React, Vite, TypeScript, and a local Node.js service. The application interface is in Chinese.

## Quick start

Use Node.js 24 or later.

```powershell
npm install
npm run dev
```

Open the address printed in the terminal. The development server uses port 5173 by default and serves both the web app and the planner API. Run `npm run build` and then `npm start` or `npm run preview` to serve the production build from `dist/` on port 4173.

To preview on a phone on the same Wi-Fi, run `npm run dev:phone` and open the displayed LAN address. Use a trusted HTTPS origin for offline caching and microphone access on a phone.

## Features

- **Footprint map.** Browse packaged province and city boundaries. Confirm a city visit to light it up. Planned cities stay unmarked until you confirm a visit. Cache selected province maps for offline browsing.
- **Travel journal.** Save memories by city or organize them into trips with dates and companions. Add place notes, photos, video, and voice recordings. The journal groups photos by date and time and asks for confirmation when GPS data points to a different city.
- **AI planner.** Discover seasonal destinations or plan around your dates, budget, travelers, and preferences. Review suggested routes, transfers, lodging, and activities. Discuss and apply scoped changes, lock activities, and restore revisions.
- **Budget and bookings.** Track estimated and actual costs, split group expenses, import booking details or screenshots, and export calendar reminders or a self-contained offline HTML itinerary. Linking a plan to a trip preserves existing actual spending and manual edits.
- **Achievements.** Track visited cities, travel milestones, and badges, and download posters. The traveler roadmap shows progress toward the next milestone.

Records and media are stored in the current browser's IndexedDB. Use the profile page to export or restore a ZIP backup before changing device, browser, port, or site address. ZIP v3 supports planner photos, conversations, and revisions. Older v1 and v2 backups can still be imported.

## Configure AI and online services

Copy `.env.example` to `.env.local`. Enter provider settings there or use the planner's AI configuration screen. For DeepSeek, use `DEEPSEEK_API_KEY`. Restart the local service after editing the environment file directly. Provider credentials, local sessions, and runtime caches are excluded from Git.

Online references retain their lookup dates and source links. Prices and schedules that cannot be verified are shown as estimates or left for confirmation. Configure `AMAP_WEB_SERVICE_KEY` with Amap place-search access to enable precise place lookup. The Leaflet map uses [OpenStreetMap tiles](https://operations.osmfoundation.org/policies/tiles/) by default. Set `PLANNER_MAP_TILE_URL` to use a compatible alternative.

### Photos and Xiaohongshu

The planner looks for photos in public Xiaohongshu posts, Wikimedia Commons, and other web sources. Wikimedia Commons needs no separate key. Set `BRAVE_IMAGE_SEARCH_KEY` to use Brave Images if your account has that API entitlement. Searching by trip month gives matching results priority while allowing relevant images from other months. Downloaded photos are checked, compressed to WebP, and saved in `.planner-photos/` and browser storage. Available source links and license information are retained.

On Windows x64, `npm run setup:xhs` installs the pinned [xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) release for optional in-app search. The installer verifies its SHA-256 digest. The local tool uses `127.0.0.1:18060` and stores session files in `.xhs-local/`. Open Photo Sources in the app to request a sign-in QR code. The planner falls back to public sources when account search is unavailable.

## Tests

Browser smoke tests use local Chrome and expect the development server to be running.

```powershell
npm run test:maps
npm run test:web
npm run test:migration
npm run test:finance
npm run test:city-record
npm run test:mobile
npm run test:planner
```

For offline checks, build and start the production server, then run `node scripts/offline-smoke.mjs`. `npm run test:planner:live` and the live photo scripts use your configured provider and may consume quota.

## Map data

`public/maps/china.json` defines 34 provincial areas. Province files use administrative area codes and contain city or directly administered boundaries. Review the underlying DataV data terms and applicable map publication requirements before redistributing geographic data.
