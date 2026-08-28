# Semesh 安全更名审计（Public）

- 审计日期：2026-08-23
- 基线：`origin/main@6ff58790b6d75bc05409378dc97a406d727b0c7a`
- 范围：全部 Git 跟踪路径和文本内容；不部署，不调用 provider。
- 扫描口径：路径与文本均按 `settle[[:space:]_-]?mesh`（忽略大小写）检查。

## A / B / C 清单

- 路径命中：0。
- 文本命中：1 个文件、7 行、7 次。
- A（可直接更名）：0 个文件、0 次。产品展示名、插件目录、skill 名、machine manifest 和模板默认值已由合并的 [PR #23](https://github.com/StructureIntelligence/Semesh/pull/23) 完成更名。
- B（兼容/防回归守卫）：`scripts/check-brand-language.sh`，1 个文件、7 行、7 次；全部位于第 60–69 行的负向自测与 allow-marker 契约，用于证明守卫会拒绝旧品牌、旧环境变量和旧 manifest 默认值。合并的 [PR #24](https://github.com/StructureIntelligence/Semesh/pull/24) 引入该守卫。本轮不改写这些测试向量。
- C（本轮冻结）：0 个文件、0 次；本仓当前没有数据库迁移、provider resource、secret 名或外部持久身份残留需要延期。

除上述单一守卫文件外没有任何例外路径，因此 A 已清零，也没有运行时兼容别名需要新增。

## 验证证据

以下主线 CI 等价入口均通过：

- `bash scripts/check-brand-language.sh`
- `bash scripts/check-confirmation-language.sh`
- `bash scripts/check-money-settlement-truth.sh`
- 四个公开模板 JavaScript 入口的 `node --check`

结论：本 PR 仅增加审计报告，不改变公开集成、模板运行时、配置、URL、secret 或 provider identity。
