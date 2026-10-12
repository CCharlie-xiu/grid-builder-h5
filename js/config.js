/**
 * config.js — 全局配置
 * 物品目录（按分类）、常用工具、分类页签、当前选中工具、堆叠层数上限
 * 必须在其他脚本之前加载
 */

// 每个格子最多堆叠的层数
const MAX_STACK = 5;

// 常用工具（不属于任何分类，固定在物品栏最前）
const TOOLS = [
    { id: 'select', name: '选择', icon: 'fa-arrow-pointer', color: 0x38bdf8, type: 'select' },
    { id: 'eraser', name: '擦除', icon: 'fa-eraser', color: 0xef4444, type: 'eraser' }
];

// 物品分类页签
const CATEGORIES = [
    { id: 'all', label: '全部' },
    { id: 'terrain', label: '基础地形' },
    { id: 'facility', label: '建筑设施' },
    { id: 'prop', label: '景观道具' },
    { id: 'vehicle', label: '载具' }
];

// 物品目录定义（cat: terrain 基础地形 / facility 建筑设施 / prop 景观道具 / vehicle 载具）
const CATALOG = [
    { id: 'road_straight', name: '直道', icon: 'fa-road', color: 0x64748b, type: 'road', shape: 'straight', cat: 'terrain' },
    { id: 'road_curve', name: '弯道', icon: 'fa-shuffle', color: 0x64748b, type: 'road', shape: 'curve', cat: 'terrain' },
    { id: 'road_cross', name: '十字路口', icon: 'fa-plus', color: 0x64748b, type: 'road', shape: 'cross', cat: 'terrain' },
    { id: 'cube', name: '现代方块', icon: 'fa-cube', color: 0x3b82f6, type: 'block', shape: 'box', cat: 'facility' },
    { id: 'pillar', name: '石柱', icon: 'fa-chess-rook', color: 0x94a3b8, type: 'block', shape: 'cylinder', cat: 'facility' },
    { id: 'traffic_light', name: '红绿灯', icon: 'fa-traffic-light', color: 0x22c55e, type: 'traffic_light', cat: 'facility' },
    { id: 'tree', name: '多边形树', icon: 'fa-tree', color: 0x22c55e, type: 'tree', cat: 'prop' },
    { id: 'light', name: '发光晶体', icon: 'fa-gem', color: 0xa855f7, type: 'light', cat: 'prop' },
    { id: 'chair', name: '休闲座椅', icon: 'fa-chair', color: 0xf59e0b, type: 'chair', cat: 'prop' },
    { id: 'car', name: '小汽车', icon: 'fa-car-side', color: 0xf97316, type: 'car', cat: 'vehicle' }
];

// 当前选中的分类页签 / 工具
let currentCategory = 'all';
let currentTool = CATALOG[3]; // 默认现代方块
