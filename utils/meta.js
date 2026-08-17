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
  return statusMap[status] || { text: status || '未知', type: 'grey' }
}

function getReportTypeInfo(type) {
  return reportTypeMap[type] || { label: type || '未知报表', icon: '📄', color: '#999999' }
}

module.exports = { statusMap, reportTypeMap, getStatusInfo, getReportTypeInfo }
