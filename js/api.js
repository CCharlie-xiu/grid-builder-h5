/**
 * api.js — 脚本化控制 API（window.GridBuilder）
 *
 * 面向 AI / 自动化脚本的稳定契约：用一份 JSON「场景 Spec」描述物品摆放、镜头参数与
 * 游览路线，一次调用即可重建整个场景并播放。人类 UI 不依赖本文件。
 *
 * 典型用法：
 *   GridBuilder.manifest()              → 能力清单（物品目录 / 镜头预设 / Spec 规范），交给 AI
 *   GridBuilder.build(spec)             → 清空后按 spec 重建并自动播放
 *   GridBuilder.describe()              → 导出当前场景为 spec（可回灌 build）
 *   GridBuilder.advance(0.5)            → 确定性推进 0.5 秒游览（逐帧抓图用）
 *
 * 必须在 tour / camera / storage / interaction 之后加载。
 */

const API_VERSION = '1.0.0';

// 脚本控制状态
const apiState = {
    paused: false,          // 暂停 rAF 自动推进（抓帧时用）
    advanceAcc: 0,          // advance() 的小数累加器，保证总时长精确
    lastReport: null
};

function isTourPaused() {
    return apiState.paused;
}

// ============ 坐标换算 ============

function apiWorldOf(gx, gz) {
    const half = (gridSize * tileSize) / 2;
    return {
        x: gx * tileSize - half + tileSize / 2,
        z: gz * tileSize - half + tileSize / 2
    };
}

function apiGridOf(x, z) {
    const half = (gridSize * tileSize) / 2;
    return {
        gx: Math.floor((x + half) / tileSize),
        gz: Math.floor((z + half) / tileSize)
    };
}

function apiInGrid(gx, gz) {
    return Number.isInteger(gx) && Number.isInteger(gz) &&
        gx >= 0 && gx < gridSize && gz >= 0 && gz < gridSize;
}

function apiTool(id) {
    const t = (typeof CATALOG !== 'undefined' ? CATALOG : []).find(x => x.id === id);
    if (!t) throw new Error(`未知物品 id：${id}`);
    if (t.type === 'eraser' || t.type === 'select') throw new Error(`${id} 不是可放置物品`);
    return t;
}

// 解析 spec 里的位置写法：grid:[gx,gz] 优先，其次 pos:[x,z]（世界坐标）
function apiResolveCell(entry) {
    if (Array.isArray(entry.grid) && entry.grid.length >= 2) {
        const gx = Math.round(entry.grid[0]);
        const gz = Math.round(entry.grid[1]);
        if (!apiInGrid(gx, gz)) throw new Error(`格子越界：${gx},${gz}（合法范围 0~${gridSize - 1}）`);
        return { gx, gz };
    }
    if (Array.isArray(entry.pos) && entry.pos.length >= 2) {
        const g = apiGridOf(entry.pos[0], entry.pos[1]);
        if (!apiInGrid(g.gx, g.gz)) throw new Error(`坐标越界：${entry.pos}（世界坐标范围 ±${(gridSize * tileSize) / 2}）`);
        return g;
    }
    throw new Error('缺少位置：需要 grid:[gx,gz] 或 pos:[x,z]');
}

// ============ 物品放置 ============

/**
 * 在指定格子放置物品（默认堆叠到该格顶部）
 * @param {string} id   物品 id
 * @param {number} gx   格坐标 x（0~gridSize-1）
 * @param {number} gz   格坐标 z
 * @param {object} opt  { rot: 角度(度), stack: 是否允许叠放，默认 true }
 * @returns {{key,grid,y,height}}
 */
