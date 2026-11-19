# Local Place Data Packs

The app reads the JSON files in this directory and looks up places by city, name, and aliases. Runtime lookups require neither Python nor a third-party API key.

## Overture Maps

`yunnan-overture.json` contains a pilot sample of 20 Kunming records extracted from the official [Overture Maps Places data](https://docs.overturemaps.org/guides/places/). It is not a comprehensive Yunnan or national dataset. The extraction script can be adapted to Dali, Lijiang, and Shangri-La.

The pack accepts records under CDLA-Permissive-2.0 or CC0-1.0. Each record retains its source, version, and original provenance. Include the CDLA license file from this directory when distributing the pack.

Install DuckDB with `python -m pip install duckdb`, then run `python scripts/build-overture-place-pack.py` from the web repository. Update the script's regions to add areas. Restart the backend after updating a pack. Place records do not verify current opening status or review quality.

## Wikidata

`yunnan-wikidata.json` caches checked locations for Dali Railway Station, Lijiang Railway Station, and Dukezong Ancient Town, with entity links. Dukezong is displayed as an approximate area point. Wikidata structured coordinates use [CC0](https://www.wikidata.org/wiki/Wikidata:Licensing).

Run `node scripts/build-wikidata-place-pack.mjs` to add missing records. The script preserves existing data when requests are rate-limited. The separate 2018 national POI dataset from Peking University requires an account download and is not bundled.

## Import another source

Use a source with a license that permits the intended use. The JSON top level contains a `records` array. Records include `name`, `aliases`, `city`, `longitude`, `latitude`, `coordinateSystem`, `source`, `sourceUrl`, and `license`. Coordinates must come from the cited source. Convert GCJ-02 coordinates before labeling them WGS84.
