# Warm Days Preview

Warm Days is an independent preview of three screens in Zhouyou Map. It includes a travel journal, achievements, and a profile. The dates, counts, notes, and scenery are sample data.

## Run the preview

```powershell
node preview-warm/server.mjs
```

Open `http://localhost:5180/`. To run the browser checks, start the preview, install the web app dependencies, and run `node preview-warm/check.mjs`. The check uses Chrome installed in its default Windows location.

The preview has its own browser origin and uses the `travel-warm-preview-v1` local storage key. You can switch between the three screens, filter records, add notes and photo covers, save favorites, download postcards, create badges, edit your profile, switch palettes, and import or export preview data as JSON. The full web app, including AI planning, voice recordings, ZIP backups, and spending, is on the [`main` branch](https://github.com/Eldonwyd/zhouyou-app/tree/main).

## Design references

- [Polarsteps](https://www.polarsteps.com/) for photo-led travel reviews.
- [Day One](https://dayoneapp.com/guides/tips-and-tutorials/journal-views-in-day-one-for-ios/) for browsing memories over time and by location.
- [1 Second Everyday](https://1se.co/) for gathering everyday moments.

The scenery examples come from Unsplash and are packaged with the preview. They are layout examples. System fonts are used when the web font is unavailable.
