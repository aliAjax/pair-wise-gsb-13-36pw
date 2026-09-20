# 加油站班次交接 · 三账差异归因台

- 行业：石油
- 技术栈：Vue3、Vite、TypeScript、Element Plus
- 启动：`npm install && npm run dev`
- 构建：`npm run build`

每班录入同油品的油枪泵码增量、罐存变化与收款合计，泵码起数自动继承上一班结束泵码。

- `src/domain/attribution.ts`：归因规则层（纯函数）。三账换算、复核拦截规则（R1 来源缺失 / R2 跨日回绕超过一次 / R3 班次时段重叠）、超阈值归因要求（D1 泵罐体积差 60L / D2 收款金额差 200 元）、班次链与版本关系。
- `src/store/persistence.ts`：持久化层。localStorage 存取与演示种子数据，刷新后班次链、差异归因、版本关系由规则层重建。
- `src/App.vue`：页面层。录入、冲突拦截列表（班次/油品/三账数值/触发规则）、归因填写、复核冻结、带原因的更正版本。
