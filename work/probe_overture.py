"""仅探测公开 Overture 文件结构，扩展和缓存留在工作目录。"""
import json
import sys
from pathlib import Path
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).parent / "poi-python"))
import duckdb

connection = duckdb.connect(config={"extension_directory": str(Path(__file__).parent / "duckdb-extensions")})
connection.execute("INSTALL httpfs; LOAD httpfs;")
connection.execute("SET s3_region='us-west-2'; SET http_timeout=20000;")
with urlopen("https://stac.overturemaps.org/catalog.json", timeout=20) as response:
    release = json.load(response)["latest"]
source = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"
print("Release:", release, flush=True)
print(connection.execute("DESCRIBE SELECT * FROM read_parquet(?, hive_partitioning=true)", [source]).fetchall(), flush=True)
records = connection.execute("""
    SELECT id, names, addresses, sources, bbox, geometry
    FROM read_parquet(?, hive_partitioning=true)
    WHERE bbox.xmin BETWEEN 102.63 AND 102.77 AND bbox.ymin BETWEEN 24.95 AND 25.10
    LIMIT 10
""", [source]).fetchall()
for record in records:
    print(repr(record), flush=True)
