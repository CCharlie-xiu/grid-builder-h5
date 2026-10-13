/**
 * camera.js — 导览相机系统（独立于编辑器相机）
 *
 * 设计要点：
 * 1. 编辑器相机（camera + OrbitControls）与导览相机（tourCamera）完全分离，
 *    导览期间渲染导览相机，编辑器相机姿态不被修改；仅当用户显式执行
 *    “使用当前视角保存到此点”时，才把编辑器相机姿态写入途经点覆盖。
 * 2. 镜头参数全部以「格」（tileSize）为单位，并随场景跨度自适应缩放。
 * 3. 途经点可选覆盖（wp.camera），未配置字段逐项继承全局默认设置。
 * 4. 运动采用固定步长积分 + 指数阻尼，保证同配置重复播放结果一致，
 *    并在转弯处使用相邻点中心差分求切向，避免朝向突变。
 */

// ============ 尺度与配置 ============

const FIXED_DT = 1 / 60;          // 固定模拟步长（秒）——保证可复现
const MAX_FRAME_STEPS = 8;        // 单帧最多补算步数，防止卡顿后追帧爆炸
const CAMERA_SMOOTHING = 5.0;     // 阻尼系数（越大跟随越紧）
const GROUND_CLEARANCE = 1.2;     // 相机最低离地高度（世界单位），防穿地
const BASE_SCENE_TILES = 20;      // 参数基准场景跨度（格）

// 镜头模式定义
const CAMERA_MODES = [
    { id: 'follow', label: '标准漫游' },
    { id: 'overview', label: '高空总览' },
    { id: 'closeup', label: '物体特写' },
    { id: 'topdown', label: '垂直俯瞰' },
    { id: 'pose', label: '自定义视角' }
];

// 各模式基准参数（单位：格）
const MODE_BASE = {
    follow: { heightTiles: 2.5, distanceTiles: 2.5, lookAheadTiles: 3.0, targetMode: 'ahead' },
    overview: { heightTiles: 7.0, distanceTiles: 5.0, lookAheadTiles: 6.0, targetMode: 'ahead' },
    closeup: { heightTiles: 1.6, distanceTiles: 2.2, lookAheadTiles: 1.2, targetMode: 'object' },
    topdown: { heightTiles: 9.0, distanceTiles: 0.6, lookAheadTiles: 1.5, targetMode: 'point' },
    pose: { heightTiles: 2.5, distanceTiles: 2.5, lookAheadTiles: 3.0, targetMode: 'ahead' }
};

// 全局默认镜头配置（null 表示使用模式基准值）
const globalCameraConfig = {
    mode: 'follow',
    heightTiles: null,
    distanceTiles: null,
    lookAheadTiles: null
};

// ============ 导览相机实例与状态 ============

let tourCamera = null;                 // 独立导览相机
let renderCameraMode = 'editor';       // 'editor' | 'tour'
let previewingPoint = false;           // 是否处于单点镜头预览
let cameraDebugOn = false;             // 调试可视化开关

let tourPath = null;                   // { curve, us, points }
const tourState = {
    progress: 0,
    pos: new THREE.Vector3(),
    target: new THREE.Vector3(),
    prevTangent: new THREE.Vector3(0, 0, 1),
    started: false
};

// 调试对象
let debugHelper = null, debugLine = null, debugMarker = null;

function clampNum(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// 场景跨度自适应系数：场景越大，默认高度/距离按比例放大（限制 0.75~2.0 倍）
function sceneScaleFactor() {
    return clampNum(gridSize / BASE_SCENE_TILES, 0.75, 2.0);
}

// 模式基准参数（含尺度自适应）
function modeDefaults(mode) {
    const base = MODE_BASE[mode] || MODE_BASE.follow;
    const f = sceneScaleFactor();
    return {
        mode,
        heightTiles: base.heightTiles * f,
        distanceTiles: base.distanceTiles * f,
        lookAheadTiles: base.lookAheadTiles * f,
        targetMode: base.targetMode
    };
}

function firstNum() {
    for (let i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === 'number' && isFinite(arguments[i])) return arguments[i];
    }
    return 0;
}

