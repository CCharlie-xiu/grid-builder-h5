/**
 * items.js — 物品工厂与鼠标跟随的半透明预览模型
 * createItemMesh / updatePreviewMesh / animatePopIn
 * 约定：每个物品 Group 的底面位于局部 y=0，并在 userData.itemHeight 记录总高度（供上层堆叠计算）
 *
 * 建模分发：先查 items-extra.js 注册的 ITEM_BUILDERS（建筑/地标/家具/城市配套），
 * 未命中再走下方的基础物品分支（地形/方块/树/晶体/座椅/车/红绿灯）。
 */

let previewMesh = null;

// 按工具定义创建一个物品 Group（橡皮擦 / 选择返回 null）
function createItemMesh(tool) {
    const group = new THREE.Group();

    if (tool.type === 'eraser' || tool.type === 'select') {
        return null; // 工具类不生成实体
    }

    // —— 扩展物品（items-extra.js）——
    if (typeof ITEM_BUILDERS !== 'undefined' && ITEM_BUILDERS[tool.id]) {
        ITEM_BUILDERS[tool.id](group, tool);
        return group;
    }

    if (tool.id === 'road_straight' || tool.id === 'road_curve' || tool.id === 'road_cross') {
        // —— 马路：一整块 2x2 沥青地砖（高 0.12），可向上堆叠 ——
        const h = 0.12;
        const asphalt = new THREE.MeshStandardMaterial({ color: tool.color, roughness: 0.95, metalness: 0 });
        const tile = new THREE.Mesh(new THREE.BoxGeometry(tileSize * 0.98, h, tileSize * 0.98), asphalt);
        tile.position.y = h / 2;
        tile.receiveShadow = true;
        group.add(tile);

        const lineMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
        const dashGeo = new THREE.BoxGeometry(0.42, 0.02, 0.14);
        const longDashGeo = new THREE.BoxGeometry(0.14, 0.02, 0.42);

        if (tool.shape === 'straight') {
            // 纵向中央虚线
            for (let i = -1; i <= 1; i++) {
                const d = new THREE.Mesh(dashGeo, lineMat);
                d.position.set(0, h + 0.011, i * 0.58);
                group.add(d);
            }
        } else if (tool.shape === 'curve') {
            // 转角弧线标线（四分之一圆）
            for (let k = 0; k <= 6; k++) {
                const a = (k / 6) * (Math.PI / 2);
                const seg = new THREE.Mesh(dashGeo, lineMat);
                seg.position.set(Math.cos(a) * 0.62, h + 0.011, Math.sin(a) * 0.62);
                seg.rotation.y = -a;
                group.add(seg);
            }
        } else if (tool.shape === 'cross') {
            // 十字：纵、横各一条虚线
            for (let i = -1; i <= 1; i++) {
                const dz = new THREE.Mesh(dashGeo, lineMat);
                dz.position.set(0, h + 0.011, i * 0.58);
                group.add(dz);
                const dx = new THREE.Mesh(longDashGeo, lineMat);
                dx.position.set(i * 0.58, h + 0.011, 0);
                group.add(dx);
            }
        }
        group.userData.itemHeight = h;
    }
    else if (tool.id === 'cube') {
        const geo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
        const mat = new THREE.MeshStandardMaterial({ color: tool.color, roughness: 0.3, metalness: 0.2 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 0.8;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        // Add inner accent edge
        const edgeGeo = new THREE.EdgesGeometry(geo);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2, transparent: true, opacity: 0.3 });
        const wire = new THREE.LineSegments(edgeGeo, edgeMat);
        wire.position.y = 0.8;
        group.add(wire);

        group.userData.itemHeight = 1.6;
    }
    else if (tool.id === 'pillar') {
        const geo = new THREE.CylinderGeometry(0.7, 0.9, 2.2, 16);
        const mat = new THREE.MeshStandardMaterial({ color: tool.color, roughness: 0.6, metalness: 0.3 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 1.1;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        // Pillar cap top
        const capGeo = new THREE.CylinderGeometry(1.0, 1.0, 0.3, 16);
        const capMesh = new THREE.Mesh(capGeo, mat);
        capMesh.position.y = 2.35;
        capMesh.castShadow = true;
        group.add(capMesh);

        group.userData.itemHeight = 2.5;
    }
    else if (tool.id === 'tree') {
        // Trunk
        const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.0, 8);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 0.5;
        trunk.castShadow = true;
        group.add(trunk);

        // Foliage layers
        const foliageMat = new THREE.MeshStandardMaterial({ color: tool.color, roughness: 0.5 });
        const cone1 = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.8, 7), foliageMat);
        cone1.position.y = 1.5;
        cone1.castShadow = true;
        group.add(cone1);

        const cone2 = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.4, 7), foliageMat);
        cone2.position.y = 2.4;
        cone2.castShadow = true;
        group.add(cone2);

        group.userData.itemHeight = 3.1;
    }
    else if (tool.id === 'light') {
        const geo = new THREE.OctahedronGeometry(0.8);
        const mat = new THREE.MeshStandardMaterial({
            color: tool.color,
            emissive: tool.color,
            emissiveIntensity: 0.8,
            roughness: 0.1,
            metalness: 0.9
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 1.2;
        mesh.castShadow = true;
        group.add(mesh);

        // Base stand
        const baseGeo = new THREE.CylinderGeometry(0.6, 0.8, 0.3, 12);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x334155 });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 0.15;
        base.castShadow = true;
        group.add(base);

        // Inner point light for glow effect
        const glow = new THREE.PointLight(tool.color, 1.5, 6);
        glow.position.y = 1.2;
        group.add(glow);

        group.userData.itemHeight = 2.0;
    }
    else if (tool.id === 'chair') {
        const mat = new THREE.MeshStandardMaterial({ color: tool.color, roughness: 0.4 });
        // Seat
        const seatGeo = new THREE.BoxGeometry(1.2, 0.2, 1.2);
        const seat = new THREE.Mesh(seatGeo, mat);
        seat.position.y = 0.8;
        seat.castShadow = true;
        group.add(seat);

        // Backrest
        const backGeo = new THREE.BoxGeometry(1.2, 1.2, 0.2);
        const back = new THREE.Mesh(backGeo, mat);
        back.position.set(0, 1.5, -0.5);
        back.castShadow = true;
        group.add(back);

        // Legs
        const legGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.8);
        const legMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8 });

        [-0.45, 0.45].forEach(x => {
            [-0.45, 0.45].forEach(z => {
                const leg = new THREE.Mesh(legGeo, legMat);
                leg.position.set(x, 0.4, z);
                leg.castShadow = true;
                group.add(leg);
            });
        });

        group.userData.itemHeight = 2.1;
    }
    else if (tool.id === 'car') {
        const bodyMat = new THREE.MeshStandardMaterial({ color: tool.color, roughness: 0.3, metalness: 0.5 });
        // 车身
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 0.66), bodyMat);
        body.position.y = 0.31;
        body.castShadow = true;
        group.add(body);
        // 座舱
        const cabin = new THREE.Mesh(
            new THREE.BoxGeometry(0.7, 0.26, 0.58),
            new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1, metalness: 0.6 })
        );
        cabin.position.set(-0.05, 0.59, 0);
        cabin.castShadow = true;
        group.add(cabin);
        // 车灯
        const headlight = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.1, 0.16),
            new THREE.MeshBasicMaterial({ color: 0xfef9c3 })
        );
        headlight.position.set(0.66, 0.32, 0.2);
        group.add(headlight);
        const taillight = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.1, 0.16),
            new THREE.MeshBasicMaterial({ color: 0xef4444 })
        );
        taillight.position.set(-0.66, 0.32, 0.2);
        group.add(taillight);
        // 四个轮子
        const wheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.12, 12);
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 });
        [[0.42, 0.34], [0.42, -0.34], [-0.42, 0.34], [-0.42, -0.34]].forEach(([x, z]) => {
            const wheel = new THREE.Mesh(wheelGeo, wheelMat);
            wheel.position.set(x, 0.18, z);
            wheel.rotation.x = Math.PI / 2;
            wheel.castShadow = true;
            group.add(wheel);
        });

        group.userData.itemHeight = 0.72;
    }
    else if (tool.id === 'traffic_light') {
        // 灯杆
        const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.08, 2.2, 10),
            new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.6 })
        );
        pole.position.y = 1.1;
        pole.castShadow = true;
        group.add(pole);
        // 灯箱
        const head = new THREE.Mesh(
            new THREE.BoxGeometry(0.36, 0.92, 0.24),
            new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 })
        );
        head.position.set(0, 2.3, 0.1);
        head.castShadow = true;
        group.add(head);
        // 三色灯（红/黄/绿，默认亮绿）
        const lampSpecs = [
            { y: 2.6, color: 0xef4444, on: false },
            { y: 2.3, color: 0xfacc15, on: false },
            { y: 2.0, color: 0x22c55e, on: true }
        ];
        lampSpecs.forEach(spec => {
            const lamp = new THREE.Mesh(
                new THREE.SphereGeometry(0.1, 12, 12),
                new THREE.MeshStandardMaterial({
                    color: spec.color,
                    emissive: spec.color,
                    emissiveIntensity: spec.on ? 1.2 : 0.05
                })
            );
            lamp.position.set(0, spec.y, 0.23);
            group.add(lamp);
        });

        group.userData.itemHeight = 2.8;
    }

    return group;
}

// 切换工具时重建半透明预览模型
function updatePreviewMesh() {
    if (previewMesh) {
        scene.remove(previewMesh);
        previewMesh = null;
    }

    if (currentTool.type === 'eraser') return;

    previewMesh = createItemMesh(currentTool);
    if (previewMesh) {
        // Make preview semi-transparent
        previewMesh.traverse((child) => {
            if (child.isMesh) {
                child.material = child.material.clone();
                child.material.transparent = true;
                child.material.opacity = 0.5;
            }
        });
        previewMesh.visible = false;
        scene.add(previewMesh);
    }
}

// 放置物品时的放大入场动画
function animatePopIn(mesh) {
    let scale = 0.1;
    function step() {
        scale += 0.15;
        if (scale < 1.0) {
            mesh.scale.set(scale, scale, scale);
            requestAnimationFrame(step);
        } else {
            mesh.scale.set(1, 1, 1);
        }
    }
    step();
}
