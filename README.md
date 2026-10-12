# 卫戍协议：盟约 · 从夯到拉

《明日方舟》卫戍协议：盟约的玩家自制排行榜。Python / Flask 后端，原生 HTML、CSS、JavaScript 前端，无需 Node 构建即可运行。游戏图像与资料已随项目保存，本地使用不依赖外部图片服务。

## 启动

建议使用 Python 3.10 或更新版本。在本文件夹打开终端：

```powershell
python -m pip install -r requirements.txt
python app.py
```

访问 **http://127.0.0.1:5000/**。安装过依赖后，Windows 也可以双击 `start.bat` 启动。按 Ctrl+C 停止服务。

默认只监听本机。端口冲突时可设置 `PORT`，例如 `$env:PORT='5001'; python app.py`。需要部署时可通过兼容 WSGI 的服务器加载 `app:app`。

## 公开部署

项目保留完整 Python 后端，适合 GitHub 保存源码、Render 运行 Flask 服务。GitHub Pages 仅支持静态页面，无法直接运行这些 Python 接口。

仓库包含 `render.yaml`，使用免费 Python 服务、新加坡区域、Gunicorn 生产服务器和 `/healthz` 健康检查。将代码上传到自己的 GitHub 仓库后，在 Render 选择 **New → Blueprint** 并连接该仓库，确认服务方案为 **Free** 后部署。成功后以 Render 返回的真实 HTTPS 地址访问网站。

已有 Render 服务也可手动填写：构建命令 `pip install -r requirements-prod.txt`；启动命令 `gunicorn --config gunicorn.conf.py app:app`；健康检查路径 `/healthz`。Python 版本由 `.python-version` 指定为 3.12。

GitHub 自动检查会运行数据、分享码、前端状态检查，并在 Linux 上启动生产服务器确认健康接口。Render 配置为检查通过后自动部署，后续更新推送到 `main` 即可发布。