function apiPlace(id, gx, gz, opt) {
    opt = opt || {};
    const tool = apiTool(id);
    if (!apiInGrid(gx, gz)) throw new Error(`格子越界：${gx},${gz}（合法范围 0~${gridSize - 1}）`);

    const key = `${gx},${gz}`;
    const col = placedItems.get(key) || [];
    if (col.length && opt.stack === false) throw new Error(`格子 ${key} 已被占用`);
    if (col.length >= MAX_STACK) throw new Error(`格子 ${key} 已达 ${MAX_STACK} 层上限`);

    const baseY = col.length ? col[col.length - 1].userData.topY : 0;
    const w = apiWorldOf(gx, gz);
    const mesh = createItemMesh(tool);
    mesh.position.set(w.x, baseY, w.z);
    if (typeof opt.rot === 'number' && isFinite(opt.rot)) {
        mesh.rotation.y = (opt.rot * Math.PI) / 180;
    }
    mesh.userData.colKey = key;
    mesh.userData.toolId = id;
    mesh.userData.topY = baseY + mesh.userData.itemHeight;

    scene.add(mesh);
    col.push(mesh);
    placedItems.set(key, col);

    return { key, grid: [gx, gz], y: baseY, height: mesh.userData.itemHeight };
}

// 展开 pattern 写法 → 单元格列表
function apiExpandPattern(entry) {
    const kind = entry.pattern;
    const step = Math.max(1, Math.round(entry.step || 1));
    const out = [];

    if (kind === 'row' || kind === 'grid') {
        const from = apiResolveCell({ grid: entry.from || entry.grid, pos: entry.pos });
        const to = apiResolveCell({ grid: entry.to });
        const dx = Math.sign(to.gx - from.gx);
        const dz = Math.sign(to.gz - from.gz);
        const nx = Math.floor(Math.abs(to.gx - from.gx) / step) + 1;
        const nz = Math.floor(Math.abs(to.gz - from.gz) / step) + 1;
        for (let i = 0; i < nx; i++) {
            for (let j = 0; j < nz; j++) {
                if (kind === 'row' && i > 0 && j > 0) continue;
                out.push({ gx: from.gx + dx * i * step, gz: from.gz + dz * j * step });
            }
        }
    } else if (kind === 'ring') {
        const c = apiResolveCell({ grid: entry.center, pos: entry.pos });
        const count = Math.max(3, Math.round(entry.count || 12));
        const radius = entry.radius || 5;
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            out.push({
                gx: Math.round(c.gx + Math.cos(a) * radius),
                gz: Math.round(c.gz + Math.sin(a) * radius)
            });
        }
    } else {
        throw new Error(`未知 pattern：${kind}（支持 row / grid / ring）`);
    }
    return out.filter(c => apiInGrid(c.gx, c.gz));
}

// ============ 场景构建 ============

function apiClearScene() {
    if (tourActive) stopTour();
    if (planningMode) togglePlanningMode();
    exitPointPreview();
    clearSelection();
    placedItems.forEach(col => col.forEach(m => scene.remove(m)));
    placedItems.clear();
    waypoints.forEach(wp => scene.remove(wp.marker));
    waypoints.length = 0;
    selectedWaypointIndex = 0;
    updateRouteLine();
    updateWaypointCount();
    refreshCameraUI();
}

/**
 * 按 spec 重建场景并（默认）自动播放
 * spec = {
 *   items: [ { id, grid:[gx,gz], rot? } | { pattern:'row'|'grid'|'ring', id, ... } ],
 *   camera: { mode, heightTiles, distanceTiles, lookAheadTiles },
 *   route:  [ { grid:[gx,gz] } | { pos:[x,z], y? }, ... ]（可带 camera 覆盖）,
 *   play:   { autoplay: true, loop: false, speed: 9 }
 * }
 */
