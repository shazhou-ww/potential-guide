import {
  type ColumnDef,
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, X } from "lucide-react";
import { Fragment, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.js";

export interface DirectoryRow {
  id: string;
  title: string;
  status: string;
  time: number;
  content: ReactNode;
}

export interface DirectoryTableData {
  rows: DirectoryRow[];
  scope: string;
  query: string;
  complete: boolean;
  more?: ReactNode;
}

const features = tableFeatures({
  columnFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});

function ColumnFilter({
  id,
  label,
  active,
  children,
}: {
  id: string;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="column-filter-trigger"
        ref={trigger}
        data-filter={id}
        data-active={active}
        popoverTarget={id}
        aria-controls={id}
        aria-expanded={open}
        aria-label={`${label}筛选`}
        aria-description={active ? "已应用筛选" : undefined}
      >
        <Filter aria-hidden="true" focusable="false" />
      </Button>
      <fieldset
        id={id}
        popover="auto"
        className="column-filter-popup"
        aria-labelledby={`${id}-heading`}
        onToggle={(event) => {
          const opening = "newState" in event.nativeEvent && event.nativeEvent.newState === "open";
          setOpen(opening);
          if (opening) event.currentTarget.querySelector<HTMLElement>("input, select")?.focus();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented) return;
          // Embedded browsers can omit native popover Escape dismissal.
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.hidePopover();
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <div className="column-filter-popup-heading">
          <h3 id={`${id}-heading`}>{label}筛选</h3>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            popoverTarget={id}
            popoverTargetAction="hide"
            aria-label={`关闭${label}筛选`}
          >
            <X aria-hidden="true" focusable="false" />
          </Button>
        </div>
        <div className="column-filter-fields">{children}</div>
      </fieldset>
    </>
  );
}

export function DirectoryTable({
  kind,
  data,
  favoriteFilter,
  bundleFilter,
  timeFilter,
  actions,
  info,
}: {
  kind: "tasks" | "runs";
  data: DirectoryTableData;
  favoriteFilter?: ReactNode;
  bundleFilter: ReactNode;
  timeFilter: ReactNode;
  actions: ReactNode;
  info?: ReactNode;
}) {
  const task = kind === "tasks";
  const title = task ? "任务" : "Run";
  const timeLabel = `${task ? "接收" : "开始"}时间`;
  const columns = useMemo<ColumnDef<typeof features, DirectoryRow>[]>(
    () => [
      ...(task ? [{ id: "favorite", header: "收藏", enableSorting: false }] : []),
      {
        id: "title",
        header: title,
        accessorKey: "title",
        filterFn: (row, id, value: string) =>
          row.getValue<string>(id).toLocaleLowerCase().includes(value.toLocaleLowerCase()),
        sortFn: (a, b, id) =>
          a.getValue<string>(id).localeCompare(b.getValue<string>(id), "zh-CN", {
            numeric: true,
          }),
      },
      {
        id: "status",
        header: "状态（查询时）",
        accessorKey: "status",
        filterFn: (row, id, value: string) => row.getValue<string>(id) === value,
        sortFn: (a, b, id) => a.getValue<string>(id).localeCompare(b.getValue<string>(id), "zh-CN"),
      },
      {
        id: "time",
        header: `${timeLabel}（${Intl.DateTimeFormat().resolvedOptions().timeZone}）`,
        accessorKey: "time",
        sortFn: (a, b, id) => a.getValue<number>(id) - b.getValue<number>(id),
      },
      ...(task ? [{ id: "actions", header: "操作", enableSorting: false }] : []),
    ],
    [task, title, timeLabel],
  );
  const table = useTable({
    features,
    columns,
    data: data.rows,
    getRowId: (row) => row.id,
    autoResetPageIndex: false,
    enableMultiSort: false,
    initialState: { pagination: { pageIndex: 0, pageSize: 25 } },
  });
  const { pageIndex, pageSize } = table.state.pagination;
  const count = table.getFilteredRowModel().rows.length;
  const pages = Math.max(1, table.getPageCount());
  const { resetColumnFilters, resetSorting, setPageIndex } = table;
  useLayoutEffect(() => {
    resetColumnFilters();
    resetSorting();
    setPageIndex(0);
  }, [resetColumnFilters, resetSorting, setPageIndex, data.scope]);
  useLayoutEffect(() => {
    setPageIndex(0);
  }, [setPageIndex, data.query]);
  useLayoutEffect(() => {
    if (pageIndex >= pages) setPageIndex(pages - 1);
  }, [setPageIndex, pageIndex, pages]);
  const statuses = [...new Set(data.rows.map((row) => row.status))].sort();
  const statusFilter = String(table.getColumn("status")?.getFilterValue() ?? "");
  if (statusFilter && !statuses.includes(statusFilter)) statuses.push(statusFilter);
  const resetPage = () => table.setPageIndex(0);
  const query = new URLSearchParams(data.query);
  return (
    <section className="directory-grid" aria-label={`${title}表格`}>
      <div className="directory-grid-scroll">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const column = header.column;
                  const sorted = column.getIsSorted();
                  const label = String(column.columnDef.header);
                  const SortIcon =
                    sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        column.getCanSort()
                          ? sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                          : undefined
                      }
                    >
                      <div className="directory-column-heading">
                        {column.getCanSort() ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="directory-sort-button"
                            aria-label={`${label}排序`}
                            onClick={() => {
                              resetPage();
                              column.toggleSorting();
                            }}
                          >
                            {label}
                            <SortIcon aria-hidden="true" focusable="false" />
                          </Button>
                        ) : (
                          <span className="directory-column-label">{label}</span>
                        )}
                        {column.id !== "actions" && (
                          <ColumnFilter
                            id={`${kind}-${column.id}-filter-popup`}
                            label={label}
                            active={
                              column.getIsFiltered() ||
                              (column.id === "favorite" && data.query.startsWith("favorites:")) ||
                              (column.id === "title" &&
                                (query.has("bundleCid") || query.has("runId"))) ||
                              (column.id === "time" &&
                                [
                                  "createdFrom",
                                  "createdBefore",
                                  "startedFrom",
                                  "startedBefore",
                                ].some((key) => query.has(key)))
                            }
                          >
                            {column.id === "favorite" ? (
                              favoriteFilter
                            ) : column.id === "title" ? (
                              <>
                                <label htmlFor={`${kind}-title-filter`}>
                                  {title}名称或 ID（已加载记录）
                                  <Input
                                    id={`${kind}-title-filter`}
                                    value={String(column.getFilterValue() ?? "")}
                                    onChange={(event) => {
                                      resetPage();
                                      column.setFilterValue(event.currentTarget.value);
                                    }}
                                  />
                                </label>
                                {bundleFilter}
                              </>
                            ) : column.id === "status" ? (
                              <label>
                                状态（已加载记录）
                                <select
                                  value={statusFilter}
                                  onChange={(event) => {
                                    resetPage();
                                    column.setFilterValue(event.currentTarget.value);
                                  }}
                                >
                                  <option value="">全部状态</option>
                                  {statuses.map((status) => (
                                    <option key={status} value={status}>
                                      {status}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : (
                              timeFilter
                            )}
                          </ColumnFilter>
                        )}
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <Fragment key={row.id}>{row.original.content}</Fragment>
            ))}
            {!count && (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  {data.rows.length ? "没有符合列筛选的记录；可清除列筛选。" : "暂无记录。"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <footer className="directory-grid-footer">
        <p role="status" aria-live="polite">
          {data.complete ? "完整集合" : "目录尚未加载完整；筛选、排序和页码仅针对已加载记录"} ·{" "}
          {count ? pageIndex * pageSize + 1 : 0}–{Math.min((pageIndex + 1) * pageSize, count)} /{" "}
          {count} 条{count !== data.rows.length ? `（已加载 ${data.rows.length} 条）` : ""}
        </p>
        {info}
        <div className="directory-grid-actions">
          {actions}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-action="clear-columns"
            disabled={!table.state.columnFilters.length && !table.state.sorting.length}
            onClick={() => {
              table.resetColumnFilters();
              table.resetSorting();
              resetPage();
            }}
          >
            清除列筛选与排序
          </Button>
          <label className="directory-page-size">
            每页
            <select
              aria-label={`${title}每页条数`}
              value={pageSize}
              onChange={(event) => {
                table.setPageSize(Number(event.currentTarget.value));
                resetPage();
              }}
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <nav aria-label={`${title}分页`}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              上一页
            </Button>
            <span>
              {pageIndex + 1} / {pages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              下一页
            </Button>
          </nav>
          {data.more}
        </div>
      </footer>
    </section>
  );
}
