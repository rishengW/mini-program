// 共享模块：门店店长查询（2026-11-05 解耦第 3 项收敛）。
// 源头：scripts/cloud-shared/store-query.js —— 由 scripts/sync-shared.js 复制到
// 各云函数目录 shared/ 下；请勿直接改副本，改源头后重新跑同步脚本。
// 使用方：createReceipt / dataService（两处原副本逻辑一致，仅日志前缀不同）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 查询门店店长 user_id（清单 #5 消息定向口径）。查不到返回 ''（回退门店广播）。
async function getStoreManagerId(storeId) {
  try {
    const res = await db.collection('app_user')
      .where({ role: 'store_manager', default_store_id: storeId, status: 1 })
      .limit(1)
      .get()
    return (res.data[0] && (res.data[0].user_id || res.data[0]._id)) || ''
  } catch (err) {
    console.warn('[getStoreManagerId] 查询门店店长失败，消息回退门店广播:', err)
    return ''
  }
}

module.exports = { getStoreManagerId }
