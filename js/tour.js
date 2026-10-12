/**
 * tour.js — 路线规划 + 游览调度
 * 途经点：{ x, y, z, key, marker, camera? }
 *   camera 为可选镜头覆盖（{ mode?, heightTiles?, distanceTiles?, lookAheadTiles?, lookAt?, pose? }），
 *   不写入即继承全局默认镜头；旧数据无该字段同样可正常导览。
 * 相机运动实现全部在 camera.js，本文件只负责路线数据与播放调度。
 */

let planningMode = false;   // 是否处于路线规划模式
let tourActive = false;     // 游览是否进行中
let tourLoop = false;       // 是否循环游览
let tourSpeed = 9;          // 游览速度（世界单位/秒）
let tourAccumulator = 0;    // 固定步长累加器（保证播放可复现）

const waypoints = [];       // [{ x, y, z, key, marker, camera? }]
const WAYPOINT_MAX = 20;
let routeLine = null;       // 途经点连线

// —— 规划模式开关 ——
function togglePlanningMode() {
    planningMode = !planningMode;
    const btn = document.getElementById('btn-plan');
    btn.classList.toggle('active', planningMode);
    if (planningMode) {
        if (tourActive) stopTour();
        exitPointPreview();
        showToast('路线规划已开启：点击地面依次添加途经点');
    } else {
        showToast('路线规划已关闭');
    }
    refreshCursor();
}

// —— 途经点管理 ——
function addWaypoint(x, y, z, key, silent) {
    if (waypoints.length >= WAYPOINT_MAX) {
        if (!silent) showToast(`途经点最多 ${WAYPOINT_MAX} 个，请先清空或撤销`);
        return;
    }
    // 与上一个途经点同格则忽略
    const last = waypoints[waypoints.length - 1];
    if (last && last.key === key) return;

    const marker = new THREE.Group();

    // 地面光环
    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.72, 0.06, 10, 36),
        new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 0.8, roughness: 0.3 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    marker.add(ring);

    // 中心光柱
    const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 1.4, 8),
        new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.55 })
    );
    beam.position.y = 0.7;
    marker.add(beam);

    // 序号标签
    marker.add(makeNumberSprite(waypoints.length + 1));

    marker.position.set(x, y, z);
    scene.add(marker);
    // 不写入 camera 字段：默认继承全局镜头设置
    waypoints.push({ x, y, z, key, marker });
    updateRouteLine();
    updateWaypointCount();
    refreshCameraUI();
    if (!silent) showToast(`已添加途经点 ${waypoints.length}`);
}

function undoWaypoint() {
    const wp = waypoints.pop();
    if (!wp) {
        showToast('没有可撤销的途经点');
        return;
    }
    scene.remove(wp.marker);
    updateRouteLine();
    updateWaypointCount();
    if (selectedWaypointIndex >= waypoints.length) {
        selectedWaypointIndex = Math.max(0, waypoints.length - 1);
    }
    refreshCameraUI();
    showToast(`已撤销途经点 ${waypoints.length + 1}`);
}

// 清空路线：只删途经点与连线，不动场景物品、不动编辑器视角、不动镜头配置
function clearRoute() {
    if (tourActive) stopTour();
    exitPointPreview();
    waypoints.forEach(wp => scene.remove(wp.marker));
    waypoints.length = 0;
    selectedWaypointIndex = 0;
    updateRouteLine();
    updateWaypointCount();
    refreshCameraUI();
    showToast('路线已清空');
}

// —— 路线连线 ——
function updateRouteLine() {
    if (routeLine) {
        scene.remove(routeLine);
        routeLine.geometry.dispose();
        routeLine.material.dispose();
        routeLine = null;
    }
    if (waypoints.length < 2) return;
    const pts = waypoints.map(w => new THREE.Vector3(w.x, w.y + 0.04, w.z));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    routeLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9 }));
    scene.add(routeLine);
}

function updateWaypointCount() {
    const el = document.getElementById('wp-count');
    if (el) el.textContent = `${waypoints.length}个途经点`;
}

// —— 序号数字贴图 ——
function makeNumberSprite(n) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(8,145,178,0.95)';
    ctx.beginPath();
    ctx.arc(64, 64, 54, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a5f3fc';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 62px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 64, 68);
    const tex = new THREE.CanvasTexture(canvas);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sp.scale.set(1.0, 1.0, 1.0);
    sp.position.y = 1.9;
    return sp;
}

// —— 游览控制 ——
function startTour() {
    if (waypoints.length < 2) {
        showToast('至少需要 2 个途经点才能开始游览');
        return;
    }
    previewingPoint = false;
    if (!beginTourCamera()) {
        showToast('路线点过于集中，无法生成有效路径');
        return;
    }
    tourActive = true;
    tourAccumulator = 0;
    controls.enabled = false;
    if (previewMesh) previewMesh.visible = false;
    if (planningMode) togglePlanningMode();
    updateTourButtons(true);
    refreshCameraUI();
    showToast('游览开始：导览相机独立跟随，编辑器视角保持不变');
}

function stopTour() {
    if (!tourActive) return;
    tourActive = false;
    controls.enabled = true;
    endTourCamera();          // 切回编辑器相机；编辑器相机姿态全程未被修改
    updateTourButtons(false);
    refreshCameraUI();
    showToast('游览已停止');
}

function updateTourButtons(running) {
    const btn = document.getElementById('btn-tour');
    if (!btn) return;
    btn.classList.toggle('playing', running);
    btn.innerHTML = running
        ? '<i class="fa-solid fa-stop text-[11px]"></i>停止游览'
        : '<i class="fa-solid fa-play text-[11px]"></i>开始游览';
}

/**
 * 固定步长推进游览（由 scene.js 动画循环调用）
 * 与帧率解耦：相同路线与镜头配置重复播放，运动轨迹一致
 */
function advanceTour(frameDt) {
    if (!tourActive) return;
    tourAccumulator += Math.min(frameDt, 0.25);
    let steps = 0;
    while (tourAccumulator >= FIXED_DT && steps < MAX_FRAME_STEPS) {
        const finished = stepTourCamera(FIXED_DT);
        tourAccumulator -= FIXED_DT;
        steps++;
        if (finished) {
            if (tourLoop) continue;
            stopTour();
            return;
        }
    }
}

// 面板折叠/展开
function toggleRoutePanel() {
    const body = document.getElementById('route-body');
    const chevron = document.getElementById('route-chevron');
    const collapsed = body.classList.toggle('hidden');
    chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
}

// —— 面板事件绑定（脚本位于 body 末尾，DOM 已就绪） ——
(function bindTourPanel() {
    document.getElementById('btn-plan').addEventListener('click', togglePlanningMode);
    document.getElementById('btn-wp-undo').addEventListener('click', undoWaypoint);
    document.getElementById('btn-wp-clear').addEventListener('click', clearRoute);
    document.getElementById('btn-route-collapse').addEventListener('click', toggleRoutePanel);
    document.getElementById('btn-tour').addEventListener('click', () => {
        tourActive ? stopTour() : startTour();
    });
    document.getElementById('chk-loop').addEventListener('change', e => {
        tourLoop = e.target.checked;
    });
})();
