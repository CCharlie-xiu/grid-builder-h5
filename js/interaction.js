/**
 * interaction.js — 用户交互
 * 分类页签 / 物品栏 UI、方向键切换工具、射线追踪（含 5 层堆叠）、
 * 点击放置/擦除、路线规划点击、镜头拖拽光标反馈
 */

const paletteButtons = {};  // toolId -> button 元素
let pointerDownPos = null;  // 按下位置（用于区分点击与拖拽）
let isDragging = false;     // 是否正在拖拽镜头

// —— 分类页签 ——
function buildCategoryTabs() {
    const container = document.getElementById('category-tabs');
    CATEGORIES.forEach(cat => {
        const tab = document.createElement('button');
        tab.className = `cat-tab ${cat.id === currentCategory ? 'active' : ''}`;
        tab.textContent = cat.label;
        tab.dataset.cat = cat.id;
        tab.addEventListener('click', () => {
            currentCategory = cat.id;
            document.querySelectorAll('.cat-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === cat.id));
            renderPalette();
        });
        container.appendChild(tab);
    });
}

// —— 物品栏：常用工具 + AI 助手 + 当前分类物品 ——
function renderPalette() {
    const container = document.getElementById('palette-container');
    container.innerHTML = '';
    Object.keys(paletteButtons).forEach(k => delete paletteButtons[k]);

    // 常用工具（选择 / 擦除）
    TOOLS.forEach(tool => appendPaletteButton(container, tool));

    // AI 助手
    const ai = document.createElement('button');
    ai.className = 'assistant-btn';
    ai.innerHTML = '<span class="ai-dot"></span>问问 AI';
    ai.addEventListener('click', () => showToast('AI 助手即将上线，敬请期待'));
    container.appendChild(ai);

    // 分类过滤后的物品
    const items = currentCategory === 'all'
        ? CATALOG
        : CATALOG.filter(item => item.cat === currentCategory);
    items.forEach(item => appendPaletteButton(container, item));

    syncPaletteActive();
}

function appendPaletteButton(container, tool) {
    const btn = document.createElement('button');
    btn.className = 'palette-btn';
    btn.innerHTML = `<i class="fa-solid ${tool.icon}" style="color: #${tool.color.toString(16).padStart(6, '0')}"></i><span>${tool.name}</span>`;
    btn.addEventListener('click', () => setTool(tool));
    paletteButtons[tool.id] = btn;
    container.appendChild(btn);
}

function syncPaletteActive() {
    document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
    const btn = paletteButtons[currentTool.id];
    if (btn) btn.classList.add('active');
}

// 切换工具（托盘点击 / 方向键共用）
function setTool(item) {
    currentTool = item;
    syncPaletteActive();
    updatePreviewMesh();
    showToast(`已切换工具: ${item.name}`);
}

// 画布光标状态：默认可取/拖拽中抓取/规划模式准星
function refreshCursor() {
    if (!renderer) return;
    renderer.domElement.style.cursor = planningMode ? 'crosshair' : (isDragging ? 'grabbing' : 'grab');
}

/**
 * 射线解析当前鼠标指向的格子与堆叠面
 * 返回 { gridX, gridZ, worldX, worldZ, baseY, colKey } 或 null（未命中/越界）
 * baseY：放置基面的世界高度（地面 0 或所命中物品的顶面）
 */
function resolveGridTarget() {
    const totalWidth = gridSize * tileSize;
    const halfWidth = totalWidth / 2;

    // 地面 + 所有已放置物品（物品为 Group，需递归命中子网格）
    const targets = [plane];
    placedItems.forEach(col => col.forEach(item => targets.push(item)));
    const hits = raycaster.intersectObjects(targets, true);
    if (!hits.length) return null;
    const hit = hits[0];

    // 命中物品时向上找到所属 Group，取其顶面高度
    let owner = hit.object;
    while (owner && !owner.userData.colKey) owner = owner.parent;

    let baseY = 0, colKey = null;
    if (owner && hit.object !== plane) {
        colKey = owner.userData.colKey;
        baseY = owner.userData.topY;
    }

    const localX = hit.point.x + halfWidth;
    const localZ = hit.point.z + halfWidth;
    const gridX = Math.floor(localX / tileSize);
    const gridZ = Math.floor(localZ / tileSize);
    if (gridX < 0 || gridX >= gridSize || gridZ < 0 || gridZ >= gridSize) return null;

    const worldX = gridX * tileSize - halfWidth + tileSize / 2;
    const worldZ = gridZ * tileSize - halfWidth + tileSize / 2;
    return { gridX, gridZ, worldX, worldZ, baseY, colKey };
}

function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    if (!previewMesh) return;
    if (tourActive || planningMode) { previewMesh.visible = false; return; }

    const target = resolveGridTarget();
    if (!target) { previewMesh.visible = false; return; }

    const key = `${target.gridX},${target.gridZ}`;
    const col = placedItems.get(key) || [];
    const full = col.length >= MAX_STACK;

    if (full) { previewMesh.visible = false; return; }

    previewMesh.position.set(target.worldX, target.baseY, target.worldZ);
    previewMesh.visible = true;
    previewMesh.traverse(child => {
        if (child.isMesh && child.material) {
            child.material.opacity = col.length > 0 ? 0.75 : 0.5; // 叠放预览更实一点
        }
    });
}