免费服务闲置 15 分钟后可能休眠，下一次访问启动约需一分钟；此限制来自 [Render 免费服务说明](https://render.com/docs/free)。用户榜单存于各自浏览器，服务器休眠不会删除这些榜单。启动与部署不重新下载游戏图片，所需资料和素材随仓库提供。来源缓存与本地临时文件不上传。

另提供 `Dockerfile`，可用于支持容器的 Python 托管服务。部署时不需要数据库或用户密钥。

## 使用

- 切换盟约干员、盟约、进阶盟约、开局策略、敌人、BOSS，以及上半／下半期数。
- 从待排名区拖动图像到“夯 → 顶级 → 人上人 → NPC → 拉完了”，或拖到四条分界区域，例如“介于夯和顶级之间”。同一位置内可调整顺序，也能拖回待排名区。点击条目可查看资料并直接选择九个排名位置，方便手机与键盘操作。
- 干员可组合筛选 I–VI 等阶、核心盟约与附加盟约；双核心盟约按真实归属匹配。其他类型按资料中的类型标签筛选。
- 筛选只影响待排名区，不会隐藏或移除已排名条目。
- 榜单名称可直接编辑。每种类型、每个期数在浏览器中有独立草稿，并自动保存。Ctrl / ⌘ + Z 撤销，Ctrl / ⌘ + Shift + Z 重做。按 `/` 搜索。
- 开局策略覆盖上半 30 组、下半 40 组，共 42 个策略实体。可按正式策略名称或发起人搜索；例如变形者集群的“变形同构”、Pith 的“优等生”、佩佩的“博学多通”。详情包含当期效果、初始生命值与解锁条件。
- 深色战术终端采用青绿光效、扫描线、雷达、官方罗德岛标志与游戏盟约图标；榜单与资料区在桌面端等高并排，分别滚动，筛选直接位于资料列表顶部。窄屏改为堆叠布局。
- 分享提供 `SP2.` 排名码与分享链接，包含名称、类型、期数及全部九个位置的顺序。旧 `SP1.` 码和五层本地草稿会迁移到五个主档位，原有排名不丢失。导入不会执行代码，可撤销导入操作。
- 导出 PNG 保留完整榜单、名称、期数；不受待排名区筛选影响。

**本地自动保存仅属于当前浏览器。** 清除浏览器数据会删除草稿，可用排名码备份。分享码可复制到另一台运行本项目的电脑；本机地址的分享链接仅在能访问该服务的设备上有效，公开分享需先部署 Python 服务。

## 资料范围

收录 2025 年盟约首期与 2026 年盟约下半期。干员以活动预设名单为准，等阶不是星级；自由甄选的任意六星干员和原型替补不混入固定名单。不同期数的特质、盟约与配置差异独立保留。

敌方名单同时对照 PRTS 与公开客户端配置，包含战术特训、普通波次、悬赏首领、领袖附属单位和可追溯的敌方召唤物。最终领袖、隐秘核心及其他首领在 BOSS 分类中；“炎佑”等友方盟约召唤物排除。客户端游戏 ID 到收录实体的覆盖记录保存在 `data/enemy-coverage.json`。

“进阶盟约”将盟约的真实激活人数、在场人数与层数门槛拆分供独立排名，游戏中的正式术语仍为“盟约”。完整研究与收录说明见 [data/research.md](data/research.md)。

来源：[卫戍协议总览](https://prts.wiki/w/卫戍协议)、[盟约](https://prts.wiki/w/卫戍协议：盟约)、[盟约下半](https://prts.wiki/w/卫戍协议：盟约_下半)、[公开客户端资料](https://github.com/Kengxxiao/ArknightsGameData)。素材版权归鹰角网络及其关联公司所有；PRTS 社区文本遵循其原有授权。此项目用于非商业玩家交流，不代表官方。

## 更新资料

```powershell
python scripts/sync_catalog.py --refresh
```

同步脚本使用 PRTS 的公共 MediaWiki API，保存来源快照与本地素材；`--refresh` 刷新来源，`--no-images` 仅重建资料。完整运行会检查固定干员数量和图片下载，下载失败时退出并记录 `data/asset-errors.json`。再次运行会跳过已缓存的图片。同步需要网络以及系统 curl；没有 curl 时会尝试 Python 的下载工具。当前资料随项目提供，启动不需要重新同步。

`data/catalog.json` 保存排名条目；`data/asset-manifest.json` 记录每张图片的来源；`data/source-cache/` 保留研究快照，便于审计和更新。条目 ID 按类型与身份保持稳定，各期数值与配置独立保存；普通文案调整不会让历史排名码失效。如果资料更新移除了榜单中的条目，导入会明确报错。

`static/branding/` 保存官网罗德岛标志和 PRTS 活动标志，来源在 `data/branding-manifest.json`。`python scripts/fetch_branding.py` 可更新这些标志。新版页面资源带版本参数；已有 Python 进程需重启后再刷新页面，才能加载新版分享接口。

## 检查

```powershell
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
node tests/test_frontend.cjs
node --check static/app.js
```

Python 检查覆盖排名码往返、中文与顺序保留、无效条目、重复条目、格式错误和解压大小上限。Node 检查在独立的状态模拟环境中验证移动、排序、撤销重做、筛选与草稿恢复，不需要浏览器。Node 只用于开发检查，运行网站只需 Python。

## 后端接口

| 接口 | 用途 |
|---|---|
| `GET /api/catalog` | 全部期数、条目、盟约索引和资料来源 |
| `POST /api/share` | 校验榜单，生成压缩排名码 |
| `POST /api/import` | 校验并解码排名码 |

排名码为 JSON → zlib → URL-safe Base64，新版前缀为 `SP2.`、结构版本为 2，保存五个主档位与四个中间档位。服务端兼容 `SP1.` 五层旧码，限制输入与解压体积，验证结构、当前类型／期数条目和重复 ID。服务端不保存用户榜单，草稿保存在浏览器 `localStorage`。条目编号和草稿存储键保持稳定。

## 验证范围

已进行后端与前端状态检查及本地素材校验。当前开发环境限制了自动浏览器访问，因此没有完成浏览器中的视觉、真实触控与 PNG 下载验收；可启动项目后使用实际浏览器检查这三项。
