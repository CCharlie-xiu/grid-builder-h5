/**
 * storage.js — 场景序列化 / 载入（含镜头配置兼容层）
 *
 * 数据结构（v2）：
 * {
 *   version: 2,
 *   scene: { gridSize, tileSize },
 *   items: [{ key, toolId, x, y, z, rot }],   // rot 为朝向（弧度），可选
 *   waypoints: [{ x, y, z, key, camera? }],   // camera 可选，缺失即继承全局默认
 *   cameraConfig: { mode, heightTiles, distanceTiles, lookAheadTiles }
 * }
 *
 * 兼容策略：所有新字段均为可选。旧数据（v1：无 cameraConfig、无 waypoint.camera）
 * 载入时逐字段归一化，缺失值回落到全局默认，不影响导览。
 */

const SCENE_STORAGE_KEY = 'grid-builder-scene-v2';

// —— 序列化 ——
function serializeScene() {
    const items = [];
    placedItems.forEach((col, key) => {
        col.forEach(item => {
            items.push({
                key,
                toolId: item.userData.toolId || null,
                x: round4(item.position.x),
                y: round4(item.position.y),
                z: round4(item.position.z),
                rot: round4(item.rotation.y || 0)
            });
        });
    });

    return {
        version: 2,
        savedAt: new Date().toISOString(),
        scene: { gridSize, tileSize },
        items,
        waypoints: waypoints.map(w => {
            const o = { x: w.x, y: w.y, z: w.z, key: w.key };
            if (w.camera) o.camera = JSON.parse(JSON.stringify(w.camera));  // 仅写入显式覆盖
            return o;
        }),
        cameraConfig: {
            mode: globalCameraConfig.mode,
            heightTiles: globalCameraConfig.heightTiles,
            distanceTiles: globalCameraConfig.distanceTiles,
            lookAheadTiles: globalCameraConfig.lookAheadTiles
        }
    };
}

function round4(v) { return Math.round(v * 10000) / 10000; }

// —— 归一化：途经点镜头覆盖 ——
function normalizeWaypointCamera(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    if (typeof raw.mode === 'string' && CAMERA_MODES.some(m => m.id === raw.mode)) {
        out.mode = raw.mode;
    }
    ['heightTiles', 'distanceTiles', 'lookAheadTiles'].forEach(k => {
        if (typeof raw[k] === 'number' && isFinite(raw[k])) out[k] = raw[k];
    });
    if (raw.lookAt && ['x', 'y', 'z'].every(k => typeof raw.lookAt[k] === 'number')) {
        out.lookAt = { x: raw.lookAt.x, y: raw.lookAt.y, z: raw.lookAt.z };
    }
    if (raw.pose && raw.pose.pos && raw.pose.target &&
        ['x', 'y', 'z'].every(k => typeof raw.pose.pos[k] === 'number' && typeof raw.pose.target[k] === 'number')) {
        out.pose = {
            pos: { x: raw.pose.pos.x, y: raw.pose.pos.y, z: raw.pose.pos.z },
            target: { x: raw.pose.target.x, y: raw.pose.target.y, z: raw.pose.target.z }
        };
        if (!out.mode) out.mode = 'pose';
    }
    return Object.keys(out).length ? out : null;
}

// —— 归一化：全局镜头配置 ——
function normalizeCameraConfig(raw) {
    const cfg = { mode: 'follow', heightTiles: null, distanceTiles: null, lookAheadTiles: null };
    if (!raw || typeof raw !== 'object') return cfg;
    if (typeof raw.mode === 'string' && CAMERA_MODES.some(m => m.id === raw.mode)) cfg.mode = raw.mode;
    ['heightTiles', 'distanceTiles', 'lookAheadTiles'].forEach(k => {
        if (typeof raw[k] === 'number' && isFinite(raw[k])) cfg[k] = raw[k];
    });
    return cfg;
}

// —— 内部：清空当前场景数据（不弹确认、不清镜头配置） ——
function clearItemsSilently() {
    if (typeof clearSelection === 'function') clearSelection();
    placedItems.forEach(col => col.forEach(mesh => scene.remove(mesh)));
    placedItems.clear();
}

function clearWaypointsSilently() {
    waypoints.forEach(wp => scene.remove(wp.marker));
    waypoints.length = 0;
    updateRouteLine();
    updateWaypointCount();
}