function apiBuild(spec, opt) {
    opt = opt || {};
    if (!spec || typeof spec !== 'object') throw new Error('spec 无效：需要一个对象');

    const report = { items: 0, cells: 0, skipped: [], route: 0, warnings: [], playing: false };
    apiClearScene();

    // —— 1. 物品 ——
    const list = Array.isArray(spec.items) ? spec.items : [];
    list.forEach((entry, i) => {
        if (!entry || typeof entry !== 'object') {
            report.skipped.push({ index: i, reason: '条目不是对象' });
            return;
        }
        const id = entry.id;
        try {
            apiTool(id);
            const cells = entry.pattern
                ? apiExpandPattern(entry)
                : [apiResolveCell(entry)];
            if (!cells.length) {
                report.warnings.push(`第 ${i + 1} 条展开后没有落在格子内：${id}`);
                return;
            }
            cells.forEach(c => {
                try {
                    apiPlace(id, c.gx, c.gz, { rot: entry.rot, stack: entry.stack });
                    report.items++;
                } catch (e) {
                    report.skipped.push({ index: i, id, grid: [c.gx, c.gz], reason: e.message });
                }
            });
        } catch (e) {
            report.skipped.push({ index: i, id, reason: e.message });
        }
    });
    report.cells = placedItems.size;

    // —— 2. 镜头参数 ——
    if (spec.camera && typeof spec.camera === 'object') {
        const c = spec.camera;
        if (typeof c.mode === 'string' && CAMERA_MODES.some(m => m.id === c.mode)) {
            globalCameraConfig.mode = c.mode;
        } else if (c.mode) {
            report.warnings.push(`未知镜头模式：${c.mode}`);
        }
        ['heightTiles', 'distanceTiles', 'lookAheadTiles'].forEach(k => {
            globalCameraConfig[k] = (typeof c[k] === 'number' && isFinite(c[k])) ? c[k] : null;
        });
        refreshCameraUI();
    }

    // —— 3. 路线 ——
    const route = Array.isArray(spec.route) ? spec.route : [];
    route.forEach((p, i) => {
        if (!p || typeof p !== 'object') {
            report.skipped.push({ index: `route#${i}`, reason: '条目不是对象' });
            return;
        }
        try {
            let x, z, y = 0;
            if (Array.isArray(p.pos) && p.pos.length >= 2) {
                x = p.pos[0];
                z = p.pos[1];
                if (typeof p.pos[2] === 'number') y = p.pos[2];
            } else {
                const c = apiResolveCell(p);
                const w = apiWorldOf(c.gx, c.gz);
                x = w.x;
                z = w.z;
            }
            if (typeof p.y === 'number') y = p.y;
            const key = `${Math.round(x)},${Math.round(z)}`;
            const before = waypoints.length;
            addWaypoint(x, y, z, key, true);
            if (waypoints.length > before) {
                report.route++;
                if (p.camera) waypoints[waypoints.length - 1].camera = JSON.parse(JSON.stringify(p.camera));
            }
        } catch (e) {
            report.skipped.push({ index: `route#${i}`, reason: e.message });
        }
    });
    updateRouteLine();
    updateWaypointCount();
    refreshCameraUI();

    // —— 4. 播放 ——
    const play = spec.play || {};
    if (typeof play.loop === 'boolean') tourLoop = play.loop;
    if (typeof play.speed === 'number' && play.speed > 0) tourSpeed = play.speed;

    const shouldPlay = opt.autoplay !== undefined ? !!opt.autoplay : (play.autoplay !== false);
    if (shouldPlay && waypoints.length >= 2) {
        apiState.paused = false;
        apiState.advanceAcc = 0;
        startTour();
        report.playing = tourActive;
    } else if (shouldPlay) {
        report.warnings.push(`只有 ${waypoints.length} 个途经点，至少需要 2 个才能播放`);
    }

    renderNow();
    apiState.lastReport = report;
    return report;
}

// ============ 场景导出 ============

function apiDescribe() {
    const items = [];
    placedItems.forEach((col, key) => {
        col.forEach(m => {
            const g = apiGridOf(m.position.x, m.position.z);
            items.push({
                id: m.userData.toolId,
                grid: [g.gx, g.gz],
                y: Math.round(m.position.y * 1000) / 1000,
                rot: Math.round(((m.rotation.y * 180) / Math.PI) * 10) / 10
            });
        });
    });
    return {
        items,
        camera: {
            mode: globalCameraConfig.mode,
            heightTiles: globalCameraConfig.heightTiles,
            distanceTiles: globalCameraConfig.distanceTiles,
            lookAheadTiles: globalCameraConfig.lookAheadTiles
        },
        route: waypoints.map(w => {
            const g = apiGridOf(w.x, w.z);
            const o = { grid: [g.gx, g.gz] };
            if (w.camera) o.camera = JSON.parse(JSON.stringify(w.camera));
            return o;
        }),
        play: { autoplay: true, loop: tourLoop, speed: tourSpeed }
    };
}