/**
 * 解析单个途经点的有效镜头配置
 * 优先级：途经点覆盖字段 → 全局用户设置 → 模式基准值（自适应后）
 */
function resolveWaypointCamera(wp) {
    const o = (wp && wp.camera) || null;
    const mode = (o && o.mode) || globalCameraConfig.mode;
    const base = modeDefaults(mode);
    return {
        mode,
        heightTiles: firstNum(o && o.heightTiles, globalCameraConfig.heightTiles, base.heightTiles),
        distanceTiles: firstNum(o && o.distanceTiles, globalCameraConfig.distanceTiles, base.distanceTiles),
        lookAheadTiles: firstNum(o && o.lookAheadTiles, globalCameraConfig.lookAheadTiles, base.lookAheadTiles),
        targetMode: base.targetMode,
        lookAt: (o && o.lookAt) || null,
        pose: (o && o.pose) || null,
        isCustom: !!(o && Object.keys(o).length > 0)
    };
}

// 全局默认配置的解析结果（供 UI 显示）
function resolveGlobalCamera() {
    const base = modeDefaults(globalCameraConfig.mode);
    return {
        mode: globalCameraConfig.mode,
        heightTiles: firstNum(globalCameraConfig.heightTiles, base.heightTiles),
        distanceTiles: firstNum(globalCameraConfig.distanceTiles, base.distanceTiles),
        lookAheadTiles: firstNum(globalCameraConfig.lookAheadTiles, base.lookAheadTiles),
        targetMode: base.targetMode
    };
}

// ============ 初始化 / 渲染相机切换 ============

function initTourCamera() {
    tourCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    tourCamera.position.copy(camera.position);
    tourCamera.up.set(0, 1, 0);
}

// 当前应使用的渲染相机
function getRenderCamera() {
    return (renderCameraMode === 'tour' && tourCamera) ? tourCamera : camera;
}

function useEditorCamera() {
    renderCameraMode = 'editor';
    previewingPoint = false;
}

// ============ 路径构建 ============

/**
 * 用途经点构建相机路径（不修改地面路线点本身）
 * 连续重复点会被去重；不足 2 个有效点返回 null
 */
function buildTourPath() {
    const raw = waypoints.map(w => new THREE.Vector3(w.x, w.y, w.z));
    const pts = [];
    raw.forEach(p => {
        if (!pts.length || pts[pts.length - 1].distanceTo(p) > 1e-4) pts.push(p);
    });
    if (pts.length < 2) return null;

    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);

    // 各途经点对应的弧长参数（弦长近似，用于配置混合）
    const cum = [0];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
        acc += pts[i].distanceTo(pts[i - 1]);
        cum.push(acc);
    }
    const total = acc || 1;
    const us = cum.map(c => c / total);

    return { curve, us, points: pts };
}

// 途经点水平切向（中心差分，转弯更平滑；端点用单侧差分）
function horizontalTangentAtWaypoint(i) {
    const pts = tourPath ? tourPath.points : waypoints.map(w => new THREE.Vector3(w.x, w.y, w.z));
    const n = pts.length;
    let dir;
    if (n < 2) {
        dir = tourState.prevTangent.clone();
    } else if (i <= 0) {
        dir = pts[1].clone().sub(pts[0]);
    } else if (i >= n - 1) {
        dir = pts[n - 1].clone().sub(pts[n - 2]);
    } else {
        dir = pts[i + 1].clone().sub(pts[i - 1]); // 中心差分：跨过拐点也平滑
    }
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir = tourState.prevTangent.clone();
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    return dir.normalize();
}

// 距离某点最近的已放置物体（物体特写用，确定性：按 Map 插入顺序取最近）
function nearestObjectTo(point, maxDist) {
    let best = null, bestD = maxDist;
    placedItems.forEach(col => col.forEach(item => {
        const d = item.position.distanceTo(point);
        if (d < bestD) { bestD = d; best = item; }
    }));
    if (!best) return null;
    return new THREE.Vector3(best.position.x, best.position.y + (best.userData.itemHeight || 1) * 0.5, best.position.z);
}

