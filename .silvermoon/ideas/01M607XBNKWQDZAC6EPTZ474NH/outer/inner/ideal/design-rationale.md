# Objective 组合与 References 的设计逻辑

## 为什么是声明式制品

Objective 的增量价值是把 Check 组合成目标：subject 契约及映射、等级条件、problem 绑定、依赖语义和目标特有的 References。它无需 JavaScript 入口或 npm 包身份；可复用的执行行为属于 Check。

前置能力是 [Check 制品](../../../../01M607T630T6DSDZYTYA52ED6J/outer/inner/ideal/Idea.md)。本项实现消费闭环；后续再迁移全部内置内容并建设正式 Release。

## 为什么不设 lock 文件

每个 Check 在 Objective manifest 中直接声明引用 ID、来源和准确 digest。没有 registry 版本选择或范围求解，也就没有先 resolve 再写 lock 的必要。

引用 ID 是 Objective 内的绑定名，不是 npm 包名。可展示的 Check 版本不参与求解；来源变化不能绕过摘要校验。准备过程只查缓存、必要时获取并校验内容，不隐式更新 manifest。

Objective 自身也需要准确的制品身份与内容摘要。升级 Check 意味着显式修改其引用，并发布不同内容的 Objective。Objective 间已有业务依赖仍需保留；新制品引用同样不得重新引入隐式 latest 或浮动版本。

运行证据记录实际使用的 Objective 和依赖内容，而不是维护第二份可编辑的依赖真相。Objective 内容摘要覆盖内联引用和自身 References；执行闭包证据还应覆盖实际准备的依赖及 Check 执行 revision。

## References 的继承与覆盖

Check 提供自身和各个 problem 的通用 References。Objective 默认继承这些内容，并持有目标和 level 的专属 References；它可以覆盖特定 Check 或 problem 的说明，或为该场景增加内容。

作用域必须以 Objective 内的 Check 引用区分，而不只看 Check 全局身份：同一 Check 在两个位置引用时可以有不同解释。未覆盖条目仍继承；覆盖不得修改 Check 声明的结果契约，也不能指向不存在的 problem。

已确认的是继承及局部覆盖能力。覆盖按整页还是元数据字段、语言回退顺序、附加内容如何引用通用原文，在实施阶段结合现有 References 模型明确，不把讨论中的候选语法当作已接受 schema。

优先考虑显式覆盖或显式引用基础内容，避免暗中拼接 Markdown。引用解析须保留原始页面所属制品的资源基准，验证悬空引用与循环，不因覆盖改变其他 Objective 的说明。

## 业务语义与历史

制品来源变化不应改变累计等级、初始状态、terminal 别名、依赖观察及“Pilot 不调用 Agent”的职责。文档覆盖不是执行成功的证据。

去掉 npm 后必须检查实际包名作为身份的协议、声明、CLI 配置、regulation、调度及持久化表面。旧 npm/Git 证据保留原语义，不能把旧 commit、包名或历史 digest 强制解释为新制品身份；继续读取或明确拒绝的策略在实施时给出迁移说明。

## 与下一项的界线

本项以代表性真实 Objective 验证工具链可用，不要求所有内置包一起迁移。批量迁移、发布触发、Release 命名及真实线上获取由后续交付 idea 验收。