function apiItems() {
    const out = [];
    placedItems.forEach((col, key) => {
        col.forEach((m, level) => {
            const g = apiGridOf(m.position.x, m.position.z);
            out.push({
                id: m.userData.toolId,
                grid: [g.gx, g.gz],
                key,
                level,
                y: Math.round(m.position.y * 1000) / 1000,
                rot: Math.round(((m.rotation.y * 180) / Math.PI) * 10) / 10,
                height: m.userData.itemHeight
            });
        });
    });
    return out;
}

// ============ 能力清单（交给 AI） ============

let apiManifestCache = null;

function apiManifest() {
    if (apiManifestCache) return apiManifestCache;

    // 一次性建模取高度（几何与材质是共享缓存，不会泄漏）
    const heights = {};
    CATALOG.forEach(t => {
        try {
            const g = createItemMesh(t);
            if (g) heights[t.id] = g.userData.itemHeight;
        } catch (e) { /* 忽略 */ }
    });

    apiManifestCache = {
        app: 'grid-builder-h5',
        apiVersion: API_VERSION,
        entry: 'window.GridBuilder',
        grid: {
            size: gridSize,
            tileSize,
            worldSpan: gridSize * tileSize,
            maxStack: MAX_STACK,
            coordNote: `格坐标 [gx,gz]，取值 0~${gridSize - 1}；世界坐标范围 ±${(gridSize * tileSize) / 2}`
        },
        items: CATALOG.map(t => ({
            id: t.id,
            name: t.name,
            cat: t.cat,
            height: heights[t.id] !== undefined ? Math.round(heights[t.id] * 100) / 100 : null
        })),
        categories: CATEGORIES.map(c => ({ id: c.id, label: c.label })),
        cameraModes: CAMERA_MODES.map(m => ({ id: m.id, label: m.label })),
        patterns: [
            { pattern: 'row', fields: 'id, from:[gx,gz], to:[gx,gz], step?, rot?', desc: '沿直线铺一排' },
            { pattern: 'grid', fields: 'id, from:[gx,gz], to:[gx,gz], step?, rot?', desc: '矩形区域铺满' },
            { pattern: 'ring', fields: 'id, center:[gx,gz], radius?, count?, rot?', desc: '绕中心铺一圈' }
        ],
        spec: {
            items: '单个：{id, grid:[gx,gz], rot?}；或 pattern 写法',
            camera: '{mode, heightTiles, distanceTiles, lookAheadTiles}（单位：格）',
            route: '[{grid:[gx,gz]} 或 {pos:[x,z],y?}, ...]，可带 camera 覆盖；至少 2 个点才能播放',
            play: '{autoplay:true, loop:false, speed:9}'
        },
        methods: [
            'manifest() 能力清单', 'build(spec, opt) 重建并播放', 'describe() 导出当前场景',
            'items() 列出已放置物品', 'place(id,gx,gz,opt) 放一个', 'removeAt(gx,gz) 删该格顶层',
            'rotateAt(gx,gz,deg) 旋转', 'setCamera(cfg) 改镜头', 'setRoute(points) 设路线',
            'play() / stop()', 'advance(sec) 确定性推进', 'pause() / resume() 暂停自动推进',
            'setView(pos,target) 固定视角', 'renderNow() 立即渲染一帧', 'clear() 清空',
            'styles() 风格清单（8 片子类型 / 6 调性 / 3 时长）',
            'compose({film,tone,length,subject}) 风格选择 → {brief, spec}，不改场景',
            'auto({film,tone,length,subject}) 风格选择 → 直接生成并播放'
        ],
        tips: [
            '地面是 40×40 格；建筑/家具通常占 1 格，地标视觉上更宽，建议周围留空',
            '同格可叠放，最高 5 层；桌面上放台灯、书架旁放盆栽是自然组合',
            '镜头参数以「格」为单位：高度 2.5 约等于一层楼视角，8 以上是高空俯瞰',
            '标准漫游 follow 最像人眼，物体特写 closeup 会自动注视最近物体',
            '路线至少 2 个点才能播放；相邻点不要过近，否则路径退化',
            '用户说不清要什么时不要追问参数，用 styles() 列出风格选项让他选，再 auto() 直接出片'
        ]
    };
    return apiManifestCache;
}