/**
 * 单个途经点的期望相机状态（未平滑）
 * 这是“镜头配置如何变成相机姿态”的唯一入口，预览与播放共用，保证一致
 */
function desiredStateForWaypoint(i) {
    const wp = waypoints[i];
    const cfg = resolveWaypointCamera(wp);
    const unit = tileSize;                      // 1 格 = tileSize 世界单位
    const point = new THREE.Vector3(wp.x, wp.y, wp.z);
    const horiz = horizontalTangentAtWaypoint(i);

    let pos, target;

    if (cfg.pose) {
        // 自定义视角：完全使用保存的姿态
        pos = new THREE.Vector3(cfg.pose.pos.x, cfg.pose.pos.y, cfg.pose.pos.z);
        target = new THREE.Vector3(cfg.pose.target.x, cfg.pose.target.y, cfg.pose.target.z);
        return { pos, target, cfg };
    }

    // 位置：路线点后方 distanceTiles 格 + 上方 heightTiles 格
    pos = point.clone()
        .addScaledVector(horiz, -cfg.distanceTiles * unit)
        .add(new THREE.Vector3(0, cfg.heightTiles * unit, 0));

    // 注视目标：按模式决定
    if (cfg.lookAt) {
        target = new THREE.Vector3(cfg.lookAt.x, cfg.lookAt.y, cfg.lookAt.z);
    } else if (cfg.targetMode === 'object') {
        target = nearestObjectTo(point, 3 * unit) || point.clone();
        target.y += 0.2;
    } else if (cfg.targetMode === 'point') {
        target = point.clone();
    } else {
        // ahead：注视行进前方，避免只看当前点导致转弯突变
        target = point.clone().addScaledVector(horiz, cfg.lookAheadTiles * unit);
    }

    // 防穿地
    pos.y = Math.max(pos.y, point.y + GROUND_CLEARANCE);
    return { pos, target, cfg };
}

// 路径参数 u → 相邻途经点混合权重
function waypointBlendAt(u) {
    const us = tourPath.us;
    const n = us.length;
    if (n < 2) return { a: 0, b: 0, f: 0 };
    let a = 0;
    while (a < n - 2 && u > us[a + 1]) a++;
    const b = Math.min(a + 1, n - 1);
    const span = Math.max(us[b] - us[a], 1e-6);
    const f = clampNum((u - us[a]) / span, 0, 1);
    return { a, b, f };
}

// 路径参数 u 处的期望相机状态（相邻途经点姿态平滑混合）
function computeDesiredState(u) {
    const { a, b, f } = waypointBlendAt(u);
    const A = desiredStateForWaypoint(a);
    const B = desiredStateForWaypoint(b);
    if (a === b) return A;
    const fs = f * f * (3 - 2 * f);   // smoothstep：进出过渡更柔和
    return {
        pos: A.pos.clone().lerp(B.pos, fs),
        target: A.target.clone().lerp(B.target, fs),
        cfg: fs < 0.5 ? A.cfg : B.cfg
    };
}

// ============ 播放控制 ============

function beginTourCamera() {
    tourPath = buildTourPath();
    if (!tourPath) return false;

    tourState.progress = 0;
    tourState.started = false;
    tourState.prevTangent.set(0, 0, 1);

    // 初始化到起点姿态的确定性偏移位置（比目标更高更远），随后阻尼平滑入轨
    const desired = computeDesiredState(0);
    const unit = tileSize;
    tourState.target.copy(desired.target);
    tourState.pos.copy(desired.pos);
    tourState.pos.y += 0.8 * unit;
    tourState.pos.addScaledVector(horizontalTangentAtWaypoint(0), -0.8 * unit);
    tourState.pos.y = Math.max(tourState.pos.y, GROUND_CLEARANCE);

    renderCameraMode = 'tour';
    previewingPoint = false;
    ensureDebugObjects();
    return true;
}

