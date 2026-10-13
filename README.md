# 3D 网格建造工作坊

浏览器端 3D 网格建造 + 路线导览工具。Three.js r128 + 原生 ES 脚本，无构建步骤。

## 运行

```bash
python3 -m http.server 8899
# 打开 http://127.0.0.1:8899/index.html
```

## 功能

| 模块 | 能力 |
| --- | --- |
| 建造 | 40×40 格子（80×80 世界单位）放置物品，单格最高堆叠 5 层，点击物品顶面向上叠放 |
| 编辑 | 选择工具下点击已放置物体即选中（琥珀色高亮框 + 格子脚印），可旋转 ±90°、移动到其他格子、移除 |
| 物品 | 46 类：建筑 10 / 地标 8 / 家具 9 / 城市配套 10 / 基础地形 4 / 景观道具 3 / 载具 2 |
| 分类 | 页签过滤：全部 / 基础地形 / 建筑 / 地标 / 家具 / 城市配套 / 景观道具 / 载具 |
| 天空 | 高德 3D 风格天际线：渐变天穹 + 地平线亮带 + 大气雾 + 远景地面 + 天际线剪影环 |
| AI 模式 | 「AI 模式」按钮 → 复制提示词给任意 AI 写场景 Spec → 粘回来一键生成并播放 |
| 脚本 API | `window.GridBuilder`：manifest / build / describe / advance 等，供 AI 与自动化脚本驱动 |
| 路线 | 规划模式点击地面添加途经点（上限 20），支持撤销、清空 |
| 导览 | 导览相机沿 Catmull-Rom 样条巡航，独立于编辑器相机 |
| 镜头 | 4 种预设 + 途经点级覆盖，参数以「格」为单位 |
| 调试 | 相机辅助模型、朝向线、进度球、实时读数面板 |
| 数据 | 场景与镜头配置序列化，兼容旧数据，本地保存/载入 |

### 物品清单

| 分类 | 物品 |
| --- | --- |
| 建筑 | 小房子、联排屋、公寓楼、别墅、便利店、商场、写字楼、厂房、现代方块、石柱 |
| 地标 | 电视塔、广州塔、体育馆、摩天轮、拱门、金字塔、钟楼、灯塔 |
| 家具 | 桌子、办公椅、台灯、落地灯、沙发、书架、床、盆栽、休闲座椅 |
| 城市配套 | 红绿灯、路灯、长椅、垃圾桶、公交站台、广告牌、围栏、喷泉、花坛、割草机 |
| 基础地形 | 直道、弯道、十字路口、草坪 |
| 景观道具 | 多边形树、发光晶体、人物 |
| 载具 | 小汽车、公交车 |

## 脚本化 API（AI 模式）

页面暴露 `window.GridBuilder`，用一份 JSON「场景 Spec」描述物品、镜头与路线，一次调用重建整个场景并播放。

```javascript
GridBuilder.manifest()            // 能力清单：物品目录 / 镜头预设 / Spec 规范
GridBuilder.build(spec)           // 清空 → 重建 → 自动播放，返回含 skipped 的报告
GridBuilder.describe()            // 导出当前场景为 spec（可回灌 build）
GridBuilder.advance(0.5)          // 确定性推进游览 0.5 秒（逐帧抓图用）
GridBuilder.pause() / resume()    // 暂停 / 恢复 rAF 自动推进
```

```json
{
  "items": [
    { "id": "tower_canton", "grid": [20, 20] },
    { "pattern": "ring", "id": "street_lamp", "center": [20, 20], "radius": 8, "count": 12 },
    { "pattern": "row", "id": "office", "from": [8, 10], "to": [8, 30], "step": 4 }
  ],
  "camera": { "mode": "overview", "heightTiles": 8, "distanceTiles": 6, "lookAheadTiles": 7 },
  "route": [{ "grid": [4, 4] }, { "grid": [35, 35], "camera": { "mode": "closeup" } }],
  "play": { "autoplay": true, "loop": false, "speed": 9 }
}
```

- 坐标：`grid:[gx,gz]` 取值 `0~39`，中心是 `[20,20]`；备用 `pos:[x,z]` 为世界坐标（±40）
- `pattern`：`row` / `grid` / `ring` 三种批量摆放
- 镜头参数单位是「**格**」不是世界单位
- `build()` 返回 `report.skipped`，逐条说明哪些条目没落地及原因，不静默失败

### 页面内使用

点物品栏的 **AI 模式** 按钮：

1. **复制 AI 提示词** —— 含 41 物品清单 + Spec 规范 + 收尾占位，粘给任意 AI
2. AI 返回一份 JSON Spec
3. 粘进输入框 → **生成并播放**

也可以 **导出当前场景** 把手工搭的场景转成 JSON，交给 AI 继续改。

### 离线批处理

能力库 `至关重要` 中的 `grid-builder-scene` 提供驱动脚本，可离线跑 Spec 并逐帧抓图：

```bash
node drive.mjs --spec scene.json --frames 8 --duration 24 --out ./shots
```

## 天空系统

四层结构，由远及近：

