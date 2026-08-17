/**
 * mock.js - 模拟数据模块 (V2)
 * 增加：前厅分类、手动商品支持、报表数据、采购订单新结构
 */

// ============ 门店 ============
const stores = [
  { storeId: 'S001', storeName: '中关村旗舰店', storeCode: 'S001', status: 1 },
  { storeId: 'S002', storeName: '望京分店', storeCode: 'S002', status: 1 },
  { storeId: 'S003', storeName: '国贸分店', storeCode: 'S003', status: 1 }
]

// ============ 用户 ============
const users = [
  { id: 0, defaultStoreId: null, username: 'admin', password: 'Admin@2026', name: '超级管理员', mobile: '13900000000', role: 'super_admin', roleLabel: '超级管理员' },
  { id: 1, defaultStoreId: 'S001', username: 'chef', password: 'Chef@2026', name: '王大厨', mobile: '13900001111', role: 'chef', roleLabel: '门店下单人员' },
  { id: 2, defaultStoreId: 'S001', username: 'manager', password: 'Manager@2026', name: '陈店长', mobile: '13900002222', role: 'store_manager', roleLabel: '店长' },
  { id: 3, defaultStoreId: null, username: 'admin_user', password: 'Purchaser@2026', name: '赵采购', mobile: '13900003333', role: 'purchaser', roleLabel: '管理员' }
]

// ============ 供应商 ============
const suppliers = [
  { supplierId: 'SUP001', supplierName: '绿源蔬菜批发', contactName: '刘老板', contactPhone: '13800010001', status: 1 },
  { supplierId: 'SUP002', supplierName: '鑫发肉业', contactName: '孙经理', contactPhone: '13800010002', status: 1 },
  { supplierId: 'SUP003', supplierName: '海洋水产', contactName: '周老板', contactPhone: '13800010003', status: 1 },
  { supplierId: 'SUP004', supplierName: '百味调料行', contactName: '吴经理', contactPhone: '13800010004', status: 1 },
  { supplierId: 'SUP005', supplierName: '日用百货供应', contactName: '马经理', contactPhone: '13800010005', status: 1 }
]

// ============ 一级分类（后厨 / 前厅） ============
const categoryL1List = [
  { id: 'kitchen', name: '后厨', icon: '🍳' },
  { id: 'front', name: '前厅', icon: '🪑' }
]

// ============ 二级分类 ============
const categories = [
  // 后厨
  { id: 1, categoryL1: 'kitchen', name: '蔬菜', sortNo: 1, icon: '🥬' },
  { id: 2, categoryL1: 'kitchen', name: '肉类', sortNo: 2, icon: '🥩' },
  { id: 3, categoryL1: 'kitchen', name: '海鲜水产', sortNo: 3, icon: '🦐' },
  { id: 4, categoryL1: 'kitchen', name: '调料干货', sortNo: 4, icon: '🧂' },
  { id: 5, categoryL1: 'kitchen', name: '粮油', sortNo: 5, icon: '🍚' },
  { id: 6, categoryL1: 'kitchen', name: '酒水饮料', sortNo: 6, icon: '🍺' },
  { id: 7, categoryL1: 'kitchen', name: '冻品', sortNo: 7, icon: '🧊' },
  { id: 8, categoryL1: 'kitchen', name: '豆制品', sortNo: 8, icon: '🫘' },
  // 前厅
  { id: 9, categoryL1: 'front', name: '纸品', sortNo: 1, icon: '🧻' },
  { id: 10, categoryL1: 'front', name: '餐具', sortNo: 2, icon: '🍽️' },
  { id: 11, categoryL1: 'front', name: '清洁用品', sortNo: 3, icon: '🧹' },
  { id: 12, categoryL1: 'front', name: '包装材料', sortNo: 4, icon: '📦' }
]

