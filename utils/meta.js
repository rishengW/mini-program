const statusMap = {
  draft: { text: '草稿', type: 'grey' },
  submitted: { text: '已提交', type: 'primary' },
  pending_approval: { text: '待审核', type: 'warning' },
  approved: { text: '已通过', type: 'success' },
  rejected: { text: '已驳回', type: 'danger' },
  report_generated: { text: '已生成报表', type: 'success' },
  received: { text: '已收货', type: 'success' },
  receipt_abnormal: { text: '收货异常', type: 'danger' },
  partial_received: { text: '部分收货', type: 'warning' },
  completed: { text: '已完成', type: 'success' },
  to_receive: { text: '待收货', type: 'warning' },
  confirmed: { text: '已确认', type: 'success' },
  pending: { text: '待处理', type: 'warning' },
  processing: { text: '处理中', type: 'primary' },
  resolved: { text: '已解决', type: 'success' },
  closed: { text: '已关闭', type: 'grey' },
  cancelled: { text: '已作废', type: 'grey' },
  generated: { text: '已生成', type: 'success' }
}

// 供货商对订单的确认状态（写在 purchase_order.supplier_confirmations 上）
const supplierConfirmMap = {
  pending: { text: '待确认', type: 'warning' },
  confirmed: { text: '已确认', type: 'success' },
  shipped: { text: '已发货', type: 'primary' },
  done: { text: '已收货', type: 'success' },
  cancelled: { text: '已作废', type: 'grey' }
}

// iconClass 对应 styles/icons.wxss 中生成的类名；emoji 图标已全面下线
const reportTypeMap = {
  store_order_report: { label: '门店下单报表', iconClass: 'icon-clipboard-primary', color: '#00873E' },
  store_receipt_report: { label: '门店收货报表', iconClass: 'icon-package-success', color: '#52C41A' },
  store_receipt_price_report: { label: '门店带价格收货报表', iconClass: 'icon-tag-warning', color: '#FAAD14' },
  supplier_order_report: { label: '供应商订货汇总', iconClass: 'icon-factory-purple', color: '#722ED1' },
  supplier_receipt_report: { label: '供应商到货汇总', iconClass: 'icon-truck-teal', color: '#13C2C2' },
  supplier_receipt_price_report: { label: '供应商带价格账单', iconClass: 'icon-chart-magenta', color: '#EB2F96' },
  store_daily_summary_report: { label: '门店日汇总', iconClass: 'icon-calendar-blue', color: '#5B8FF9' },
  store_monthly_summary_report: { label: '门店月汇总', iconClass: 'icon-calendar-days-mint', color: '#5AD8A6' }
}

function getStatusInfo(status) {
  return statusMap[status] || { text: status || '未知', type: 'grey' }
}

// 分类 emoji（存于数据库）→ styles/icons.wxss 图标基础名
// 页面按激活态拼接：icon-{base}-grey / icon-{base}-white；空串表示无图标
const categoryIconMap = {
  '🍳': 'chef', '🪑': 'armchair', '🥬': 'leaf', '🥩': 'drumstick',
  '🦐': 'fish', '🧂': 'shaker', '🍚': 'bowl', '🍺': 'beer',
  '🧊': 'snowflake', '🍽️': 'utensils', '🧹': 'brush', '📦': 'package'
}

function getCategoryIconBase(emoji) {
  return categoryIconMap[emoji] || ''
}

function getReportTypeInfo(type) {
  return reportTypeMap[type] || { label: type || '未知报表', iconClass: 'icon-file-grey', color: '#999999' }
}

function getSupplierConfirmInfo(status) {
  return supplierConfirmMap[status] || { text: status || '未知', type: 'grey' }
}

module.exports = { statusMap, reportTypeMap, supplierConfirmMap, getStatusInfo, getReportTypeInfo, getSupplierConfirmInfo, getCategoryIconBase }
