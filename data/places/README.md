# 本地地点数据包

应用读取此目录下的JSON文件，按城市、名称和别名查询，运行时不需要Python或第三方Key。

`yunnan-overture.json` 由 `scripts/build-overture-place-pack.py` 从Overture官方数据提取；当前仅是**昆明20条试用记录**，不是全国或完整云南数据库。脚本支持扩展到大理、丽江、香格里拉。

- 只接受CDLA-Permissive-2.0或CC0-1.0记录，保留每条数据的来源、版本和原始provenance。
- 数据来源：https://docs.overturemaps.org/guides/places/ 。发布时须附上同目录的CDLA许可文本。
- 更新数据包需Python和DuckDB（pip install duckdb），执行 `python web/scripts/build-overture-place-pack.py`；修改脚本regions可扩展其他地区。更新后重启后端。
- 数据包是地点记录，不保证餐馆、酒店目前仍在营业，更不代表评价良好。

Wikidata在线补查的结构化坐标采用CC0：https://www.wikidata.org/wiki/Wikidata:Licensing 。

`yunnan-wikidata.json` 缓存本次实测核验的大理站、丽江站、独克宗古城，保留实体链接。独克宗原坐标较粗，按片区参考点显示。`scripts/build-wikidata-place-pack.mjs` 可补充缺失记录，遇到限流保留已有数据。

北大2018全国POI需用户登录下载，本项目尚未包含这套历史数据。

可导入其他已获许可的来源，JSON顶层为records数组，记录字段为name、aliases、city、longitude、latitude、coordinateSystem（WGS84）、source、sourceUrl、license。坐标必须来自实际资料；历史GCJ-02坐标不能直接冒充WGS84。
