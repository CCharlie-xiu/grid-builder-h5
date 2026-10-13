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
    { id: 'building', label: '建筑' },
    { id: 'landmark', label: '地标' },
    { id: 'furniture', label: '家具' },
    { id: 'city', label: '城市配套' },
    { id: 'prop', label: '景观道具' },
    { id: 'vehicle', label: '载具' }
];

/**
 * 物品目录定义
 * cat: terrain 基础地形 / building 建筑 / landmark 地标 / furniture 家具 /
 *      city 城市配套 / prop 景观道具 / vehicle 载具
 * 建模实现见 items.js（基础物品）与 items-extra.js（扩展物品，按 id 注册到 ITEM_BUILDERS）
 */
const CATALOG = [
    // —— 基础地形 ——
    { id: 'road_straight', name: '直道', icon: 'fa-road', color: 0x64748b, type: 'road', shape: 'straight', cat: 'terrain' },
    { id: 'road_curve', name: '弯道', icon: 'fa-shuffle', color: 0x64748b, type: 'road', shape: 'curve', cat: 'terrain' },
    { id: 'road_cross', name: '十字路口', icon: 'fa-plus', color: 0x64748b, type: 'road', shape: 'cross', cat: 'terrain' },
    { id: 'lawn', name: '草坪', icon: 'fa-seedling', color: 0x4e9a5f, type: 'lawn', cat: 'terrain' },

    // —— 建筑 ——
    { id: 'house', name: '小房子', icon: 'fa-house', color: 0xe8e2d8, type: 'house', cat: 'building' },
    { id: 'townhouse', name: '联排屋', icon: 'fa-house-chimney', color: 0xd9b48c, type: 'townhouse', cat: 'building' },
    { id: 'apartment', name: '公寓楼', icon: 'fa-building', color: 0xc9d2dc, type: 'apartment', cat: 'building' },
    { id: 'villa', name: '别墅', icon: 'fa-hotel', color: 0xf0e6d2, type: 'villa', cat: 'building' },
    { id: 'shop', name: '便利店', icon: 'fa-store', color: 0x5eead4, type: 'shop', cat: 'building' },
    { id: 'mall', name: '商场', icon: 'fa-shop', color: 0x8fb8d8, type: 'mall', cat: 'building' },
    { id: 'office', name: '写字楼', icon: 'fa-city', color: 0x7fb2d8, type: 'office', cat: 'building' },
    { id: 'factory', name: '厂房', icon: 'fa-industry', color: 0x9aa7b4, type: 'factory', cat: 'building' },
    { id: 'cube', name: '现代方块', icon: 'fa-cube', color: 0x3b82f6, type: 'block', shape: 'box', cat: 'building' },
    { id: 'pillar', name: '石柱', icon: 'fa-chess-rook', color: 0x94a3b8, type: 'block', shape: 'cylinder', cat: 'building' },

    // —— 地标 ——
    { id: 'tower_tv', name: '电视塔', icon: 'fa-tower-broadcast', color: 0xb8c6d4, type: 'tower_tv', cat: 'landmark' },
    { id: 'tower_canton', name: '广州塔', icon: 'fa-tower-cell', color: 0xcfdce6, type: 'tower_canton', cat: 'landmark' },
    { id: 'stadium', name: '体育馆', icon: 'fa-futbol', color: 0xbfcbd6, type: 'stadium', cat: 'landmark' },
    { id: 'ferris', name: '摩天轮', icon: 'fa-circle-notch', color: 0xe0b24a, type: 'ferris', cat: 'landmark' },
    { id: 'arch', name: '拱门', icon: 'fa-archway', color: 0xd6cbb8, type: 'arch', cat: 'landmark' },
    { id: 'pyramid', name: '金字塔', icon: 'fa-mountain', color: 0xd9c08a, type: 'pyramid', cat: 'landmark' },
    { id: 'clock_tower', name: '钟楼', icon: 'fa-clock', color: 0xc9b79a, type: 'clock_tower', cat: 'landmark' },
    { id: 'lighthouse', name: '灯塔', icon: 'fa-monument', color: 0xf2f5f8, type: 'lighthouse', cat: 'landmark' },

    // —— 家具 ——
    { id: 'table', name: '桌子', icon: 'fa-table', color: 0x9a6b3f, type: 'table', cat: 'furniture' },
    { id: 'chair_office', name: '办公椅', icon: 'fa-chair', color: 0x4b5563, type: 'chair_office', cat: 'furniture' },
    { id: 'desk_lamp', name: '台灯', icon: 'fa-lightbulb', color: 0xfac775, type: 'desk_lamp', cat: 'furniture' },
    { id: 'floor_lamp', name: '落地灯', icon: 'fa-lamp-desk', color: 0xf5d78e, type: 'floor_lamp', cat: 'furniture' },
    { id: 'sofa', name: '沙发', icon: 'fa-couch', color: 0x6d7f95, type: 'sofa', cat: 'furniture' },
    { id: 'bookshelf', name: '书架', icon: 'fa-book', color: 0x8a5a34, type: 'bookshelf', cat: 'furniture' },
    { id: 'bed', name: '床', icon: 'fa-bed', color: 0xd9e2ec, type: 'bed', cat: 'furniture' },
    { id: 'plant_pot', name: '盆栽', icon: 'fa-seedling', color: 0x4e9a5f, type: 'plant_pot', cat: 'furniture' },
    { id: 'chair', name: '休闲座椅', icon: 'fa-chair', color: 0xf59e0b, type: 'chair', cat: 'furniture' },

    // —— 城市配套 ——
    { id: 'traffic_light', name: '红绿灯', icon: 'fa-traffic-light', color: 0x22c55e, type: 'traffic_light', cat: 'city' },
    { id: 'street_lamp', name: '路灯', icon: 'fa-lightbulb', color: 0xfde68a, type: 'street_lamp', cat: 'city' },
    { id: 'bench', name: '长椅', icon: 'fa-chair', color: 0xb07a4a, type: 'bench', cat: 'city' },
    { id: 'trash_bin', name: '垃圾桶', icon: 'fa-trash', color: 0x4b5563, type: 'trash_bin', cat: 'city' },
    { id: 'bus_stop', name: '公交站台', icon: 'fa-bus', color: 0x8fc4e8, type: 'bus_stop', cat: 'city' },
    { id: 'billboard', name: '广告牌', icon: 'fa-rectangle-ad', color: 0x38bdf8, type: 'billboard', cat: 'city' },
    { id: 'fence', name: '围栏', icon: 'fa-bars', color: 0xb9c2cc, type: 'fence', cat: 'city' },
    { id: 'fountain', name: '喷泉', icon: 'fa-water', color: 0x7dd3fc, type: 'fountain', cat: 'city' },
    { id: 'flowerbed', name: '花坛', icon: 'fa-spa', color: 0xef93b1, type: 'flowerbed', cat: 'city' },
    { id: 'mower', name: '割草机', icon: 'fa-tractor', color: 0xd9534f, type: 'mower', cat: 'city' },

    // —— 景观道具 ——
    { id: 'tree', name: '多边形树', icon: 'fa-tree', color: 0x22c55e, type: 'tree', cat: 'prop' },
    { id: 'light', name: '发光晶体', icon: 'fa-gem', color: 0xa855f7, type: 'light', cat: 'prop' },
    { id: 'person', name: '人物', icon: 'fa-person', color: 0x4e7bb8, type: 'person', cat: 'prop' },

    // —— 载具 ——
    { id: 'car', name: '小汽车', icon: 'fa-car-side', color: 0xf97316, type: 'car', cat: 'vehicle' },
    { id: 'bus', name: '公交车', icon: 'fa-bus', color: 0xf0b429, type: 'bus', cat: 'vehicle' }
];

// 当前选中的分类页签 / 工具
let currentCategory = 'all';
let currentTool = CATALOG[3]; // 默认小房子