// ============ 商品 ============
const products = [
  // 后厨-蔬菜（散装无品牌 → 默认）
  { productId: 'P001', name: '大白菜', categoryL1: 'kitchen', categoryId: 1, unit: '棵', spec: '约2-3斤/棵', defaultSupplierId: 'SUP001', manufacturerName: '默认', status: 1 },
  { productId: 'P002', name: '西兰花', categoryL1: 'kitchen', categoryId: 1, unit: '个', spec: '约1斤/个', defaultSupplierId: 'SUP001', manufacturerName: '默认', status: 1 },
  { productId: 'P003', name: '土豆', categoryL1: 'kitchen', categoryId: 1, unit: '斤', spec: '约半斤/个', defaultSupplierId: 'SUP001', manufacturerName: '默认', status: 1 },
  { productId: 'P004', name: '胡萝卜', categoryL1: 'kitchen', categoryId: 1, unit: '斤', spec: '普通', defaultSupplierId: 'SUP001', manufacturerName: '默认', status: 1 },
  { productId: 'P005', name: '生菜', categoryL1: 'kitchen', categoryId: 1, unit: '斤', spec: '散装', defaultSupplierId: 'SUP001', manufacturerName: '默认', status: 1 },
  // 后厨-肉类（鲜肉无品牌 → 默认）
  { productId: 'P006', name: '五花肉', categoryL1: 'kitchen', categoryId: 2, unit: '斤', spec: '冷鲜', defaultSupplierId: 'SUP002', manufacturerName: '默认', status: 1 },
  { productId: 'P007', name: '里脊肉', categoryL1: 'kitchen', categoryId: 2, unit: '斤', spec: '冷鲜', defaultSupplierId: 'SUP002', manufacturerName: '默认', status: 1 },
  { productId: 'P008', name: '鸡胸肉', categoryL1: 'kitchen', categoryId: 2, unit: '斤', spec: '冷冻', defaultSupplierId: 'SUP002', manufacturerName: '默认', status: 1 },
  { productId: 'P009', name: '排骨', categoryL1: 'kitchen', categoryId: 2, unit: '斤', spec: '肋排', defaultSupplierId: 'SUP002', manufacturerName: '默认', status: 1 },
  // 后厨-海鲜水产（鲜活无品牌 → 默认）
  { productId: 'P010', name: '基围虾', categoryL1: 'kitchen', categoryId: 3, unit: '斤', spec: '鲜活', defaultSupplierId: 'SUP003', manufacturerName: '默认', status: 1 },
  { productId: 'P011', name: '鲈鱼', categoryL1: 'kitchen', categoryId: 3, unit: '条', spec: '约1-1.5斤/条', defaultSupplierId: 'SUP003', manufacturerName: '默认', status: 1 },
  { productId: 'P012', name: '花蛤', categoryL1: 'kitchen', categoryId: 3, unit: '斤', spec: '鲜活', defaultSupplierId: 'SUP003', manufacturerName: '默认', status: 1 },
  // 后厨-调料干货（有品牌）
  { productId: 'P013', name: '生抽', categoryL1: 'kitchen', categoryId: 4, unit: '瓶', spec: '1.9L/瓶', defaultSupplierId: 'SUP004', manufacturerName: '海天', status: 1 },
  { productId: 'P014', name: '老抽', categoryL1: 'kitchen', categoryId: 4, unit: '瓶', spec: '500ml/瓶', defaultSupplierId: 'SUP004', manufacturerName: '海天', status: 1 },
  { productId: 'P015', name: '蚝油', categoryL1: 'kitchen', categoryId: 4, unit: '瓶', spec: '510g/瓶', defaultSupplierId: 'SUP004', manufacturerName: '李锦记', status: 1 },
  // 后厨-粮油（有品牌）
  { productId: 'P016', name: '大米', categoryL1: 'kitchen', categoryId: 5, unit: '袋', spec: '10kg/袋', defaultSupplierId: 'SUP004', manufacturerName: '默认', status: 1 },
  { productId: 'P017', name: '食用油', categoryL1: 'kitchen', categoryId: 5, unit: '桶', spec: '5L/桶', defaultSupplierId: 'SUP004', manufacturerName: '金龙鱼', status: 1 },
  // 后厨-酒水（有品牌）
  { productId: 'P018', name: '青岛啤酒', categoryL1: 'kitchen', categoryId: 6, unit: '箱', spec: '500ml*12', defaultSupplierId: 'SUP004', manufacturerName: '青岛', status: 1 },
  // 后厨-冻品（有品牌）
  { productId: 'P019', name: '速冻水饺', categoryL1: 'kitchen', categoryId: 7, unit: '袋', spec: '500g/袋', defaultSupplierId: 'SUP002', manufacturerName: '安井', status: 1 },
  // 后厨-豆制品（无品牌 → 默认）
  { productId: 'P020', name: '老豆腐', categoryL1: 'kitchen', categoryId: 8, unit: '块', spec: '约500g/块', defaultSupplierId: 'SUP001', manufacturerName: '默认', status: 1 },
  // 前厅-纸品
  { productId: 'P021', name: '餐巾纸', categoryL1: 'front', categoryId: 9, unit: '箱', spec: '200抽*30包', defaultSupplierId: 'SUP005', manufacturerName: '默认', status: 1 },
  { productId: 'P022', name: '卷纸', categoryL1: 'front', categoryId: 9, unit: '提', spec: '12卷/提', defaultSupplierId: 'SUP005', manufacturerName: '默认', status: 1 },
  // 前厅-餐具
  { productId: 'P023', name: '一次性筷子', categoryL1: 'front', categoryId: 10, unit: '包', spec: '100双/包', defaultSupplierId: 'SUP005', manufacturerName: '默认', status: 1 },
  { productId: 'P024', name: '打包盒', categoryL1: 'front', categoryId: 10, unit: '箱', spec: '500ml*300个', defaultSupplierId: 'SUP005', manufacturerName: '默认', status: 1 },
  // 前厅-清洁
  { productId: 'P025', name: '洗洁精', categoryL1: 'front', categoryId: 11, unit: '瓶', spec: '2L/瓶', defaultSupplierId: 'SUP005', manufacturerName: '默认', status: 1 },
  { productId: 'P026', name: '垃圾袋', categoryL1: 'front', categoryId: 11, unit: '卷', spec: '大号50个/卷', defaultSupplierId: 'SUP005', manufacturerName: '默认', status: 1 },
  // 前厅-包装
  { productId: 'P027', name: '外卖袋', categoryL1: 'front', categoryId: 12, unit: '捆', spec: '中号100个', defaultSupplierId: 'SUP005', manufacturerName: '默认', status: 1 }
]