// ============ 镜头 / 路线 / 播放 ============

function apiSetCamera(cfg) {
    if (!cfg || typeof cfg !== 'object') throw new Error('camera 配置无效');
    if (typeof cfg.mode === 'string') {
        if (!CAMERA_MODES.some(m => m.id === cfg.mode)) throw new Error(`未知镜头模式：${cfg.mode}`);
        globalCameraConfig.mode = cfg.mode;
        globalCameraConfig.heightTiles = null;
        globalCameraConfig.distanceTiles = null;
        globalCameraConfig.lookAheadTiles = null;
    }
    ['heightTiles', 'distanceTiles', 'lookAheadTiles'].forEach(k => {
        if (typeof cfg[k] === 'number' && isFinite(cfg[k])) globalCameraConfig[k] = cfg[k];
    });
    refreshCameraUI();
    renderNow();
    return { ...globalCameraConfig };
}

function apiSetRoute(points) {
    if (!Array.isArray(points)) throw new Error('route 需要是数组');
    clearRoute();
    const added = [];
    points.forEach((p, i) => {
        try {
            let x, z, y = 0;
            if (Array.isArray(p.pos) && p.pos.length >= 2) {
                x = p.pos[0];
                z = p.pos[1];
                if (typeof p.pos[2] === 'number') y = p.pos[2];
            } else {
                const c = apiResolveCell(p);
                const w = apiWorldOf(c.gx, c.gz);
                x = w.x;
                z = w.z;
            }
            if (typeof p.y === 'number') y = p.y;
            const before = waypoints.length;
            addWaypoint(x, y, z, `${Math.round(x)},${Math.round(z)}`, true);
            if (waypoints.length > before) {
                if (p.camera) waypoints[waypoints.length - 1].camera = JSON.parse(JSON.stringify(p.camera));
                added.push(i);
            }
        } catch (e) { /* 跳过无效点 */ }
    });
    updateRouteLine();
    updateWaypointCount();
    refreshCameraUI();
    return { added: added.length, total: waypoints.length };
}

function apiPlay() {
    apiState.paused = false;
    apiState.advanceAcc = 0;
    startTour();
    return { playing: tourActive };
}

function apiStop() {
    stopTour();
    return { playing: tourActive };
}

function apiPause() { apiState.paused = true; return { paused: true }; }
function apiResume() { apiState.paused = false; return { paused: false }; }

/**
 * 确定性推进游览（逐帧抓图 / 录制用）
 * 直接按固定步长驱动导览相机，结果与帧率无关、可复现；
 * 内部按小数累加，保证「每次推进 1/fps 秒」的总时长精确
 */
function apiAdvance(seconds) {
    if (!tourActive) return { ok: false, reason: '游览未开始' };
    apiState.advanceAcc = (apiState.advanceAcc || 0) + Math.max(0, seconds || 0);
    let steps = Math.floor(apiState.advanceAcc / FIXED_DT);
    if (steps < 1) { renderNow(); return { ok: true, finished: false, progress: tourState.progress }; }
    apiState.advanceAcc -= steps * FIXED_DT;

    let finished = false;
    for (let i = 0; i < steps; i++) {
        if (!tourActive) break;
        finished = stepTourCamera(FIXED_DT);
        if (finished && !tourLoop) break;
    }
    renderNow();
    return {
        ok: true,
        finished: finished && !tourLoop,
        progress: Math.round(tourState.progress * 10000) / 10000,
        playing: tourActive
    };
}

