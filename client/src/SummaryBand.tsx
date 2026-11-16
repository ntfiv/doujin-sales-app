// Summary band: grand-total cards (総売上 / 総頒布数 / 参加イベント数), the
// registration/product/transaction caption line, and the per-year
// sales bar chart.
//
// This used to sit at the top of the main screen; it was taken off
// the screen in the 2026-11-16 cleanup and kept as a standalone
// component, and now renders at the top of the ダッシュボード tab
// (Charts.tsx renders <SummaryBand data={overview.data} /> with the
// getOverview result).

import {
Bar,
BarChart,
Cell,
ResponsiveContainer,
Tooltip,
XAxis,
YAxis,
} from "recharts";
import { qtyMasked, yen, yenMasked } from "./format";
import { useMasked } from "./mask";
import {
CollapsibleTitle,
MoveButtons,
type DashSectionProps,
} from "./DashboardSection";

export interface SummaryBandData {
  totalNet: number;
  totalQty: number;
  totalTx: number;
  dayCount: number;
  registeredCount: number;
  productCount: number;
  years: { year: string; net: number; qty: number; days: number }[];
}

export function SummaryBand({
  data,
  highlightYear = "",
  part = "all",
  dash,
  yearlyDash,
}: {
  data: SummaryBandData;
  /** Year to highlight in the per-year chart (e.g. the active ledger year filter). */
  highlightYear?: string;
  /**
   * Which half to render: "totals" = the サマリー cards + caption
   * only, "yearly" = the 年別売上 chart card only, "all" = both
   * (the original combined band). The dashboard renders the two
   * halves as separate reorderable / collapsible sections.
   */
  part?: "all" | "totals" | "yearly";
  /** Dashboard layout controls for the サマリー (totals) half. */
  dash?: DashSectionProps;
  /** Dashboard layout controls for the 年別売上 half. */
  yearlyDash?: DashSectionProps;
}) {
  const masked = useMasked();
  const totalsCollapsed = dash?.collapsed ?? false;
  const yearlyCollapsed = yearlyDash?.collapsed ?? false;
  const showTotals = part !== "yearly";
  const showYearly = part !== "totals" && data.years.length > 1;
  return (
    <section
      aria-label={part === "yearly" ? "年別売上" : "合計"}
      className={part === "totals" && dash ? "mt-4" : undefined}
    >
      {showTotals && (
        <>
          {dash && (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <CollapsibleTitle title="サマリー" dash={dash} />
              <MoveButtons label="サマリー" dash={dash} />
            </div>
          )}
          {!totalsCollapsed && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-3">
                  <p className="text-[11px] tracking-wide text-[var(--dim)]">総売上</p>
                  <p className="tnum font-ledger mt-1 text-lg font-bold leading-tight sm:text-2xl">
                    {yenMasked(data.totalNet, masked)}
                  </p>
                </div>
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-3">
                  <p className="text-[11px] tracking-wide text-[var(--dim)]">総頒布数</p>
                  <p className="tnum font-ledger mt-1 text-lg font-bold leading-tight sm:text-2xl">
                    {qtyMasked(data.totalQty, masked)}
                    <span className="ml-0.5 text-xs font-normal">冊</span>
                  </p>
                </div>
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-3">
                  <p className="text-[11px] tracking-wide text-[var(--dim)]">参加イベント数</p>
                  <p className="tnum font-ledger mt-1 text-lg font-bold leading-tight sm:text-2xl">
                    {data.dayCount}
                  </p>
                </div>
              </div>
              <p className="tnum mt-2 text-center text-xs text-[var(--dim)]">
                イベント登録 {data.registeredCount} / {data.dayCount}日 ・ 頒布物 {data.productCount}種 ・
                取引 {masked ? "***" : data.totalTx.toLocaleString("ja-JP")}件
              </p>
            </>
          )}
        </>
      )}

      {showYearly && (
        <div
          className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 ${
            part === "all" ? "mt-3" : "mt-4"
          } ${masked ? "chart-blur" : ""}`}
          role="img"
          aria-label={
            masked
              ? "年別売上の棒グラフ（スクショモードで数値は非表示）"
              : `年別売上の棒グラフ。${data.years
                  .map((y) => `${y.year}年 ${yen(y.net)}`)
                  .join("、")}`
          }
        >
          {yearlyDash ? (
            <div
              className={`flex flex-wrap items-center justify-between gap-2 ${
                yearlyCollapsed ? "" : "mb-1"
              }`}
            >
              <CollapsibleTitle title="年別 売上" dash={yearlyDash} />
              <MoveButtons label="年別売上" dash={yearlyDash} />
            </div>
          ) : (
            <p className="font-ledger mb-1 text-sm font-bold">年別 売上</p>
          )}
          {!yearlyCollapsed && (
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={data.years} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
                <XAxis
                  dataKey="year"
                  tick={{ fontSize: 12, fill: "var(--text)" }}
                  axisLine={{ stroke: "var(--border)" }}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  formatter={(v) => [yen(Number(v ?? 0)), "売上"]}
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="net" radius={[4, 4, 0, 0]}>
                  {data.years.map((y) => (
                    <Cell
                      key={y.year}
                      fill={highlightYear === y.year ? "var(--accent)" : "var(--ai)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </section>
  );
}