// ============ 供应商商品价格 ============
const supplierProductPrices = [
  { priceId: 'PRC001', supplierId: 'SUP001', productId: 'P001', price: 3.5, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC002', supplierId: 'SUP001', productId: 'P002', price: 6.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC003', supplierId: 'SUP001', productId: 'P003', price: 2.5, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC004', supplierId: 'SUP001', productId: 'P004', price: 3.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC005', supplierId: 'SUP001', productId: 'P005', price: 4.5, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC006', supplierId: 'SUP002', productId: 'P006', price: 18.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC007', supplierId: 'SUP002', productId: 'P007', price: 22.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC008', supplierId: 'SUP002', productId: 'P008', price: 12.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC009', supplierId: 'SUP002', productId: 'P009', price: 28.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC010', supplierId: 'SUP003', productId: 'P010', price: 45.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC011', supplierId: 'SUP003', productId: 'P011', price: 25.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC012', supplierId: 'SUP003', productId: 'P012', price: 8.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC013', supplierId: 'SUP004', productId: 'P013', price: 15.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC014', supplierId: 'SUP004', productId: 'P014', price: 8.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC015', supplierId: 'SUP004', productId: 'P015', price: 12.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC016', supplierId: 'SUP004', productId: 'P016', price: 65.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC017', supplierId: 'SUP004', productId: 'P017', price: 58.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC018', supplierId: 'SUP004', productId: 'P018', price: 48.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC019', supplierId: 'SUP002', productId: 'P019', price: 15.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC020', supplierId: 'SUP001', productId: 'P020', price: 3.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  // 前厅
  { priceId: 'PRC021', supplierId: 'SUP005', productId: 'P021', price: 45.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC022', supplierId: 'SUP005', productId: 'P022', price: 18.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC023', supplierId: 'SUP005', productId: 'P023', price: 8.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC024', supplierId: 'SUP005', productId: 'P024', price: 120.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC025', supplierId: 'SUP005', productId: 'P025', price: 12.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC026', supplierId: 'SUP005', productId: 'P026', price: 5.0, effectiveDate: '2026-03-01', isCurrent: 1 },
  { priceId: 'PRC027', supplierId: 'SUP005', productId: 'P027', price: 15.0, effectiveDate: '2026-03-01', isCurrent: 1 }
]

// ============ 采购申请（新结构） ============
const purchaseOrders = [
  {
    purchaseOrderId: 'PO20260317001',
    orderNo: 'PO20260317001',
    storeId: 'S001',
    storeName: '中关村旗舰店',
    orderDate: '2026-03-17',
    createdBy: '王大厨',
    orderStatus: 'submitted',
    createdAt: '2026-03-17 08:30:00',
    items: [
      { itemId: 'ITM001', productId: 'P001', productNameSnapshot: '大白菜', categorySnapshot: '后厨-蔬菜', unitSnapshot: '棵', supplierId: 'SUP001', orderQty: 20, isManual: false },
      { itemId: 'ITM002', productId: 'P006', productNameSnapshot: '五花肉', categorySnapshot: '后厨-肉类', unitSnapshot: '斤', supplierId: 'SUP002', orderQty: 15, isManual: false },
      { itemId: 'ITM003', productId: 'P010', productNameSnapshot: '基围虾', categorySnapshot: '后厨-海鲜水产', unitSnapshot: '斤', supplierId: 'SUP003', orderQty: 8, isManual: false },
      { itemId: 'ITM004', productId: 'P021', productNameSnapshot: '餐巾纸', categorySnapshot: '前厅-纸品', unitSnapshot: '箱', supplierId: 'SUP005', orderQty: 2, isManual: false },
      { itemId: 'ITM005', productId: 'MANUAL_001', productNameSnapshot: '特供黑猪肉', categorySnapshot: '后厨', unitSnapshot: '斤', supplierId: null, orderQty: 5, isManual: true, remark: '王老板推荐的供应商' }
    ]
  },
  {
    purchaseOrderId: 'PO20260316001',
    orderNo: 'PO20260316001',
    storeId: 'S001',
    storeName: '中关村旗舰店',
    orderDate: '2026-03-16',
    createdBy: '王大厨',
    orderStatus: 'received',
    createdAt: '2026-03-16 09:00:00',
    items: [
      { itemId: 'ITM010', productId: 'P003', productNameSnapshot: '土豆', categorySnapshot: '后厨-蔬菜', unitSnapshot: '斤', supplierId: 'SUP001', orderQty: 30, isManual: false },
      { itemId: 'ITM011', productId: 'P007', productNameSnapshot: '里脊肉', categorySnapshot: '后厨-肉类', unitSnapshot: '斤', supplierId: 'SUP002', orderQty: 10, isManual: false },
      { itemId: 'ITM012', productId: 'P023', productNameSnapshot: '一次性筷子', categorySnapshot: '前厅-餐具', unitSnapshot: '包', supplierId: 'SUP005', orderQty: 3, isManual: false }
    ]
  }
]

// ============ 收货记录 ============
const receipts = [
  {
    receiptId: 'RCP20260316001',
    purchaseOrderId: 'PO20260316001',
    storeId: 'S001',
    storeName: '中关村旗舰店',
    receiptDate: '2026-03-16',
    receivedBy: '陈店长',
    receiptStatus: 'completed',
    createdAt: '2026-03-16 14:00:00',
    items: [
      { receiptItemId: 'RI001', productId: 'P003', productName: '土豆', receivedQty: 28, orderQtySnapshot: 30, unitSnapshot: '斤', priceSnapshot: 2.5, payableFlag: true, remark: '少了2斤' },
      { receiptItemId: 'RI002', productId: 'P007', productName: '里脊肉', receivedQty: 10, orderQtySnapshot: 10, unitSnapshot: '斤', priceSnapshot: 22.0, payableFlag: true },
      { receiptItemId: 'RI003', productId: 'P023', productName: '一次性筷子', receivedQty: 3, orderQtySnapshot: 3, unitSnapshot: '包', priceSnapshot: 8.0, payableFlag: true }
    ]
  }
]

// ============ 报表文件 ============
const reportFiles = [
  {
    reportId: 'RPT001', reportType: 'store_order_report', reportTypeName: '门店下单报表',
    reportScope: 'store', scopeId: 'S001', scopeName: '中关村旗舰店',
    relatedDate: '2026-03-17', sourceOrderId: 'PO20260317001',
    fileVersion: 1, generatedAt: '2026-03-17 08:31:00', status: 'generated'
  },
  {
    reportId: 'RPT002', reportType: 'store_order_report', reportTypeName: '门店下单报表',
    reportScope: 'store', scopeId: 'S001', scopeName: '中关村旗舰店',
    relatedDate: '2026-03-16', sourceOrderId: 'PO20260316001',
    fileVersion: 1, generatedAt: '2026-03-16 09:01:00', status: 'generated'
  },
  {
    reportId: 'RPT003', reportType: 'store_receipt_report', reportTypeName: '门店收货报表',
    reportScope: 'store', scopeId: 'S001', scopeName: '中关村旗舰店',
    relatedDate: '2026-03-16', sourceOrderId: 'PO20260316001',
    fileVersion: 1, generatedAt: '2026-03-16 14:01:00', status: 'generated'
  },
  {
    reportId: 'RPT004', reportType: 'store_receipt_price_report', reportTypeName: '门店带价格收货报表',
    reportScope: 'store', scopeId: 'S001', scopeName: '中关村旗舰店',
    relatedDate: '2026-03-16',
    fileVersion: 1, generatedAt: '2026-03-16 14:01:00', status: 'generated'
  },
  {
    reportId: 'RPT005', reportType: 'supplier_order_report', reportTypeName: '供应商订货汇总',
    reportScope: 'supplier', scopeId: 'SUP001', scopeName: '绿源蔬菜批发',
    relatedDate: '2026-03-17',
    fileVersion: 1, generatedAt: '2026-03-17 08:32:00', status: 'generated'
  },
  {
    reportId: 'RPT006', reportType: 'supplier_receipt_price_report', reportTypeName: '供应商带价格账单',
    reportScope: 'supplier', scopeId: 'SUP001', scopeName: '绿源蔬菜批发',
    relatedDate: '2026-03-16',
    fileVersion: 1, generatedAt: '2026-03-16 14:02:00', status: 'generated'
  }
]

// ============ 消息 ============
const messages = [
  { id: 1, type: 'report', title: '下单报表已生成', content: '3月17日中关村旗舰店下单报表已自动生成', time: '2026-03-17 08:31:00', read: false, bizId: 'RPT001' },
  { id: 2, type: 'report', title: '收货报表已生成', content: '3月16日收货报表（含价格版）已自动生成', time: '2026-03-16 14:01:00', read: true, bizId: 'RPT003' },
  { id: 3, type: 'order', title: '采购申请已提交', content: '3月17日门店采购申请已成功提交', time: '2026-03-17 08:30:00', read: false, bizId: 'PO20260317001' },
  { id: 4, type: 'receive', title: '收货完成', content: '3月16日采购订单已完成收货验收', time: '2026-03-16 14:00:00', read: true, bizId: 'RCP20260316001' },
  { id: 5, type: 'report', title: '供应商汇总已生成', content: '绿源蔬菜批发3月17日订货汇总报表已生成', time: '2026-03-17 08:32:00', read: false, bizId: 'RPT005' }
]

// ============ 状态映射 ============
const statusMap = {
  draft: { text: '草稿', type: 'grey' },
  submitted: { text: '已提交', type: 'primary' },
  pending_approval: { text: '待审核', type: 'warning' },
  approved: { text: '已通过', type: 'success' },
  rejected: { text: '已驳回', type: 'danger' },
  report_generated: { text: '已生成报表', type: 'success' },
  received: { text: '已收货', type: 'success' },
  partial_received: { text: '部分收货', type: 'warning' },
  completed: { text: '已完成', type: 'success' },
  to_receive: { text: '待收货', type: 'warning' },
  confirmed: { text: '已确认', type: 'success' },
  pending: { text: '待处理', type: 'warning' },
  processing: { text: '处理中', type: 'primary' },
  resolved: { text: '已解决', type: 'success' },
  closed: { text: '已关闭', type: 'grey' },
  generated: { text: '已生成', type: 'success' }
}

const reportTypeMap = {
  store_order_report: { label: '门店下单报表', icon: '📋', color: '#1890FF' },
  store_receipt_report: { label: '门店收货报表', icon: '📦', color: '#52C41A' },
  store_receipt_price_report: { label: '门店带价格收货报表', icon: '💰', color: '#FAAD14' },
  supplier_order_report: { label: '供应商订货汇总', icon: '🏭', color: '#722ED1' },
  supplier_receipt_report: { label: '供应商到货汇总', icon: '🚛', color: '#13C2C2' },
  supplier_receipt_price_report: { label: '供应商带价格账单', icon: '📊', color: '#EB2F96' }
}

function getStatusInfo(status) {
  return statusMap[status] || { text: status, type: 'grey' }
}

function getReportTypeInfo(type) {
  return reportTypeMap[type] || { label: type, icon: '📄', color: '#999' }
}

// ============ 导出 ============
module.exports = {
  stores,
  users,
  suppliers,
  categoryL1List,
  categories,
  products,
  supplierProductPrices,
  purchaseOrders,
  receipts,
  reportFiles,
  messages,
  statusMap,
  reportTypeMap,
  getStatusInfo,
  getReportTypeInfo
}