function findToolById(id) {
    return CATALOG.find(t => t.id === id) || TOOLS.find(t => t.id === id) || null;
}

/**
 * 载入场景数据（兼容旧数据）
 * 返回 { items, waypoints, skipped, legacy }
 */
function applySceneData(data) {
    if (!data || typeof data !== 'object') {
        showToast('场景数据无效');
        return null;
    }
    if (tourActive) stopTour();
    exitPointPreview();

    clearItemsSilently();
    clearWaypointsSilently();

    // —— 物品 ——
    let skipped = 0;
    const list = Array.isArray(data.items) ? data.items : [];
    list.forEach(entry => {
        if (!entry) { skipped++; return; }
        const tool = findToolById(entry.toolId);
        if (!tool || tool.type === 'eraser' || tool.type === 'select') { skipped++; return; }
        const mesh = createItemMesh(tool);
        if (!mesh) { skipped++; return; }
        const baseY = typeof entry.y === 'number' ? entry.y : 0;
        mesh.position.set(
            typeof entry.x === 'number' ? entry.x : 0,
            baseY,
            typeof entry.z === 'number' ? entry.z : 0
        );
        // 朝向（旧数据无 rot 字段 → 保持默认 0）
        if (typeof entry.rot === 'number' && isFinite(entry.rot)) {
            mesh.rotation.y = entry.rot;
        }
        const key = entry.key || `${Math.round(mesh.position.x)},${Math.round(mesh.position.z)}`;
        mesh.userData.colKey = key;
        mesh.userData.toolId = tool.id;
        mesh.userData.topY = baseY + (mesh.userData.itemHeight || 1);
        scene.add(mesh);
        const col = placedItems.get(key) || [];
        col.push(mesh);
        placedItems.set(key, col);
    });

    // —— 途经点（含可选镜头覆盖） ——
    const wps = Array.isArray(data.waypoints) ? data.waypoints : [];
    wps.forEach(wp => {
        if (!wp || typeof wp.x !== 'number' || typeof wp.z !== 'number') return;
        addWaypoint(wp.x, typeof wp.y === 'number' ? wp.y : 0, wp.z, wp.key, true);
        const added = waypoints[waypoints.length - 1];
        if (!added) return;
        const cam = normalizeWaypointCamera(wp.camera);
        if (cam) added.camera = cam;
    });

    // —— 全局镜头配置 ——
    const cfg = normalizeCameraConfig(data.cameraConfig);
    globalCameraConfig.mode = cfg.mode;
    globalCameraConfig.heightTiles = cfg.heightTiles;
    globalCameraConfig.distanceTiles = cfg.distanceTiles;
    globalCameraConfig.lookAheadTiles = cfg.lookAheadTiles;

    selectedWaypointIndex = 0;
    updateRouteLine();
    updateWaypointCount();
    refreshCameraUI();

    const legacy = !data.cameraConfig && !wps.some(w => w && w.camera);
    const result = { items: placedItems.size, waypoints: waypoints.length, skipped, legacy };
    showToast(`场景已载入：${result.items} 格物品 / ${result.waypoints} 个途经点`
        + (legacy ? '（旧数据，镜头使用默认配置）' : ''));
    return result;
}

// —— localStorage 存取 ——
function saveSceneToStorage() {
    try {
        localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify(serializeScene()));
        showToast('场景已保存到本地');
    } catch (e) {
        showToast('保存失败：' + e.message);
    }
}

function loadSceneFromStorage() {
    let raw = null;
    try {
        raw = localStorage.getItem(SCENE_STORAGE_KEY);
    } catch (e) {
        showToast('读取失败：' + e.message);
        return null;
    }
    if (!raw) {
        showToast('本地还没有保存过场景');
        return null;
    }
    try {
        return applySceneData(JSON.parse(raw));
    } catch (e) {
        showToast('场景解析失败：' + e.message);
        return null;
    }
}

// 暴露给调试/测试使用（旧数据兼容性验证等）
window.GridBuilderIO = {
    serializeScene,
    applySceneData,
    saveSceneToStorage,
    loadSceneFromStorage,
    normalizeWaypointCamera,
    normalizeCameraConfig
};
