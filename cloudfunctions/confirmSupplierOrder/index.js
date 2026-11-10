// 云函数 confirmSupplierOrder - 供货商确认接单 / 标记发货
// 确认记录写在订单的 supplier_confirmations[supplier_id] 上，
// 一张订单可含多个供货商，各自独立确认，互不影响主状态流转。
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 动作级状态白名单（S1 拍板）：确认接单/标记发货都必须在内部审核通过之后——
// 审核可能改量（approveQty）或驳回，审核前供货商看到/确认的数量都可能是作废数字。
// S8 追加：partial_received（部分收货中）也允许补标发货，剩余批次未到前供货商可维持发货标记。
// 2026-11-04 死锁修复：confirm 同样放开 partial_received（与 ship 同理）——多单场景 A 已收货
// （订单滑入部分收货）而 B 始终不确认时，B 的行被收货门禁锁死、B 补确认与管理员代确认
// 又被本白名单拒、订单亦不可作废，四条路全断（业务模糊清单 S10）。确认接单不代表货物
// 离库，部分收货中补确认无副作用。
const CONFIRMABLE_ORDER_STATUS = ['approved', 'report_generated', 'to_receive', 'partial_received']
const SHIPPABLE_ORDER_STATUS = ['approved', 'report_generated', 'to_receive', 'partial_received']
const ACTION_STATUS = { confirm: 'confirmed', ship: 'shipped' }

const _ = db.command

// （hashToken 本地副本已删除——见下方 shared/session require）

// 会话校验收敛到跨函数共享模块（2026-11-05 解耦第 3 项；源头 scripts/cloud-shared/session.js，
// 由 scripts/sync-shared.js 同步副本，勿再恢复本地副本——F1 就是 19 份副本各自漂移的教训）
const { hashToken, getSessionUser } = require('./shared/session')

exports.main = async (event = {}) => {
  try {
    const user = await getSessionUser(event.authToken)
    if (!user) return { code: -401, msg: '登录已过期，请重新登录' }
    // 2026-11-04 拍板：确认接单是收货硬前置。供应商不会用系统时，
    // 管理员（超管/采购主管）可代确认；proxy 留痕，定界时缺口仍落在供应商节点
    const isSupplier = user.role === 'supplier'
    const isAdminProxy = ['super_admin', 'purchaser'].includes(user.role)
    if (!isSupplier && !isAdminProxy) return { code: -403, msg: '当前账号无权操作采购订单' }

    const { orderId, action } = event || {}
    const status = ACTION_STATUS[action]
    if (!orderId) return { code: -1, msg: '订单信息缺失' }
    if (!status) return { code: -1, msg: '不支持的操作类型' }
    const allowedStatus = action === 'ship' ? SHIPPABLE_ORDER_STATUS : CONFIRMABLE_ORDER_STATUS

    let supplierId = ''
    let proxy = false
    if (isSupplier) {
      supplierId = user.default_supplier_id
      if (!supplierId) return { code: -403, msg: '账号未关联供货商，请联系管理员' }
    } else {
      // 代确认只放开 confirm：发货代表货物已离库，必须由供货商本人标记，不可代操作
      if (action !== 'confirm') return { code: -1, msg: '管理员仅可代确认接单，发货须由供货商操作' }
      supplierId = String(event.supplierId || '')
      if (!supplierId) return { code: -1, msg: '缺少供应商信息' }
      proxy = true
    }

    // P2-3（2026-11-10）：供应商档案停用后停用其确认/发货通道（代确认同口径）——
    // 存量登录会话与管理员代操作都不得再推进停用供应商的单据
    const supRes = await db.collection('supplier').where({ supplier_id: supplierId }).limit(1).get()
    if (!supRes.data[0] || supRes.data[0].status !== 1) return { code: -403, msg: '该供货商已停用，请联系管理员' }

    // 该订单必须真的包含此供货商的商品，防止越权确认别人的订单
    const itemRes = await db.collection('purchase_order_item')
      .where({ purchase_order_id: orderId, supplier_id: supplierId })
      .limit(1)
      .get()
    if (!itemRes.data.length) return { code: -403, msg: '该订单不包含贵司供货的商品' }

    // 幂等防降级（2026-11-04）：现有确认状态不劣于本次动作时跳过写入——
    // 重复 confirm/ship 是空操作；尤其 proxy 代确认不得覆盖供应商本人的确认留痕
    // （proxy 记录只应落在"供应商从未确认"的节点）。读取与下方条件更新之间存在
    // 毫秒级窗口：并发 confirm+ship 交错理论上可能回写降级，但两态都过收货门禁、
    // 影响仅限展示标签，与旧实现同类，不做事务级强一致。
    const orderRes = await db.collection('purchase_order')
      .where({ purchase_order_id: orderId })
      .limit(1)
      .get()
    const existing = (((orderRes.data[0] || {}).supplier_confirmations) || {})[supplierId]
    const CONFIRM_RANK = { confirmed: 1, shipped: 2 }
    if (existing && (CONFIRM_RANK[existing.status] || 0) >= (CONFIRM_RANK[status] || 0)) {
      return { code: 0, data: { orderId, supplierId, status: existing.status }, msg: '该供应商已是确认/发货状态，无需重复操作' }
    }

    // 用条件更新实现原子"检查状态+写入"，避免读-判-写竞态（并发作废/收货后仍写入确认）
    const updateData = { updated_at: db.serverDate() }
    const confirmation = {
      status,
      updated_at: db.serverDate(),
      updated_by: user.user_id || user._id
    }
    // 代确认留痕：定界时能看到该节点是管理员补录而非供应商本人操作
    if (proxy) {
      confirmation.proxy = true
      confirmation.proxy_by_name = user.name || user.username || ''
    }
    updateData[`supplier_confirmations.${supplierId}`] = confirmation
    const condRes = await db.collection('purchase_order')
      .where({ purchase_order_id: orderId, order_status: _.in(allowedStatus) })
      .update({ data: updateData })
    if (!condRes.stats || condRes.stats.updated === 0) {
      return { code: -1, msg: '订单不存在或当前状态不可操作（可能已收货或已作废）' }
    }

    // 发货时向订单所属门店写站内消息（biz_id 关联采购单号，消息中心可跳单据详情）
    if (action === 'ship') {
      try {
        const orderRes = await db.collection('purchase_order')
          .where({ purchase_order_id: orderId })
          .limit(1)
          .get()
        const order = orderRes.data[0] || {}
        const supRes = await db.collection('supplier')
          .where({ supplier_id: supplierId })
          .limit(1)
          .get()
        const supplierName = (supRes.data[0] && supRes.data[0].supplier_name) || supplierId
        await db.collection('message').add({
          data: {
            message_id: 'MSG' + Date.now() + crypto.randomBytes(4).toString('hex'),
            type: 'order',
            title: '供货商已发货',
            content: `${supplierName}已对采购单 ${order.order_no || orderId} 标记发货，请留意收货。`,
            biz_id: orderId,
            recipient_user_id: '',
            store_id: order.store_id || '',
            scope_type: '',
            scope_id: '',
            read: false,
            read_by: [],
            created_at: db.serverDate()
          }
        })
      } catch (err) {
        console.error('[confirmSupplierOrder] 发货通知写入失败:', err)
      }
    }

    return { code: 0, data: { orderId, supplierId, status } }
  } catch (err) {
    console.error('[confirmSupplierOrder] 供货商确认操作失败:', err)
    return { code: -1, msg: '操作失败，请稍后重试' }
  }
}
