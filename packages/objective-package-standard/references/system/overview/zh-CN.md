---
title: 单包标准化
description: 仅观察绑定包的静态准备。
references: [levels/initial, levels/structured, levels/terminal]
---

# 包级标准化

subject 由包目录 objectives.yaml 的 standardize 声明投影。只检查该包自己的结构、
角色、交付意图、允许依赖、源码边界、发布/CLI 元数据以及实际 scripts 和适用 Turbo。
不会验证其他包自身是否合格，不运行目标脚本、不安装、不发布、不部署。
跨包交付闭包、循环、运行时方向和仓库布局由仓库 Objective 负责。
