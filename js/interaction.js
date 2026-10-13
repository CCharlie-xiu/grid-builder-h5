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

    // AI 模式：打开面板（复制提示词 → AI 写 Spec → 粘回来生成）
    const ai = document.createElement('button');
    ai.className = 'assistant-btn';
    ai.innerHTML = '<span class="ai-dot"></span>AI 模式';
    ai.addEventListener('click', () => {
        if (typeof openAiPanel === 'function') openAiPanel();
        else showToast('AI 面板未加载');
    });
    container.appendChild(ai);

    // 分类过滤后的物品
    const items = currentCategory === 'all'
        ? CATALOG
        : CATALOG.filter(item => item.cat === currentCategory);
    items.forEach(item => appendPaletteButton(container, item));

    resetPaletteScroll();
    syncPaletteActive();
    requestAnimationFrame(refreshPaletteNav);
}

// —— 物品栏翻页：隐藏原生滚动条，改用左右按钮 ——
const PALETTE_PAGE_RATIO = 0.85;   // 单次翻页滚动的视口宽度占比

function paletteViewport() {
    return document.getElementById('palette-viewport');
}

function resetPaletteScroll() {
    const vp = paletteViewport();
    if (vp) vp.scrollTo({ left: 0, behavior: 'auto' });
}

function pagePalette(dir) {
    const vp = paletteViewport();
    if (!vp) return;
    vp.scrollBy({ left: dir * vp.clientWidth * PALETTE_PAGE_RATIO, behavior: 'smooth' });
}

// 按滚动位置启用/禁用左右按钮（触底/触顶时置灰）
function refreshPaletteNav() {
    const vp = paletteViewport();
    const prev = document.getElementById('palette-prev');
    const next = document.getElementById('palette-next');
    if (!vp || !prev || !next) return;
    const max = vp.scrollWidth - vp.clientWidth;
    const scrollable = max > 2;
    prev.disabled = !scrollable || vp.scrollLeft <= 1;
    next.disabled = !scrollable || vp.scrollLeft >= max - 1;
}

// 绑定翻页（脚本位于 body 末尾，DOM 已就绪）
(function bindPalettePager() {
    const vp = paletteViewport();
    if (!vp) return;
    document.getElementById('palette-prev').addEventListener('click', () => pagePalette(-1));
    document.getElementById('palette-next').addEventListener('click', () => pagePalette(1));
    vp.addEventListener('scroll', refreshPaletteNav, { passive: true });
    window.addEventListener('resize', refreshPaletteNav);
})();

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
    if (!btn) return;
    btn.classList.add('active');
    // 方向键切换物品时，把选中项滚进可视区（不触发整页滚动）
    if (typeof btn.scrollIntoView === 'function') {
        btn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
}

// 切换工具（托盘点击 / 方向键共用）
function setTool(item) {
    currentTool = item;
    // 离开选择工具时清掉选中态，避免操作条悬空
    if (item.type !== 'select' && selectedItem) clearSelection();
    syncPaletteActive();
    updatePreviewMesh();
    refreshCursor();
    showToast(`已切换工具: ${item.name}`);
}

// 画布光标状态：默认可取/拖拽中抓取/规划或移动时准星/选择时可点
function refreshCursor() {
    if (!renderer) return;
    const el = renderer.domElement;
    if (planningMode || movingSelection) {
        el.style.cursor = 'crosshair';
    } else if (currentTool.type === 'select') {
        el.style.cursor = 'pointer';
    } else {
        el.style.cursor = isDragging ? 'grabbing' : 'grab';
    }
}

/**
 * 射线解析当前鼠标指向的格子与堆叠面
 * 返回 { gridX, gridZ, worldX, worldZ, baseY, colKey, hitItem } 或 null（未命中/越界）
 * baseY：放置基面的世界高度（地面 0 或所命中物品的顶面）
 * hitItem：命中的已放置物品 Group（点在地面上时为 null）
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

    let baseY = 0, colKey = null, hitItem = null;
    if (owner && hit.object !== plane) {
        colKey = owner.userData.colKey;
        baseY = owner.userData.topY;
        hitItem = owner;
    }

    const localX = hit.point.x + halfWidth;
    const localZ = hit.point.z + halfWidth;
    const gridX = Math.floor(localX / tileSize);
    const gridZ = Math.floor(localZ / tileSize);
    if (gridX < 0 || gridX >= gridSize || gridZ < 0 || gridZ >= gridSize) return null;

    const worldX = gridX * tileSize - halfWidth + tileSize / 2;
    const worldZ = gridZ * tileSize - halfWidth + tileSize / 2;
    return { gridX, gridZ, worldX, worldZ, baseY, colKey, hitItem };
}

/**
 * 只对地面求交的格子解析（移动物体时用）
 * 返回 { gridX, gridZ, key, worldX, worldZ } 或 null
 */