// ============ 成片模式（隐藏界面，只留画面） ============

/**
 * 成片模式：隐藏全部界面层与编辑辅助（路线连线、途经点标记、选中高亮）
 * 录制或抓帧前调用，得到干净的 3D 画面
 */
function apiClean(clean) {
    const on = clean !== false;
    document.body.classList.toggle('clean-mode', on);

    // 编辑辅助不是画面内容，成片里不出现
    if (typeof gridHelper !== 'undefined' && gridHelper) gridHelper.visible = !on;
    if (typeof routeLine !== 'undefined' && routeLine) routeLine.visible = !on;
    if (typeof waypoints !== 'undefined') {
        waypoints.forEach(w => { if (w.marker) w.marker.visible = !on; });
    }
    const keepSel = !on && !!selectedItem;
    if (selectionHelper) selectionHelper.visible = keepSel;
    if (selectionFootprint) selectionFootprint.visible = keepSel;
    if (selectionFill) selectionFill.visible = keepSel;

    renderNow();
    return { clean: on };
}

// H 键切换界面显隐（人工预览成片效果）
window.addEventListener('keydown', (e) => {
    if (e.key !== 'h' && e.key !== 'H') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const on = !document.body.classList.contains('clean-mode');
    apiClean(on);
});

// ============ 视角 / 渲染（抓帧用） ============

/**
 * 跳到第 i 个途经点的精确镜头姿态（分镜抓帧用）
 * 与播放中经过该点的姿态完全一致
 */
function apiPreview(i) {
    const idx = Math.max(0, Math.min(waypoints.length - 1, Math.round(i || 0)));
    const ok = previewWaypointCamera(idx);
    renderNow();
    return { ok, index: idx, total: waypoints.length };
}

function apiSetView(pos, target) {
    if (!Array.isArray(pos) || pos.length < 3) throw new Error('pos 需要 [x,y,z]');
    if (!Array.isArray(target) || target.length < 3) throw new Error('target 需要 [x,y,z]');
    if (tourActive) stopTour();
    useEditorCamera();
    camera.position.set(pos[0], pos[1], pos[2]);
    controls.target.set(target[0], target[1], target[2]);
    controls.update();
    renderNow();
    return { pos, target };
}

function renderNow() {
    if (!renderer || !scene) return;
    renderer.render(scene, getRenderCamera());
}

// ============ 增量编辑（手动模式 API 化） ============

function apiRemoveAt(gx, gz) {
    const key = `${gx},${gz}`;
    const col = placedItems.get(key);
    if (!col || !col.length) return { removed: false };
    const item = col.pop();
    if (selectedItem === item) clearSelection();
    scene.remove(item);
    relayoutColumn(key);
    renderNow();
    return { removed: true, id: item.userData.toolId, remaining: (placedItems.get(key) || []).length };
}

function apiRotateAt(gx, gz, deg) {
    const col = placedItems.get(`${gx},${gz}`);
    if (!col || !col.length) throw new Error(`格子 ${gx},${gz} 没有物品`);
    const item = col[col.length - 1];
    item.rotation.y += ((deg || 90) * Math.PI) / 180;
    if (selectedItem === item) updateSelectionHelper();
    renderNow();
    return { id: item.userData.toolId, rot: Math.round(((item.rotation.y * 180) / Math.PI) * 10) / 10 };
}

function apiStateSnapshot() {
    return {
        items: placedItems.size,
        pieces: apiItems().length,
        waypoints: waypoints.length,
        playing: tourActive,
        paused: apiState.paused,
        planning: planningMode,
        camera: { ...globalCameraConfig },
        progress: tourActive ? Math.round(tourState.progress * 1000) / 1000 : 0,
        lastReport: apiState.lastReport
    };
}

// ============ AI 模式面板 ============

