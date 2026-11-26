---
name: skill-docs-guide
description: >-
  Use when the user asks to open, inspect, organize, lint, check updates,
  analyze usage frequency, or find collaborations across their Antigravity or
  workspace skills.
---

# Skill 文件庫 (Skill Docs)

當使用者想要以直觀的文件管理方式檢視、編輯、分類、檢查更新或分析 Skills 使用狀況與協作關聯時：

1. 直接呼叫 `open_skill_docs` 工具（無須參數，亦可傳入 `tab: "finder" | "analytics" | "graph"`）在右側邊欄展開互動式「Skill 文件庫」面板。
2. 若使用者僅在對話中詢問摘要清單，可呼叫 `list_managed_skills` 取得受管 Skills 的健康狀態、近 30 天使用次數與範圍分佈。
