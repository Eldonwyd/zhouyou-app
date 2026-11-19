"""按城市范围提取可分发的 Overture 地点包。仅构建时需要 DuckDB，应用运行无需 Python。"""
import argparse
import json
from pathlib import Path
import struct
import sys
from urllib.request import urlopen

sys.stdout.reconfigure(encoding="utf-8")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--dependency-dir", type=Path, help="可选的DuckDB Python依赖目录")
parser.add_argument("--output", type=Path, default=Path(__file__).parents[1] / "data/places/yunnan-overture.json")
parser.add_argument("--limit", type=int, default=200, help="试用包最大记录数；避免首次试验扫描完整全球数据")
parser.add_argument("--city", help="只提取指定城市的小样本")
arguments = parser.parse_args()
if arguments.dependency_dir:
    sys.path.insert(0, str(arguments.dependency_dir))
import duckdb

# 只提取本次行程涉及的城市，不下载全国数据库。坐标为WGS84。
regions = [
    ("昆明市", (102.5, 24.8, 103.0, 25.3)),
    ("大理市", (100.05, 25.5, 100.35, 25.95)),
    ("丽江市", (100.1, 26.7, 100.4, 27.2)),
    ("香格里拉市", (99.5, 27.6, 99.9, 28.0)),
]
if arguments.city:
    regions = [region for region in regions if region[0] == arguments.city]
    if not regions:
        raise ValueError("city不在regions定义中")
extension_path = Path(__file__).parents[2] / "work/duckdb-extensions"
database = duckdb.connect(config={"extension_directory": str(extension_path)})
database.execute("INSTALL httpfs; LOAD httpfs;")
database.execute("SET s3_region='us-west-2'; SET http_timeout=30000;")
with urlopen("https://stac.overturemaps.org/catalog.json", timeout=20) as response:
    release = json.load(response)["latest"]
source = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"
conditions = " OR ".join("(bbox.xmin BETWEEN ? AND ? AND bbox.ymin BETWEEN ? AND ?)" for _ in regions)
parameters = [source]
for _, (west, south, east, north) in regions:
    parameters.extend([west, east, south, north])
print(f"正在提取 Overture {release} {','.join(city for city, _ in regions)} 小样本（最多{arguments.limit}条）…", flush=True)
rows = database.execute(f"""
    SELECT id, names, addresses, sources, geometry, operating_status
    FROM read_parquet(?, hive_partitioning=true)
    WHERE ({conditions}) AND confidence >= 0.6 LIMIT {arguments.limit}
""", parameters).fetchall()
records = []
for identifier, names, addresses, sources, geometry, status in rows:
    # 本包只接受CDLA/CC0数据，其他许可须另带所需NOTICE后才能加入。
    licenses = {item.get("license") for item in sources or []}
    if not licenses or not licenses <= {"CDLA-Permissive-2.0", "CC0-1.0"} or status == "permanently_closed":
        continue
    raw = bytes(geometry)
    endian = "<" if raw[0] == 1 else ">"
    if len(raw) != 21 or struct.unpack(endian + "I", raw[1:5])[0] != 1:
        continue
    longitude, latitude = struct.unpack(endian + "dd", raw[5:])
    city = next((city for city, (west, south, east, north) in regions if west <= longitude <= east and south <= latitude <= north), None)
    if not city or not names or not names.get("primary"):
        continue
    aliases = list(set((names.get("common") or {}).values()) - {names["primary"]})
    records.append({
        "id": identifier, "name": names["primary"], "aliases": aliases, "city": city,
        "longitude": longitude, "latitude": latitude, "coordinateSystem": "WGS84",
        "source": "Overture Places", "sourceUrl": "https://docs.overturemaps.org/guides/places/",
        "license": "CDLA-Permissive-2.0" if "CDLA-Permissive-2.0" in licenses else "CC0-1.0",
        "release": release, "provenance": sources,
    })
arguments.output.parent.mkdir(parents=True, exist_ok=True)
arguments.output.write_text(json.dumps({"release": release, "regions": regions, "records": records}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"output": str(arguments.output), "records": len(records), "byCity": {city: sum(item["city"] == city for item in records) for city, _ in regions}}, ensure_ascii=False), flush=True)