function endTourCamera() {
    tourPath = null;
    useEditorCamera();
    if (debugHelper) debugHelper.visible = false;
    if (debugLine) debugLine.visible = false;
    if (debugMarker) debugMarker.visible = false;
}

/**
 * 固定步长推进一步（由 scene.js 的累加器驱动）
 * 返回 true 表示非循环模式下已到达终点
 */
function stepTourCamera(dt) {
    if (!tourPath || renderCameraMode !== 'tour' || previewingPoint) return false;

    const len = tourPath.curve.getLength();
    if (len <= 1e-6) return true;

    tourState.progress += (tourSpeed * dt) / len;

    let finished = false;
    if (tourState.progress >= 1) {
        if (tourLoop) {
            tourState.progress %= 1;
        } else {
            tourState.progress = 1;
            finished = true;
        }
    }

    const desired = computeDesiredState(tourState.progress);

    if (!tourState.started) {
        tourState.started = true;
    }
    // 指数阻尼：与帧率无关（固定步长下可复现），消除抖动与突变
    const alpha = 1 - Math.exp(-CAMERA_SMOOTHING * dt);
    tourState.pos.lerp(desired.pos, alpha);
    tourState.target.lerp(desired.target, alpha);
    tourState.pos.y = Math.max(tourState.pos.y, GROUND_CLEARANCE);

    applyTourCamera();
    return finished;
}

function applyTourCamera() {
    if (!tourCamera) return;
    tourCamera.up.set(0, 1, 0);           // 固定 up，杜绝翻滚
    tourCamera.position.copy(tourState.pos);
    tourCamera.lookAt(tourState.target);
    if (tourCamera.fov !== camera.fov) {
        tourCamera.fov = camera.fov;
        tourCamera.updateProjectionMatrix();
    }
}

// ============ 单点镜头预览 ============

function previewWaypointCamera(index) {
    if (index < 0 || index >= waypoints.length) {
        showToast('请先选择途经点');
        return false;
    }
    if (!tourPath || tourPath.points.length < 2) {
        tourPath = buildTourPath();
    }
    if (!tourPath) {
        showToast('至少需要 2 个途经点才能预览镜头');
        return false;
    }
    const state = desiredStateForWaypoint(index);
    tourState.pos.copy(state.pos);
    tourState.target.copy(state.target);
    tourState.pos.y = Math.max(tourState.pos.y, GROUND_CLEARANCE);
    renderCameraMode = 'tour';
    previewingPoint = true;
    applyTourCamera();
    ensureDebugObjects();
    showToast(`预览第 ${index + 1} 点镜头`);
    return true;
}

function exitPointPreview() {
    if (!previewingPoint) return;
    previewingPoint = false;
    if (!tourActive) useEditorCamera();
    showToast('已退出镜头预览');
}

// ============ 调试可视化 ============

function ensureDebugObjects() {
    if (!scene) return;
    if (!debugHelper) {
        debugHelper = new THREE.CameraHelper(tourCamera);
        debugHelper.visible = false;
        scene.add(debugHelper);
    }
    if (!debugLine) {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        debugLine = new THREE.Line(geo, new THREE.LineDashedMaterial({
            color: 0xf59e0b, dashSize: 0.6, gapSize: 0.35, transparent: true, opacity: 0.9
        }));
        debugLine.visible = false;
        scene.add(debugLine);
    }
    if (!debugMarker) {
        debugMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.28, 12, 12),
            new THREE.MeshBasicMaterial({ color: 0xfacc15 })
        );
        debugMarker.visible = false;
        scene.add(debugMarker);
    }
}

function setCameraDebug(on) {
    cameraDebugOn = !!on;
    ensureDebugObjects();
    const panel = document.getElementById('debug-panel');
    if (panel) panel.classList.toggle('hidden', !cameraDebugOn);
    if (debugHelper) debugHelper.visible = cameraDebugOn && renderCameraMode === 'tour';
    if (debugLine) debugLine.visible = cameraDebugOn;
    if (debugMarker) debugMarker.visible = cameraDebugOn;
}

