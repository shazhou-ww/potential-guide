# 将 level 定义为已达成的阶段，让同级 checks 相互独立

## Problem

目前，level 将 checks 分组，checks 按清单顺序执行，并在首次失败时停止。
这使同一 level 内的 checks 隐式依赖前面的 checks，而不是在已达成的阶段中独立适用。

## Outcome

level 表示一个已达成的阶段，并作为其下所有 checks 唯一的阶段前置条件。
同一 level 内的 checks 均独立具备执行资格；是否实际并行执行由调度并行度或策略决定，
而不是由它们所属的 level 或清单位置决定。

## Boundaries

- 保留阶段的有序推进：当前阶段的所有 checks 通过后，才能达成下一阶段；
  未满足的 guide 前置条件仍会阻止进入。
- check 不得依赖同一 level 内其他 check 的完成或通过。调度可以串行执行，
  但这不构成 checks 之间的依赖关系。
- 执行策略与 level 定义分离；本次变更不引入任意 check 依赖图或 portfolio 调度。

## Acceptance criteria

- 即使同级 check 报告失败，当前已达成阶段中的每个 check 仍具备执行资格；
  观测结果包含该阶段的失败信息，不依赖完成顺序。
- 调度允许时，同阶段 checks 可以重叠执行；将并行度限制为一只改变执行时序，
  不改变执行资格或阶段推进条件。
- 当前阶段的所有 checks 通过前，后续阶段保持阻塞；
  前置条件与 terminal 观测保持现有含义。
