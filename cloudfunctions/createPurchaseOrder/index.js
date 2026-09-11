// 云函数 createPurchaseOrder - 创建采购申请 + 自动生成报表
// 修复：服务端鉴权与门店归属 + 补 delivery_date + 订单号防撞 + 明细批量写入
//      + 报表供应商批量查询 + CSV 加 UTF-8 BOM + 错误信息不外泄
const cloud = require('wx-server-sdk')
const { requireUser, STORE_ROLES } = require('./auth')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 辅助：用双引号包裹CSV字段，防止逗号问题
function csvField(val) {
  const s = String(val == null ? '' : val)
  return '"' + s.replace(/"/g, '""') + '"'
}

// 辅助：查询同类报表最高版本号
async function getNextVersion(reportType, scopeId, relatedDate) {
  try {
    const res = await db.collection('report_file')
      .where({ report_type: reportType, scope_id: scopeId, related_date: relatedDate })
      .orderBy('file_version', 'desc')
      .limit(1)
      .get()
    return res.data.length > 0 ? res.data[0].file_version + 1 : 1
  } catch (e) { return 1 }
}

// 辅助：东八区当天日期 YYYY-MM-DD
function todayCN() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

exports.main = async (event = {}) => {
  // 入口先鉴权：未登录直接返回
  const auth = await requireUser(event)
  if (auth.error) return auth.error
  const user = auth.user

  try {
    const {
      storeId: clientStoreId, orderDate: reqOrderDate, deliveryDate: reqDeliveryDate,
      items, remark, orderStatus = 'submitted'
    } = event

    if (!Array.isArray(items) || items.length === 0) {
      return { code: -1, msg: '门店和采购商品不能为空' }
    }
    if (!['draft', 'submitted'].includes(orderStatus)) {
      return { code: -1, msg: '采购单状态无效' }
    }

    // 校验手动商品数量
    const manualCount = items.filter(i => i.isManual).length
    if (manualCount > 5) {
      return { code: -1, msg: '手动商品每单最多5个' }
    }

    // 门店归属：门店角色（chef/店长）强制本店下单，忽略客户端 storeId；
    // 全局角色可用客户端 storeId
    const isStoreRole = STORE_ROLES.includes(user.role)
    let storeId
    if (isStoreRole) {
      if (!user.default_store_id) {
        return { code: -1, msg: '当前账号未绑定门店，无法下单' }
      }
      storeId = user.default_store_id
    } else {
      storeId = clientStoreId
    }
    if (!storeId) {
      return { code: -1, msg: '门店和采购商品不能为空' }
    }

    // 门店信息一律以 store 集合为准，不信任客户端；
    // 全局角色指定的门店必须存在且启用（status=1）
    let storeDoc = null
    try {
      const storeRes = await db.collection('store')
        .where({ store_id: storeId }).limit(1).get()
      storeDoc = storeRes.data[0] || null
    } catch (e) { storeDoc = null }
    if (!storeDoc || (!isStoreRole && storeDoc.status !== 1)) {
      return { code: -1, msg: '门店不存在或已停用' }
    }
    const storeName = storeDoc.store_name

    // 日期校验：格式 YYYY-MM-DD，下单日期缺省用东八区当天
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
    let orderDate = reqOrderDate
    if (!orderDate) {
      orderDate = todayCN()
    } else if (!DATE_RE.test(orderDate)) {
      return { code: -1, msg: '下单日期格式无效，应为 YYYY-MM-DD' }
    }
    const deliveryDate = reqDeliveryDate || orderDate
    if (!DATE_RE.test(deliveryDate)) {
      return { code: -1, msg: '到货日期格式无效，应为 YYYY-MM-DD' }
    }

    // 生成订单号：4位随机数字，查重防撞，最多重试3次
    const dateStr = orderDate.replace(/-/g, '')
    let orderNo = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = 'PO' + dateStr + String(Math.floor(Math.random() * 10000)).padStart(4, '0')
      const dupRes = await db.collection('purchase_order')
        .where({ purchase_order_id: candidate })
        .count()
      if (dupRes.total === 0) {
        orderNo = candidate
        break
      }
    }
    if (!orderNo) {
      return { code: -1, msg: '订单号生成失败，请稍后重试' }
    }

    // 写入采购主表（创建人以登录用户为准，不信任客户端）
    await db.collection('purchase_order').add({
      data: {
        purchase_order_id: orderNo, order_no: orderNo,
        store_id: storeId, store_name: storeName,
        order_date: orderDate, delivery_date: deliveryDate,
        created_by: user.user_id || user._id,
        created_by_name: user.name || '',
        order_status: orderStatus, remark: remark || '',
        created_at: db.serverDate(), updated_at: db.serverDate()
      }
    })

    // 批量写入明细表
    await db.collection('purchase_order_item').add({
      data: items.map((item, i) => ({
        item_id: orderNo + '_' + (i + 1),
        purchase_order_id: orderNo,
        product_id: item.productId,
        product_name_snapshot: item.productName,
        category_snapshot: item.category,
        unit_snapshot: item.unit,
        supplier_id: item.supplierId || '',
        order_qty: item.orderQty,
        is_manual: item.isManual || false,
        remark: item.remark || '',
        created_at: db.serverDate()
      }))
    })

    if (orderStatus === 'draft') {
      return { code: 0, data: { orderId: orderNo, reportGenerated: false, reportsGenerated: 0 } }
    }

    const reportsGenerated = []

    // ===== 报表1: 门店下单报表 =====
    const storeVer = await getNextVersion('store_order_report', storeId, orderDate)
    let csv1 = csvField('商品名称') + ',' + csvField('分类') + ',' + csvField('单位') + ',' + csvField('下单数量') + ',' + csvField('备注') + '\n'
    items.forEach(item => {
      csv1 += [csvField(item.productName), csvField(item.category), csvField(item.unit), csvField(item.orderQty), csvField(item.remark || '')].join(',') + '\n'
    })
    const f1 = `reports/store/${orderDate}/store-order-${storeName}-${orderDate}-v${storeVer}.csv`
    // CSV 加 UTF-8 BOM，避免 Windows Excel 打开乱码
    const u1 = await cloud.uploadFile({ cloudPath: f1, fileContent: Buffer.from('\ufeff' + csv1, 'utf-8') })
    await db.collection('report_file').add({
      data: {
        report_id: 'RPT_SO_' + orderNo, report_type: 'store_order_report',
        report_scope: 'store', scope_id: storeId, scope_name: storeName,
        related_date: orderDate, source_order_id: orderNo,
        file_name: f1, file_url: u1.fileID, file_version: storeVer,
        generated_at: db.serverDate(), generated_by_system: true, status: 'generated'
      }
    })
    reportsGenerated.push('store_order_report')

    // ===== 报表2: 供应商订货汇总（按供应商分组） =====
    const supplierMap = {}
    items.forEach(item => {
      const sid = item.supplierId || 'unknown'
      if (!supplierMap[sid]) supplierMap[sid] = { items: [], name: '' }
      supplierMap[sid].items.push(item)
    })

    // 批量查供应商名称（一次 _.in 查询，不再逐个查）
    const supplierIds = Object.keys(supplierMap).filter(sid => sid !== 'unknown')
    if (supplierIds.length > 0) {
      try {
        const supRes = await db.collection('supplier')
          .where({ supplier_id: _.in(supplierIds) })
          .get()
        supRes.data.forEach(sup => {
          if (supplierMap[sup.supplier_id]) {
            supplierMap[sup.supplier_id].name = sup.supplier_name
          }
        })
      } catch (e) {}
    }

    for (const sid of Object.keys(supplierMap)) {
      if (sid === 'unknown') continue // 手动商品无供应商
      const supItems = supplierMap[sid].items
      const supName = supplierMap[sid].name || sid
      const supVer = await getNextVersion('supplier_order_report', sid, orderDate)

      let csvSup = [csvField('门店'), csvField('商品名称'), csvField('订货数量'), csvField('单位'), csvField('备注')].join(',') + '\n'
      supItems.forEach(item => {
        csvSup += [csvField(storeName), csvField(item.productName), csvField(item.orderQty), csvField(item.unit), csvField(item.remark || '')].join(',') + '\n'
      })

      const fSup = `reports/supplier/${orderDate}/supplier-order-${supName}-${orderDate}-v${supVer}.csv`
      const uSup = await cloud.uploadFile({ cloudPath: fSup, fileContent: Buffer.from('\ufeff' + csvSup, 'utf-8') })
      await db.collection('report_file').add({
        data: {
          report_id: 'RPT_SUO_' + sid + '_' + orderNo, report_type: 'supplier_order_report',
          report_scope: 'supplier', scope_id: sid, scope_name: supName,
          related_date: orderDate, source_order_id: orderNo,
          file_name: fSup, file_url: uSup.fileID, file_version: supVer,
          generated_at: db.serverDate(), generated_by_system: true, status: 'generated'
        }
      })
    }
    reportsGenerated.push('supplier_order_report')

    return {
      code: 0,
      data: { orderId: orderNo, reportGenerated: true, reportsGenerated: reportsGenerated.length }
    }
  } catch (err) {
    console.error('[createPurchaseOrder] 创建采购单失败:', err)
    return { code: -1, msg: '提交失败，请稍后重试' }
  }
}
