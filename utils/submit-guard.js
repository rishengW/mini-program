/**
 * 防重入提交守卫（2026-11-05 解耦：收敛各页面手写的提交锁模式）。
 *
 * 提交类（写）操作进行中再次触发时直接忽略，防双击/连点产生重复请求。
 * 历史模式并存三种：this._submitting 手写锁（9 页）、data.isSubmitting
 * （purchase-create/receive-verify）、无防护（其余页，服务端状态机/幂等兜底）。
 * 新代码与补防护一律用本函数；锁字段沿用 `_submitting`，与旧手写模式同字段，
 * 同一页面内两种写法不嵌套使用即可。
 *
 * 用法：
 *   const { submitGuard } = require('../../utils/submit-guard')
 *   const result = await submitGuard(this, () => cloud.callFunction('dataService', { action: 'xxx' }))
 *   if (result === undefined) return  // 重入被忽略（前次提交进行中）
 *
 * 返回值约定：cloud.callFunction 封装的业务返回恒为对象（失败也是
 * {code:-1,...}），故 undefined 只可能来自重入忽略，调用方可安全区分。
 * loading/toast 仍由页面在 task 内外自管，守卫只负责锁。
 */
async function submitGuard(page, task) {
  if (page._submitting) return undefined
  page._submitting = true
  try {
    return await task()
  } finally {
    page._submitting = false
  }
}

module.exports = { submitGuard }
