# 云函数样例数据

这些文件对应 `cloudfunctions` 中实际查询的集合，字段名使用云函数里的下划线命名。

建议按下面顺序导入到已经创建好的集合：

1. `store.json` → `store`
2. `app_user.json` → `app_user`
3. `category.json` → `category`
4. `supplier.json` → `supplier`
5. `product.json` → `product`
6. `supplier_product_price.json` → `supplier_product_price`
7. `purchase_order.json` → `purchase_order`
8. `purchase_order_item.json` → `purchase_order_item`
9. `receipt.json` → `receipt`
10. `receipt_item.json` → `receipt_item`
11. `report_file.json` → `report_file`
12. `message.json` → `message`
13. `abnormal_record.json` → `abnormal_record`

`app_user` 中只保存 PBKDF2 密码哈希，不保存明文密码。初始账号仅用于首次登录，登录后应立即在账号管理中修改密码：

| 角色 | 账号 | 初始密码 |
| --- | --- | --- |
| 超级管理员 | `admin` | `Admin@2026` |
| 下单人员 | `chef` | `Chef@2026` |
| 店长 | `manager` | `Manager@2026` |
| 管理员 | `admin_user` | `Purchaser@2026` |

建议在云数据库中建立以下索引，避免重复账号并提升登录查询性能：

- `app_user.username`：唯一索引
- `app_user.session_token_hash`：普通索引
- `store.store_id`：唯一索引

`created_at`、`updated_at`、`generated_at` 使用了可排序的日期字符串，方便直接导入控制台。正式写入时云函数会使用 `db.serverDate()`。

样例关联关系：

- `PO20260806001` 是 S001 门店的待收货订单。
- `PO20260805001` 是 S001 门店的已收货订单，对应 `RCP20260805001`。
- `PO20260804001` 是 S002 门店的已审核订单。
- 报表记录的 `source_order_id`、收货明细的 `purchase_order_item_id` 都能关联到对应主表记录。
- `report_file.file_url` 留空是因为样例没有真实上传到云存储的文件；报表详情仍会根据原始订单和收货数据重建行数据。
