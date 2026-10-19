---
title: 系统层目录不可用
description: 必要目录真实读写探针失败。
references: [problems/directory-unusable]
---

查看 directory/path/actual，区分只读挂载、权限、缺失和空间耗尽。
探针只清理自己创建的唯一文件。明确修正挂载或目录配置后重测，
不得盲目删除用户数据或放宽所有权限。