| 层 | 实现 | 作用 |
| --- | --- | --- |
| 渐变天穹 | 半径 700 球体 + ShaderMaterial（BackSide） | 天顶 → 中层 → 地平线两段渐变，地平线叠加高斯亮带 |
| 大气雾 | `THREE.Fog`，170 → 520 | 远景统一淡出成雾色，形成大气透视 |
| 远景地面 | 半径 520 圆盘，y = -0.8 | 边缘正好落在雾远端，无缝融进地平线 |
| 天际线剪影 | 96 个低多边形方块环，半径 300~420 | 越远越淡，构成城市天际线 |

配色在 `js/sky.js` 的 `SKY_PRESETS` 中，`SKY_PRESET` 可选 `'day'`（高德日间）或 `'dusk'`（蓝调时刻）。


## 操作

| 操作 | 说明 |
| --- | --- |
| 左键拖拽 / 右键拖拽 / 滚轮 | 旋转视角 / 平移镜头 / 缩放 |
| 点击格子 | 放置物品 |
| 点击物品顶面 | 向上堆叠 |
| Shift + 点击 | 擦除顶层物品 |
| ← / → | 切换物品 |
| 选择工具 → 点击物体 | 选中，底部出现操作条 |
| 操作条「旋转」 | 逆时针 / 顺时针 90° |
| 操作条「移动」 | 进入移动状态（准星光标），点击目标格子完成；再点一次或 Esc 取消 |
| 操作条「移除」 | 删除选中物体，同格上方物品自动落下 |
| Esc | 取消选中（移动状态下先退出移动） |
| 规划路线 → 点击地面 | 添加途经点 |
| 开始游览 | 导览相机沿路线跟随 |

## 镜头系统

预设参数（单位：格，随场景跨度自适应 0.75~2.0 倍）：

| 模式 | 高度 | 后跟距离 | 前方注视 |
| --- | --- | --- | --- |
| 标准漫游 | 2.5 | 2.5 | 3.0 |
| 高空总览 | 7.0 | 5.0 | 6.0 |
| 物体特写 | 1.6 | 2.2 | 1.2（注视最近物体） |
| 垂直俯瞰 | 9.0 | 0.6 | 1.5 |

途经点镜头覆盖字段全部可选，解析优先级：**覆盖字段 → 全局用户值 → 模式基准**。未配置的点不写入任何字段，自动继承全局默认。

运动实现：固定步长 `1/60s` 积分 + 指数阻尼（与帧率解耦，重复播放结果一致）；切向用相邻点中心差分，转弯平滑；相机 up 固定 +Y，离地净空 1.2 单位。

## 文件结构

```
index.html            页面结构与面板
css/base.css          基础样式
css/components.css    组件样式（面板/物品栏/页签/镜头面板）
js/config.js          物品目录、分类、堆叠上限
js/sky.js             天空系统（天穹/雾/远景地面/天际线）
js/scene.js           场景、渲染器、灯光、地面、动画循环
js/items.js           物品工厂与预览模型（基础物品）
js/items-extra.js     扩展物品工厂（建筑/地标/家具/城市配套，注册到 ITEM_BUILDERS）
js/interaction.js     物品栏、射线拾取、放置/擦除、堆叠、选中编辑
js/tour.js            路线数据与游览调度
js/camera.js          导览相机系统（预设/覆盖/平滑运动/调试）
js/storage.js         序列化与旧数据兼容
js/ui.js              提示 Toast 与面板折叠
js/api.js             脚本化 API（window.GridBuilder）+ AI 模式面板
js/main.js            启动入口
3d-grid-view.html     早期 CSS 3D 原型页
```

脚本按上述顺序以经典 `<script>` 加载，共享全局作用域。

### 新增物品

在 `js/config.js` 的 `CATALOG` 里加一条（含 `id / name / icon / color / cat`），再到 `js/items-extra.js` 的 `ITEM_BUILDERS` 里按同一个 `id` 注册建模函数。约定：

- 物品底面位于局部 `y = 0`，必须写 `group.userData.itemHeight`
- 材质与几何体走 `_m()` / `_boxGeo()` 等缓存函数，同类物品共享实例
- 楼体窗户用 `_facade()` 生成 CanvasTexture 平铺，不要用独立 mesh

## 数据格式

```json
{
  "version": 2,
  "scene": { "gridSize": 40, "tileSize": 2 },
  "items": [{ "key": "5,5", "toolId": "cube", "x": -9, "y": 0, "z": -9, "rot": 1.5708 }],
  "waypoints": [
    { "x": -8, "y": 0, "z": -8, "key": "4,4" },
    { "x": 0, "y": 0, "z": -8, "key": "10,4",
      "camera": { "mode": "pose",
        "pose": { "pos": { "x": 6, "y": 14, "z": 6 },
                  "target": { "x": -6, "y": 0, "z": -6 } } } }
  ],
  "cameraConfig": { "mode": "follow", "heightTiles": null, "distanceTiles": null, "lookAheadTiles": null }
}
```

所有镜头字段均可选；`items[].rot`（朝向，弧度）为可选字段，旧数据缺失时按 0 处理。旧数据（无 `cameraConfig`、无 `waypoints[].camera`）载入后按默认镜头正常导览。
