/**
 * CloudBase 调用与数据字段归一化。
 * 页面业务数据只允许来自云函数，不做 Mock 成功降级。
 */

function getCloudFailureResult(name, err) {
  const detail = `${err && err.errCode || ''} ${err && (err.errMsg || err.message) || ''}`
  const functionMissing = /-501000|FUNCTION_NOT_FOUND|FunctionName.*not.*found|函数.*不存在|云函数.*不存在/i.test(detail)
  if (functionMissing) {
    return {
      code: -1,
      errorType: 'FUNCTION_NOT_DEPLOYED',
      msg: `云函数 ${name} 尚未部署`
    }
  }
  return { code: -1, errorType: 'CLOUD_UNAVAILABLE', msg: 'CloudBase 服务连接失败，请稍后重试' }
}

async function callFunction(name, data = {}) {
  if (!wx.cloud) {
    return { code: -1, errorType: 'CLOUD_UNAVAILABLE', msg: '当前环境不支持 CloudBase' }
  }
  try {
    const res = await wx.cloud.callFunction({ name, data })
    return res.result || { code: -1, msg: '云函数未返回有效结果' }
  } catch (err) {
    console.error(`[cloud] 云函数 ${name} 调用失败:`, err)
    return getCloudFailureResult(name, err)
  }
}

function formatDateTime(value) {
  if (!value || typeof value === 'string') return value || ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function normalizePurchaseItem(item = {}) {
  return {
    ...item,
    itemId: item.itemId || item.item_id || '',
    productId: item.productId || item.product_id || '',
    productNameSnapshot: item.productNameSnapshot || item.product_name_snapshot || item.productName || '',
    categorySnapshot: item.categorySnapshot || item.category_snapshot || '',
    unitSnapshot: item.unitSnapshot || item.unit_snapshot || item.unit || '',
    supplierId: item.supplierId !== undefined ? item.supplierId : (item.supplier_id || ''),
    orderQty: item.orderQty !== undefined ? item.orderQty : item.order_qty,
    isManual: item.isManual !== undefined ? item.isManual : !!item.is_manual,
    remark: item.remark || ''
  }
}

function normalizePurchaseOrder(order = {}) {
  const orderDate = order.orderDate || order.order_date || ''
  return {
    ...order,
    purchaseOrderId: order.purchaseOrderId || order.purchase_order_id || '',
    orderNo: order.orderNo || order.order_no || '',
    storeId: order.storeId || order.store_id || '',
    storeName: order.storeName || order.store_name || '',
    orderDate,
    deliveryDate: order.deliveryDate || orderDate,
    createdById: order.createdById || order.created_by_id || order.created_by || '',
    createdBy: order.createdByName || order.created_by_name || order.createdBy || order.created_by || '',
    orderStatus: order.orderStatus || order.order_status || '',
    createdAt: formatDateTime(order.createdAt || order.created_at),
    remark: order.remark || '',
    auditRemark: order.auditRemark || order.audit_remark || '',
    items: (order.items || []).map(normalizePurchaseItem)
  }
}

function normalizeProduct(product = {}) {
  return {
    ...product,
    productId: product.productId || product.product_id || '',
    name: product.name || product.product_name || '',
    categoryL1: product.categoryL1 || product.category_level_1 || '',
    categoryId: product.categoryId !== undefined ? product.categoryId : product.category_level_2_id,
    categoryName: product.categoryName || product.category_name || '',
    unit: product.unit || '',
    spec: product.spec || '',
    defaultSupplierId: product.defaultSupplierId || product.default_supplier_id || '',
    manufacturerName: product.manufacturerName || product.manufacturer_name || '默认',
    status: product.status === undefined ? 1 : product.status
  }
}

function normalizeSupplier(supplier = {}) {
  return {
    ...supplier,
    supplierId: supplier.supplierId || supplier.supplier_id || '',
    supplierName: supplier.supplierName || supplier.supplier_name || '',
    contactName: supplier.contactName || supplier.contact_name || '',
    contactPhone: supplier.contactPhone || supplier.contact_phone || '',
    address: supplier.address || '',
    remark: supplier.remark || '',
    productCount: supplier.productCount !== undefined ? supplier.productCount : (supplier.product_count || 0),
    status: supplier.status === undefined ? 1 : supplier.status
  }
}

function normalizePrice(price = {}) {
  return {
    ...price,
    priceId: price.priceId || price.price_id || '',
    supplierId: price.supplierId || price.supplier_id || '',
    productId: price.productId || price.product_id || '',
    effectiveDate: price.effectiveDate || price.effective_date || '',
    isCurrent: price.isCurrent !== undefined ? price.isCurrent : price.is_current
  }
}

function normalizeReport(report = {}) {
  return {
    ...report,
    reportId: report.reportId || report.report_id || '',
    reportType: report.reportType || report.report_type || '',
    reportScope: report.reportScope || report.report_scope || '',
    scopeId: report.scopeId || report.scope_id || '',
    scopeName: report.scopeName || report.scope_name || '',
    relatedDate: report.relatedDate || report.related_date || '',
    generatedAt: formatDateTime(report.generatedAt || report.generated_at),
    fileVersion: report.fileVersion || report.file_version || 1,
    fileUrl: report.fileUrl || report.file_url || ''
  }
}

async function uploadReceiptPhotos(localPaths = [], purchaseOrderId = 'receipt') {
  if (!Array.isArray(localPaths) || localPaths.length === 0) return []
  if (!wx.cloud) throw new Error('CloudBase unavailable')

  const safeOrderId = String(purchaseOrderId).replace(/[^a-zA-Z0-9_-]/g, '') || 'receipt'
  const timestamp = Date.now()
  return Promise.all(localPaths.map((filePath, index) => {
    const match = String(filePath).match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/)
    const extension = match ? match[1].toLowerCase() : 'jpg'
    return wx.cloud.uploadFile({
      cloudPath: `receipts/${safeOrderId}/${timestamp}-${index}.${extension}`,
      filePath
    }).then(res => res.fileID)
  }))
}

async function getFileUrl(fileID) {
  if (!wx.cloud || !fileID) return null
  try {
    const res = await wx.cloud.getTempFileURL({ fileList: [fileID] })
    return res.fileList[0].tempFileURL
  } catch (err) {
    console.warn('[cloud] 获取文件链接失败:', err)
    return null
  }
}

module.exports = {
  callFunction,
  formatDateTime,
  normalizePurchaseOrder,
  normalizePurchaseItem,
  normalizeProduct,
  normalizeSupplier,
  normalizePrice,
  normalizeReport,
  uploadReceiptPhotos,
  getFileUrl
}