function resolveGroundCell() {
    const totalWidth = gridSize * tileSize;
    const halfWidth = totalWidth / 2;
    const hits = raycaster.intersectObject(plane, false);
    if (!hits.length) return null;
    const p = hits[0].point;
    const gridX = Math.floor((p.x + halfWidth) / tileSize);
    const gridZ = Math.floor((p.z + halfWidth) / tileSize);
    if (gridX < 0 || gridX >= gridSize || gridZ < 0 || gridZ >= gridSize) return null;
    return {
        gridX,
        gridZ,
        key: `${gridX},${gridZ}`,
        worldX: gridX * tileSize - halfWidth + tileSize / 2,
        worldZ: gridZ * tileSize - halfWidth + tileSize / 2
    };
}

// 重排某一格子的堆叠：从地面往上重新计算各层 y 与 topY（移除/移动后调用）
function relayoutColumn(key) {
    const col = placedItems.get(key);
    if (!col || col.length === 0) {
        placedItems.delete(key);
        return;
    }
    let y = 0;
    col.forEach(item => {
        item.position.y = y;
        item.userData.topY = y + (item.userData.itemHeight || 1);
        y = item.userData.topY;
    });
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

    // 选择模式：选中已放置物体 / 移动 / 取消选择
    if (currentTool.type === 'select') {
        handleSelectClick(target);
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
        clearSelection();
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
    camera.position.set(80, 34, 108);
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

// ============ 物体选择与操作（选择工具） ============

let selectedItem = null;        // 当前选中的已放置物品 Group
let movingSelection = false;    // 是否处于「移动到其他格子」状态
let selectionHelper = null;     // 选中高亮框（BoxHelper，世界包围盒）
let selectionFootprint = null;  // 地面脚印方框（随物体朝向旋转）
let selectionFill = null;       // 脚印填充面（增强可见度）

// 选中高亮色：琥珀色——在蓝色场景里对比度最高，一眼可辨
const SELECTION_COLOR = 0xfbbf24;

function toolNameOf(item) {
    const t = CATALOG.find(x => x.id === item.userData.toolId);
    return t ? t.name : (item.userData.toolId || '物体');
}

// 选中一个已放置物品
function selectItem(item) {
    if (!item || selectedItem === item) return;
    selectedItem = item;
    movingSelection = false;
    updateSelectionHelper();
    refreshSelectionUI();
    refreshCursor();
    showToast(`已选中：${toolNameOf(item)}（可旋转 / 移动 / 移除）`);
}

function clearSelection() {
    if (!selectedItem && !movingSelection) return;
    selectedItem = null;
    movingSelection = false;
    if (selectionHelper) selectionHelper.visible = false;
    if (selectionFootprint) selectionFootprint.visible = false;
    if (selectionFill) selectionFill.visible = false;
    refreshSelectionUI();
    refreshCursor();
}

// 高亮框 + 地面脚印：都绘制在最上层，避免被物体自身遮住
function updateSelectionHelper() {
    if (!selectedItem) {
        if (selectionHelper) selectionHelper.visible = false;
        if (selectionFootprint) selectionFootprint.visible = false;
        if (selectionFill) selectionFill.visible = false;
        return;
    }

    if (!selectionHelper) {
        selectionHelper = new THREE.BoxHelper(selectedItem, SELECTION_COLOR);
        selectionHelper.material.depthTest = false;
        selectionHelper.material.transparent = true;
        selectionHelper.material.opacity = 0.95;
        selectionHelper.renderOrder = 999;
        scene.add(selectionHelper);
    }
    selectionHelper.setFromObject(selectedItem);
    selectionHelper.visible = true;

    // 脚印方框：贴合所在格子，随物体朝向一起转
    if (!selectionFootprint) {
        const half = tileSize / 2;
        const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-half, 0, -half),
            new THREE.Vector3(half, 0, -half),
            new THREE.Vector3(half, 0, half),
            new THREE.Vector3(-half, 0, half)
        ]);
        selectionFootprint = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({
            color: SELECTION_COLOR, transparent: true, opacity: 0.9
        }));
        selectionFootprint.renderOrder = 2;
        scene.add(selectionFootprint);
    }
    if (!selectionFill) {
        const geo = new THREE.PlaneGeometry(tileSize * 0.94, tileSize * 0.94);
        geo.rotateX(-Math.PI / 2);
        selectionFill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            color: SELECTION_COLOR, transparent: true, opacity: 0.2, side: THREE.DoubleSide
        }));
        selectionFill.renderOrder = 1;
        scene.add(selectionFill);
    }

    const fx = selectedItem.position.x;
    const fy = selectedItem.position.y + 0.035;
    const fz = selectedItem.position.z;
    const fyaw = selectedItem.rotation.y;
    [selectionFootprint, selectionFill].forEach(m => {
        m.position.set(fx, fy, fz);
        m.rotation.y = fyaw;
        m.visible = true;
    });
}