function onClick(event) {
    // 忽略 UI 区域的点击
    if (event.target.tagName === 'BUTTON' || event.target.closest('button') || event.target.closest('.glass-panel')) {
        return;
    }
    // 拖拽镜头（位移超过 6px）不触发放置
    if (pointerDownPos) {
        const dx = event.clientX - pointerDownPos.x;
        const dy = event.clientY - pointerDownPos.y;
        if (Math.hypot(dx, dy) > 6) return;
    }
    if (tourActive) {
        showToast('游览进行中，先停止游览再操作');
        return;
    }

    raycaster.setFromCamera(mouse, camera);
    const target = resolveGridTarget();
    if (!target) return;

    const key = `${target.gridX},${target.gridZ}`;

    // 规划模式：添加途经点
    if (planningMode) {
        addWaypoint(target.worldX, target.baseY, target.worldZ, key);
        return;
    }

    // 选择模式：仅查看，不放置
    if (currentTool.type === 'select') {
        showToast('当前为选择模式，切换到物品后再放置');
        return;
    }

    const col = placedItems.get(key) || [];

    if (event.shiftKey || currentTool.type === 'eraser') {
        // 移除该格子最顶层物品
        if (col.length > 0) {
            const item = col.pop();
            scene.remove(item);
            if (col.length === 0) placedItems.delete(key);
            showToast(`已移除顶层物品，剩余 ${col.length} 层`);
        }
    } else {
        // 放置物品（受 5 层上限约束）
        if (col.length >= MAX_STACK) {
            showToast(`该格子已达 ${MAX_STACK} 层上限`);
            return;
        }
        const newItem = createItemMesh(currentTool);
        if (newItem) {
            newItem.position.set(target.worldX, target.baseY, target.worldZ);
            newItem.userData.colKey = key;
            newItem.userData.toolId = currentTool.id;   // 序列化需要
            newItem.userData.topY = target.baseY + newItem.userData.itemHeight;

            // Slight pop-in scale animation
            newItem.scale.set(0.1, 0.1, 0.1);
            scene.add(newItem);
            col.push(newItem);
            placedItems.set(key, col);

            animatePopIn(newItem);
            showToast(col.length > 1
                ? `成功放置: ${currentTool.name}（第 ${col.length} 层）`
                : `成功放置: ${currentTool.name}`);
        }
    }
}

// Clear entire scene
function clearScene() {
    if (placedItems.size === 0) {
        showToast("场景已经是空的啦！");
        return;
    }
    if (confirm("确定要清空所有放置的物品吗？")) {
        placedItems.forEach(col => col.forEach(mesh => scene.remove(mesh)));
        placedItems.clear();
        showToast("场景已清空");
    }
}

// Reset Camera position（仅重置编辑器视角，不影响导览镜头配置与路线）
function resetCamera() {
    if (tourActive) stopTour();
    exitPointPreview();
    useEditorCamera();
    camera.position.set(25, 25, 30);
    controls.target.set(0, 0, 0);
    controls.update();
    showToast("编辑器视角已重置");
}

// 方向键切换物品（仅在 CATALOG 内循环）
window.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.target.tagName === 'INPUT') return; // 不干扰表单控件
    event.preventDefault();
    const idx = CATALOG.findIndex(t => t.id === currentTool.id);
    const start = idx < 0 ? 0 : idx;
    const next = event.key === 'ArrowLeft'
        ? (start - 1 + CATALOG.length) % CATALOG.length
        : (start + 1) % CATALOG.length;
    setTool(CATALOG[next]);
});

// 镜头拖拽手势与光标反馈
function bindCanvasGestures() {
    const el = renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
        pointerDownPos = { x: e.clientX, y: e.clientY };
        isDragging = true;
        refreshCursor();
    });
    window.addEventListener('pointerup', () => {
        isDragging = false;
        refreshCursor();
    });
    el.addEventListener('pointerleave', () => {
        isDragging = false;
        refreshCursor();
    });
}