// 每帧更新调试可视化与读数
function updateCameraDebug() {
    if (!cameraDebugOn) return;
    ensureDebugObjects();

    const cam = getRenderCamera();
    const active = renderCameraMode === 'tour';

    if (debugHelper) {
        debugHelper.visible = active;
        if (active) debugHelper.update();
    }
    if (debugLine) {
        debugLine.visible = active;
        if (active) {
            const posAttr = debugLine.geometry.attributes.position;
            posAttr.setXYZ(0, cam.position.x, cam.position.y, cam.position.z);
            posAttr.setXYZ(1, tourState.target.x, tourState.target.y, tourState.target.z);
            posAttr.needsUpdate = true;
            debugLine.computeLineDistances();
        }
    }
    if (debugMarker) {
        debugMarker.visible = active && !!tourPath;
        if (debugMarker.visible) {
            const p = tourPath.curve.getPointAt(clampNum(tourState.progress, 0, 1));
            debugMarker.position.copy(p);
        }
    }

    const modeLabel = previewingPoint
        ? '预览'
        : (active ? (computeDesiredState(tourState.progress).cfg.mode) : '编辑');
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const fmt = v => `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;
    set('dbg-mode', modeLabel);
    set('dbg-pos', fmt(cam.position));
    set('dbg-target', fmt(tourState.target));
    set('dbg-progress', active ? `${(tourState.progress * 100).toFixed(0)}%` : '—');
    set('dbg-point', tourPath ? `第 ${waypointBlendAt(tourState.progress).a + 1} / ${waypoints.length} 点` : '—');
}

// ============ 途经点镜头覆盖操作 ============

// 使用当前（编辑器）视角保存到指定途经点 —— 唯一的“当前视角 → 镜头配置”入口
function saveEditorViewToWaypoint(index) {
    const wp = waypoints[index];
    if (!wp) {
        showToast('请先选择途经点');
        return;
    }
    wp.camera = {
        mode: 'pose',
        pose: {
            pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            target: { x: controls.target.x, y: controls.target.y, z: controls.target.z }
        }
    };
    refreshCameraUI();
    showToast(`已将当前视角保存到第 ${index + 1} 点`);
}

// 恢复指定途经点的默认镜头（删除覆盖，回到全局默认）
function resetWaypointCamera(index) {
    const wp = waypoints[index];
    if (!wp) {
        showToast('请先选择途经点');
        return;
    }
    if (!wp.camera) {
        showToast('该点未设置镜头覆盖，已是默认镜头');
        return;
    }
    delete wp.camera;
    refreshCameraUI();
    showToast(`已恢复第 ${index + 1} 点的默认镜头`);
}

// 恢复全局默认镜头设置（不影响途经点覆盖、不影响编辑器视角）
function resetGlobalCameraConfig() {
    globalCameraConfig.mode = 'follow';
    globalCameraConfig.heightTiles = null;
    globalCameraConfig.distanceTiles = null;
    globalCameraConfig.lookAheadTiles = null;
    refreshCameraUI();
    showToast('已恢复默认镜头设置');
}

// ============ 镜头设置面板 ============

let selectedWaypointIndex = 0;   // 当前在镜头面板中选中的途经点

function modeLabelOf(id) {
    const m = CAMERA_MODES.find(x => x.id === id);
    return m ? m.label : id;
}

// 全局可选的镜头模式（“自定义视角”由“使用当前视角”产生，不作为全局模式）
function globalModeChips() {
    return CAMERA_MODES.filter(m => m.id !== 'pose');
}

function buildCameraModeChips() {
    const container = document.getElementById('cam-modes');
    if (!container) return;
    container.innerHTML = '';
    globalModeChips().forEach(m => {
        const chip = document.createElement('button');
        chip.className = 'mode-chip';
        chip.dataset.mode = m.id;
        chip.textContent = m.label;
        chip.addEventListener('click', () => {
            globalCameraConfig.mode = m.id;
            // 切换模式时清掉用户自定义数值，回到该模式基准（避免模式间参数串味）
            globalCameraConfig.heightTiles = null;
            globalCameraConfig.distanceTiles = null;
            globalCameraConfig.lookAheadTiles = null;
            refreshCameraUI();
            liveRefreshCamera();
            showToast(`默认镜头模式：${m.label}`);
        });
        container.appendChild(chip);
    });
}

function refreshCameraUI() {
    const g = resolveGlobalCamera();

    // 模式芯片
    document.querySelectorAll('.mode-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.mode === globalCameraConfig.mode);
    });

    const badge = document.getElementById('cam-mode-badge');
    if (badge) badge.textContent = modeLabelOf(globalCameraConfig.mode);

    // 数值滑块（显示有效值：用户值或模式基准值）
    const bind = (id, valId, value) => {
        const input = document.getElementById(id);
        const label = document.getElementById(valId);
        if (input) input.value = value.toFixed(1);
        if (label) label.textContent = `${value.toFixed(1)}格`;
    };
    bind('cam-height', 'cam-height-val', g.heightTiles);
    bind('cam-distance', 'cam-distance-val', g.distanceTiles);
    bind('cam-lookahead', 'cam-lookahead-val', g.lookAheadTiles);

    // 途经点选择区
    const total = waypoints.length;
    const idxEl = document.getElementById('cam-wp-index');
    const statusEl = document.getElementById('cam-wp-status');
    const wp = waypoints[selectedWaypointIndex];
    if (idxEl) idxEl.textContent = total ? `${selectedWaypointIndex + 1} / ${total}` : '- / -';
    if (statusEl) {
        statusEl.textContent = !total ? '无途经点'
            : (wp && wp.camera ? (wp.camera.pose ? '自定义视角' : '自定义') : '默认镜头');
        statusEl.className = !total
            ? 'text-[10px] text-slate-500'
            : (wp && wp.camera ? 'text-[10px] text-violet-300' : 'text-[10px] text-slate-400');
    }
    ['cam-wp-prev', 'cam-wp-next', 'cam-preview', 'cam-use-current', 'cam-reset-point'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = total === 0;
    });
}

// 参数变化后即时刷新画面（播放中自动生效；预览中重新预览该点）
function liveRefreshCamera() {
    if (previewingPoint && tourActive === false) {
        previewWaypointCamera(selectedWaypointIndex);
    }
}

function selectWaypoint(index) {
    const total = waypoints.length;
    if (!total) return;
    selectedWaypointIndex = ((index % total) + total) % total;  // 循环
    refreshCameraUI();
}

// —— 面板事件绑定 ——
// 折叠开关（btn-cam-collapse / cam-body / cam-chevron）统一由 ui.js 的 bindCollapsePanel 绑定
(function bindCameraPanel() {
    buildCameraModeChips();

    const slider = (id, key) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', e => {
            globalCameraConfig[key] = Number(e.target.value);
            refreshCameraUI();
            liveRefreshCamera();
        });
    };
    slider('cam-height', 'heightTiles');
    slider('cam-distance', 'distanceTiles');
    slider('cam-lookahead', 'lookAheadTiles');

    document.getElementById('cam-wp-prev').addEventListener('click', () => selectWaypoint(selectedWaypointIndex - 1));
    document.getElementById('cam-wp-next').addEventListener('click', () => selectWaypoint(selectedWaypointIndex + 1));
    document.getElementById('cam-preview').addEventListener('click', () => {
        if (previewingPoint) { exitPointPreview(); refreshCameraUI(); return; }
        if (previewWaypointCamera(selectedWaypointIndex)) refreshCameraUI();
    });
    document.getElementById('cam-use-current').addEventListener('click', () => {
        saveEditorViewToWaypoint(selectedWaypointIndex);
    });
    document.getElementById('cam-reset-point').addEventListener('click', () => {
        resetWaypointCamera(selectedWaypointIndex);
    });
    document.getElementById('cam-reset-global').addEventListener('click', resetGlobalCameraConfig);

    document.getElementById('chk-debug').addEventListener('change', e => setCameraDebug(e.target.checked));

    refreshCameraUI();
})();
