// 列表页公共骨架（2026-11-10 B5 清尾：L17 分页骨架 + L18 装饰收敛 + L27 setData 路径追加）
// 供 purchase-list / report-list / report-history / supplier-orders / supplier-receipts 共用。
// 字段兼容两套口径：hasMore 标志位（purchase/report 系）与 loading+total 长度比较（supplier 系）。
const util = require('./util')
const meta = require('./meta')

const DEFAULT_PAGE_SIZE = 20

// L17：分页生命周期单源（下拉刷新/上拉加载/重载）。页面提供 fetchPage(page, append)。
function listLifecycle(listKey) {
  return {
    onPullDownRefresh() {
      this.reload().finally(() => wx.stopPullDownRefresh())
    },
    onReachBottom() {
      const d = this.data
      if (d.isLoading || d.isLoadingMore || d.loading) return
      if (d.hasMore === false) return
      // total 口径：长度已等于总数即到底（total=0 且空列表时 0>=0 直接返回）
      const total = Number(d.total)
      if (Number.isFinite(total) && d[listKey].length >= total) return
      this.fetchPage((d.page || 1) + 1, true)
    },
    reload() {
      const patch = { page: 1 }
      if ('hasMore' in this.data) patch.hasMore = true
      this.setData(patch)
      return this.fetchPage(1, false)
    }
  }
}

// 取数统一流程：竞态序号 + 加载态 + 失败态 + hasMore/total 维护 + L27 路径追加。
// opts: { fetch(page), decorate(item), listKey, failMsg, clearOnFail, skipIfLoading, extraSetData(result) }
// 返回 true=成功（含首屏空数据）；false=失败或响应过期
async function listFetch(page, self, append, opts) {
  const { fetch, decorate, listKey, failMsg, clearOnFail, skipIfLoading, extraSetData } = opts
  // skipIfLoading：沿用原实现的重入防护（supplier 两页原 loadOrders/loadReceipts 有 loading 守卫）
  if (skipIfLoading && self.data.loading) return false

  // P2-31：请求序号防竞态——刷新/切筛选后旧请求的后至响应直接丢弃，不覆盖新列表
  const seq = (self._reqSeq = (self._reqSeq || 0) + 1)
  self.setData(append ? { isLoadingMore: true, loading: true } : { isLoading: true, loading: true })

  const result = await fetch(page)
  if (seq !== self._reqSeq) return false

  if (!result || result.code !== 0) {
    const failPatch = { isLoading: false, isLoadingMore: false, loading: false }
    // 仅首屏失败且页面声明了 loadFailed 字段才置失败态（避免渲染成「暂无数据」误导）
    if (!append && 'loadFailed' in self.data) failPatch.loadFailed = true
    // P2-69：clearOnFail 时首屏失败清空旧数据（supplier 两页原行为）
    if (clearOnFail && !append) { failPatch[listKey] = []; failPatch.total = 0 }
    self.setData(failPatch)
    util.showToast((result && result.msg) || failMsg)
    return false
  }

  const newItems = (result.data || []).map(decorate)
  const patch = {}
  // L27：翻页追加用路径 setData，不传整个数组；首屏/重载才整体覆盖
  if (append) {
    const base = self.data[listKey].length
    newItems.forEach((item, i) => { patch[`${listKey}[${base + i}]`] = item })
  } else {
    patch[listKey] = newItems
  }
  const total = Number(result.total) || 0
  const finalLen = (append ? self.data[listKey].length : 0) + newItems.length
  Object.assign(patch, {
    page, total,
    isLoading: false, isLoadingMore: false, loading: false, loadFailed: false
  })
  // hasMore 口径页维护 hasMore；total 口径页已由 total 维护（onReachBottom 用长度比较）
  if ('hasMore' in self.data) patch.hasMore = finalLen < total
  if (extraSetData) Object.assign(patch, extraSetData(result))
  self.setData(patch)
  return true
}

// L18：normalize 之后接 meta 字典平铺 statusText/statusType 的组合器（页面 decorate 内组合使用）。
function withStatus(item, statusField) {
  const info = meta.getStatusInfo(item[statusField])
  return { ...item, statusText: info.text, statusType: info.type }
}

module.exports = { listLifecycle, listFetch, withStatus, DEFAULT_PAGE_SIZE }