// 选中高亮呼吸闪烁（由 scene.js 的动画循环驱动）
function updateSelectionPulse() {
    if (!selectionHelper || !selectionHelper.visible) return;
    const t = performance.now() / 1000;
    const k = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * 4));
    selectionHelper.material.opacity = k;
    if (selectionFootprint && selectionFootprint.visible) {
        selectionFootprint.material.opacity = k;
    }
    if (selectionFill && selectionFill.visible) {
        selectionFill.material.opacity = 0.12 + 0.16 * (0.5 + 0.5 * Math.sin(t * 4));
    }
}

// 当前朝向（度，0~359）
function selectionAngleDeg() {
    if (!selectedItem) return 0;
    const twoPi = Math.PI * 2;
    const a = ((selectedItem.rotation.y % twoPi) + twoPi) % twoPi;
    return Math.round((a * 180) / Math.PI);
}

function refreshSelectionUI() {
    const bar = document.getElementById('selection-bar');
    if (!bar) return;
    if (!selectedItem) {
        bar.classList.add('hidden');
        return;
    }
    bar.classList.remove('hidden');
    document.getElementById('sel-name').textContent = toolNameOf(selectedItem);
    document.getElementById('sel-angle').textContent = `${selectionAngleDeg()}°`;
    const moveBtn = document.getElementById('sel-move');
    if (moveBtn) moveBtn.classList.toggle('active', movingSelection);
}

// 旋转选中物（step 为弧度，通常 ±90°）
function rotateSelected(step) {
    if (!selectedItem) return;
    selectedItem.rotation.y += step;
    updateSelectionHelper();
    refreshSelectionUI();
}

// 进入/退出「移动到其他格子」
function toggleMoveSelection() {
    if (!selectedItem) return;
    movingSelection = !movingSelection;
    refreshSelectionUI();
    refreshCursor();
    showToast(movingSelection
        ? '点击目标格子完成移动（再点「移动」或按 Esc 取消）'
        : '已取消移动');
}

// 移除选中物，并重排原格子堆叠
function removeSelected() {
    if (!selectedItem) return;
    const item = selectedItem;
    const key = item.userData.colKey;
    const col = placedItems.get(key);
    if (col) {
        const idx = col.indexOf(item);
        if (idx >= 0) col.splice(idx, 1);
    }
    scene.remove(item);
    relayoutColumn(key);
    clearSelection();
    showToast('已移除选中物体');
}

// 把选中物移动到目标格子（堆到该格顶部）
function moveSelectedTo(cell) {
    const item = selectedItem;
    if (!item || !cell) return;
    const fromKey = item.userData.colKey;
    if (fromKey === cell.key) {
        showToast('已经在目标格子');
        return;
    }
    const toCol = placedItems.get(cell.key) || [];
    if (toCol.length >= MAX_STACK) {
        showToast(`目标格子已达 ${MAX_STACK} 层上限`);
        return;
    }

    const fromCol = placedItems.get(fromKey);
    if (fromCol) {
        const idx = fromCol.indexOf(item);
        if (idx >= 0) fromCol.splice(idx, 1);
    }
    relayoutColumn(fromKey);

    const baseY = toCol.length ? toCol[toCol.length - 1].userData.topY : 0;
    item.position.set(cell.worldX, baseY, cell.worldZ);
    item.userData.colKey = cell.key;
    item.userData.topY = baseY + (item.userData.itemHeight || 1);
    toCol.push(item);
    placedItems.set(cell.key, toCol);

    movingSelection = false;
    updateSelectionHelper();
    refreshSelectionUI();
    refreshCursor();
    showToast(`已移动到 ${cell.key}`);
}

// 选择工具下的点击处理
function handleSelectClick(target) {
    // 移动状态：只对地面求交，点哪儿放到哪儿
    if (movingSelection && selectedItem) {
        const cell = resolveGroundCell();
        if (cell) moveSelectedTo(cell);
        return;
    }
    // 命中已放置物品 → 选中；点空白地面 → 取消选择
    if (target && target.hitItem) {
        selectItem(target.hitItem);
    } else {
        clearSelection();
    }
}

// —— 操作条事件绑定（脚本位于 body 末尾，DOM 已就绪） ——
(function bindSelectionBar() {
    if (!document.getElementById('selection-bar')) return;
    document.getElementById('sel-rot-ccw').addEventListener('click', () => rotateSelected(-Math.PI / 2));
    document.getElementById('sel-rot-cw').addEventListener('click', () => rotateSelected(Math.PI / 2));
    document.getElementById('sel-move').addEventListener('click', toggleMoveSelection);
    document.getElementById('sel-remove').addEventListener('click', removeSelected);
    document.getElementById('sel-cancel').addEventListener('click', clearSelection);
})();

// Esc：先退出「移动」状态，再取消选中
window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (movingSelection) {
        movingSelection = false;
        refreshSelectionUI();
        refreshCursor();
        showToast('已取消移动');
        return;
    }
    if (selectedItem) clearSelection();
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
