# 面向理解的原生操作步骤

## 修正目标

用户指出准备目录仍执行压缩 JS，复制粘贴可用但阅读困难。
本轮不是再次追求最少代码行数，而是解释目的、分开操作、明确成功现象。
保留原始服务 API、七状态结构、平台分组和既有业务样例，不增加包装器或产品命令。

## 实现

- isolated 进入说明按四个步骤展示，分别有独立命令块。
- Linux/macOS 用 mktemp -d 创建唯一私有目录，不加载 SDK。
- Windows 用 New-Item 创建唯一空目录，用 whoami/icacls 限制和检查 ACL，
  权限成功前不复制业务输入、不启动服务；整个准备阶段不调用 Node/JS。
- 明确 case_dir / $case 是保存本次路径的变量，解释目录权限标记，
  复制普通样例后查看 artifact 中的 worker.cjs 及空 controls。
- ready 分三步解释启动、计算 artifact 版本、读取连接地址及凭据；
  必需 SDK 调用展开为命名函数和多行代码，不再出现 const a=await 等压缩 JS。
- README 与生成的 Markdown/HTML 同步，不改历史消费快照。

## 验证

Windows、Node v24.12.0、pnpm 11.22.0。

- **21/21** 包内测试通过，包括原始 daemon 的完整 PowerShell 取消、故障恢复、
  任务清理和精确自有进程/helper 退出。
- 测试替换“最多八行”约束为“无 Node/JS、四个有解释的分块、原生目录/权限操作、
  权限限制先于复制、startup 无压缩 JS”。
- **pnpm check 退出 0**：全仓构建、层级、格式、lint、类型、测试和打包检查通过。
- 真实浏览器定位 docs 的初始状态并展开 Windows 面板：
  4 个代码块，noNode=true，具有目的、预期结果和 icacls 说明。
- 输出仍由唯一 YAML 派生，原始自动绑定执行语义不变。

初次实跑发现 Windows PowerShell 5.1 的 Get-Acl 模块在本机环境不能自动载入。
改为原生 icacls 查询 ACL，并解释当前账号的 (F)、子项继承的 (OI)/(CI) 与
父目录继承的 (I) 的区别；没有忽略命令失败或绕过权限保护。
仅删除第一次失败创建的已确认空目录，再执行全部流程验证。

Linux/macOS 采用 Bash 与 mktemp 的平台原生命令；没有声称本轮在 macOS 实跑，
也不把 Windows 下的验证当成 POSIX 权限验证。
