---
name: friends
description: "维护宿主内置通讯录。适用于录入、修改、删除、整理、查询联系人，以及将 QQ、微信、飞书、Telegram 等平台账号解析为自己、家人、朋友、陌生人四级关系策略。"
---

# 通讯录

通讯录现在是宿主内置的联系人管理与关系策略能力，不再依赖独立插件。

它负责两件事：

- 维护“自己 / 家人 / 朋友 / 陌生人”四级联系人。
- 把平台账号解析成关系级别和策略快照，供 bridge 权限分流使用。

当前可用工具：

- `friends_list_contacts`
- `friends_upsert_contact`
- `friends_resolve_contact`
- `friends_remove_contact`

推荐使用时机：

- 用户要录入、整理、修改联系人。
- 用户要把 QQ / 飞书 / 微信 / Telegram 账号映射到同一个人。
- 需要判断一个平台账号属于自己、家人、朋友还是陌生人。

关系含义：

- `self`：本人，完整权限。
- `family`：家人，与本人同权限，但口气和称呼应按家人关系处理。
- `friend`：可透露有限的工作摘要，但不允许工作空间操作。
- `stranger`：只能寒暄，不透露内部信息。

使用要点：

- 录入联系人时，优先补全 `accounts`，因为 bridge 权限分流主要靠平台账号匹配。
- 同一个人可以有多个 `accounts`，例如 QQ 私聊号、微信群 chatId、Telegram userId。
- 用户要“看看现在通讯录里有什么”时，先用 `friends_list_contacts`。
- 用户提供了新身份信息时，用 `friends_upsert_contact` 更新，而不是先删后建。
- 用户问“这个账号是谁”或“这个 QQ 号属于哪一级”时，用 `friends_resolve_contact`。
- 用户明确要删除某个联系人时，再调用 `friends_remove_contact`。

宿主界面入口：

- 设置页已有独立“通讯录”标签，可直接管理同一份数据。