// 精简版 Spec 规范（给 AI 的提示词里用；完整版见能力库 spec.md）
function apiSpecGuide() {
    return [
        '# 场景 Spec 规范',
        '',
        '## 坐标',
        '- 格坐标 grid:[gx,gz]，取值 0~' + (gridSize - 1) + '，[0,0] 是西北角，中心是 [' + Math.floor(gridSize / 2) + ',' + Math.floor(gridSize / 2) + ']',
        '- 备用世界坐标 pos:[x,z]，范围 ±' + (gridSize * tileSize) / 2,
        '- 同格可叠放，最高 ' + MAX_STACK + ' 层；rot 是朝向（度）',
        '',
        '## 字段',
        '- items: 单个 {id, grid, rot?}；批量 {pattern, id, ...}',
        '  pattern = row | grid | ring',
        '  row/grid: from:[gx,gz], to:[gx,gz], step?（格间距，默认 1）',
        '  ring:     center:[gx,gz], radius?（默认 5）, count?（默认 12）',
        '- camera: {mode, heightTiles, distanceTiles, lookAheadTiles}，单位是「格」不是世界单位',
        '  mode = follow 标准漫游(2.5/2.5/3.0) | overview 高空总览(7/5/6) | closeup 物体特写(1.6/2.2/1.2) | topdown 垂直俯瞰(9/0.6/1.5)',
        '- route: [{grid:[gx,gz]} 或 {pos:[x,z]}]，至少 2 个点，最多 20 个；每点可带 camera 覆盖全局',
        '- play: {autoplay:true, loop:false, speed:9}'
    ].join('\n');
}

// brief：可选。传入后作为「我的描述」段落，通常是 AI 模式向导拼出的人话分镜
function apiPromptText(brief) {
    const m = apiManifest();
    return [
        '你是 3D 场景编排助手。请根据我最后的描述，输出一份 JSON 场景 Spec。',
        '只输出 JSON 本身，不要解释、不要多余文字。',
        '',
        '# 执行环境',
        '页面：' + location.href,
        '入口：GridBuilder.build(spec) —— 清空场景后按 spec 重建并自动播放',
        '',
        '# 可用物品与镜头（这是完整清单，只能用这里的 id，不要自己发明）',
        '```json',
        JSON.stringify({
            grid: m.grid,
            items: m.items,
            cameraModes: m.cameraModes,
            patterns: m.patterns
        }, null, 2),
        '```',
        '',
        apiSpecGuide(),
        '',
        '# 我的描述',
        brief && String(brief).trim()
            ? String(brief).trim()
            : '（在这里写你的场景描述与运镜描述）'
    ].join('\n');
}

async function apiCopy(text) {
    try {
        if (navigator.clipboard) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) { /* 回退到 execCommand */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
}

// ============ 挂载 ============

window.GridBuilder = {
    version: API_VERSION,
    manifest: apiManifest,
    build: apiBuild,
    describe: apiDescribe,
    items: apiItems,
    state: apiStateSnapshot,
    clear: apiClearScene,

    place: apiPlace,
    removeAt: apiRemoveAt,
    rotateAt: apiRotateAt,

    setCamera: apiSetCamera,
    setRoute: apiSetRoute,
    play: apiPlay,
    stop: apiStop,
    pause: apiPause,
    resume: apiResume,
    advance: apiAdvance,

    setView: apiSetView,
    preview: apiPreview,
    clean: apiClean,
    hideUI: () => apiClean(true),
    showUI: () => apiClean(false),
    renderNow,
    grid: { worldOf: apiWorldOf, gridOf: apiGridOf, size: gridSize, tileSize },

    // AI 模式面板（实现在 ai-mode.js，延迟引用以避开加载顺序）
    openPanel: () => openAiPanel(),
    closePanel: () => closeAiPanel(),
    promptText: apiPromptText,
    specGuide: apiSpecGuide,

    // 风格向导：选「片子类型 + 调性 + 时长」直接出 Spec，不需要外部 AI
    styles: () => aiStyles(),
    compose: choice => aiCompose(choice || {}),
    auto: (choice, opt) => {
        const r = aiCompose(choice || {});
        return { brief: r.brief, report: apiBuild(r.spec, opt || { autoplay: true }), spec: r.spec };
    }
};
