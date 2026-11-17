import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
Bar,
BarChart,
Cell,
ComposedChart,
Line,
Pie,
PieChart,
ResponsiveContainer,
Tooltip,
XAxis,
YAxis,
} from "recharts";
import { api } from "./api";
import type { DaySummary } from "./Ledger";
import { CitiesView } from "./Cities";
import { SummaryBand } from "./SummaryBand";
import {
resolveEventType,
typeLabel,
useEventTypes,
type EventTypeDef,
type EventTypeId,
} from "./eventType";
import { byReleaseDateDesc } from "./Products";
import { dateLabel, pctFmt, qtyFmt, qtyMasked, yen, yenMasked } from "./format";
import { useMasked } from "./mask";
import { useDisplaySettings } from "./display";
import {
CollapsibleTitle,
MoveButtons,
useDashboardLayout,
type DashSectionProps,
} from "./DashboardSection";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  fontSize: 12,
} as const;

/** Slanted-hatch pattern used for 「売上は参考情報」 portions / items. */
function HatchDef({ id }: { id: string }) {
  return (
    <defs>
      <pattern
        id={id}
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width="6" height="6" fill="var(--surface-alt)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--dim)" strokeWidth="2.5" />
      </pattern>
    </defs>
  );
}

function SegControl(props: {
  ariaLabel: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={props.ariaLabel}
      className="inline-flex overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]"
    >
      {props.options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={props.value === o.id}
          onClick={() => props.onChange(o.id)}
          className={`px-3 py-1.5 text-xs ${
            props.value === o.id
              ? "bg-[var(--accent)] font-bold text-white"
              : "text-[var(--text)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 「東京を省く」 toggle shared by every chart on the グラフ tab. */
const TOKYO = "東京都";

function TokyoToggle(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="h-4 w-4 shrink-0"
      />
      東京のイベントを省略
    </label>
  );
}

function ChartCard(props: {
  title: string;
  controls?: ReactNode;
  note?: ReactNode;
  ariaLabel: string;
  anchorId?: string;
  /** Dashboard layout controls (collapse / move). When given, the
   *  title becomes the collapse toggle and 上へ／下へ buttons join
   *  the header; while collapsed only the header stays visible. */
  dash?: DashSectionProps;
  /** Short name for the move buttons' aria-labels, when `title`
   *  is dynamic (e.g. 「売上推移（月別）」 → 「売上推移」). */
  dashLabel?: string;
  children: ReactNode;
}) {
  const dash = props.dash;
  const collapsed = dash?.collapsed ?? false;
  return (
    <section
      id={props.anchorId}
      aria-label={props.ariaLabel}
      className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-2 ${
          collapsed ? "" : "mb-2"
        }`}
      >
        {dash ? (
          <CollapsibleTitle title={props.title} dash={dash} />
        ) : (
          <h2 className="font-ledger text-sm font-bold">{props.title}</h2>
        )}
        {(props.controls || dash) && (
          <span className="flex flex-wrap items-center gap-2">
            {!collapsed && props.controls}
            {dash && (
              <MoveButtons label={props.dashLabel ?? props.title} dash={dash} />
            )}
          </span>
        )}
      </div>
      {!collapsed && (
        <>
          <div role="img" aria-label={props.ariaLabel}>
            {props.children}
          </div>
          {props.note}
        </>
      )}
    </section>
  );
}

function SectionState({ pending, error }: { pending: boolean; error: unknown }) {
  if (pending)
    return <p className="py-8 text-center text-sm text-[var(--dim)]">読み込み中…</p>;
  if (error)
    return (
      <p role="alert" className="py-8 text-center text-sm text-[var(--accent)]">
        読み込めませんでした：{String(error)}
      </p>
    );
  return null;
}

/** Compact yen for axis ticks: ¥12万 / ¥8,500 */
function yenAxis(v: number): string {
  if (Math.abs(v) >= 10000) {
    const man = v / 10000;
    return `¥${Number.isInteger(man) ? man : man.toFixed(1)}万`;
  }
  return yen(v);
}

/** Split a label into lines of at most `per` characters (no ellipsis). */
function wrapText(s: string, per: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += per) lines.push(s.slice(i, i + per));
  return lines.length > 0 ? lines : [""];
}

/**
 * Y-axis tick that wraps long category names onto multiple lines so the
 * full name stays readable instead of being cut off with an ellipsis.
 */
function WrappedTick(props: {
  x?: number | string;
  y?: number | string;
  payload?: { value?: string };
  charsPerLine?: number;
}) {
  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const lines = wrapText(String(props.payload?.value ?? ""), props.charsPerLine ?? 13);
  const lineHeight = 13;
  const startDy = 4 - ((lines.length - 1) * lineHeight) / 2;
  return (
    <text x={x} y={y} textAnchor="end" fontSize={11} fill="var(--text)">
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? startDy : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

// ---------------------------------------------------------------------------
// 売上推移 (monthly / yearly): stacked bars split into 通常 / 参考情報 days,
// with a line for copies sold.
// ---------------------------------------------------------------------------

interface TrendPoint {
  key: string;
  label: string;
  netNormal: number;
  netRef: number;
  qty: number;
  days: number;
}

function TrendSection({
  days,
  dash,
}: {
  days: DaySummary[];
  dash?: DashSectionProps;
}) {
  const masked = useMasked();
  const [gran, setGran] = useState<"month" | "year">("month");
  const [excludeTokyo, setExcludeTokyo] = useState(false);

  const points = useMemo<TrendPoint[]>(() => {
    const map = new Map<string, TrendPoint>();
    // Sales trend: event-only days (registered ahead of time, no
    // sales yet) are not sales days and stay out of the day counts.
    const src = days.filter(
      (d) => d.hasSales && (!excludeTokyo || d.prefecture !== TOKYO),
    );
    const sorted = [...src].sort((a, b) => a.date.localeCompare(b.date));
    for (const d of sorted) {
      const key = gran === "month" ? d.date.slice(0, 7) : d.date.slice(0, 4);
      let cur = map.get(key);
      if (!cur) {
        const [y = "", m = ""] = key.split("-");
        cur = {
          key,
          label: gran === "month" ? `${y}/${Number(m)}` : `${y}年`,
          netNormal: 0,
          netRef: 0,
          qty: 0,
          days: 0,
        };
        map.set(key, cur);
      }
      if (d.salesUnreliable) cur.netRef += d.net;
      else cur.netNormal += d.net;
      cur.qty += d.qty;
      cur.days += 1;
    }
    return [...map.values()];
  }, [days, gran, excludeTokyo]);

  const refDays = days.filter(
    (d) => d.hasSales && d.salesUnreliable && (!excludeTokyo || d.prefecture !== TOKYO),
  ).length;
  const totalNet = points.reduce((s, p) => s + p.netNormal + p.netRef, 0);
  const totalQty = points.reduce((s, p) => s + p.qty, 0);

  return (
    <ChartCard
      title={gran === "month" ? "売上推移（月別）" : "売上推移（年別）"}
      dash={dash}
      dashLabel="売上推移"
      ariaLabel={
        masked
          ? "売上推移のグラフ（スクショモードで数値は非表示）。棒は売上（参考情報の日は斜線で分けて表示）、折れ線は頒布冊数です。"
          : `売上推移のグラフ。合計 ${yen(totalNet)}、${qtyFmt(totalQty)}冊。棒は売上（参考情報の日は斜線で分けて表示）、折れ線は頒布冊数です。`
      }
      controls={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <TokyoToggle checked={excludeTokyo} onChange={setExcludeTokyo} />
          <SegControl
            ariaLabel="推移の単位"
            value={gran}
            options={[
              { id: "month", label: "月別" },
              { id: "year", label: "年別" },
            ]}
            onChange={(v) => setGran(v as "month" | "year")}
          />
        </span>
      }
      note={
        <div className="mt-2 text-xs text-[var(--dim)]">
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <span aria-hidden className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[var(--ai)]" />
              売上
            </span>
            <span>
              <span
                aria-hidden
                className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-[var(--dim)] bg-[var(--surface-alt)]"
              />
              売上（参考情報の日）
            </span>
            <span>
              <span aria-hidden className="mr-1 inline-block h-0.5 w-4 align-middle bg-[var(--accent)]" />
              頒布冊数
            </span>
          </p>
          {excludeTokyo && (
            <p className="mt-1">東京都での販売日を除いて集計しています。</p>
          )}
          {refDays > 0 && (
            <p className="mt-1">
              「売上は参考情報」の日（{refDays}日）は、棒の中で斜線部分に分けて表示しています。
            </p>
          )}
        </div>
      }
    >
      <div className={masked ? "chart-blur" : undefined}>
      <ResponsiveContainer width="100%" height={216}>
        <ComposedChart data={points} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
          <HatchDef id="hatchTrend" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--text)" }}
            height={24}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            yAxisId="net"
            width={48}
            tick={{ fontSize: 10, fill: "var(--dim)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => yenAxis(Number(v))}
          />
          <YAxis yAxisId="qty" orientation="right" hide />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v, name) =>
              name === "頒布冊数"
                ? [`${qtyFmt(Number(v ?? 0))}冊`, name]
                : [yen(Number(v ?? 0)), name]
            }
          />
          <Bar yAxisId="net" dataKey="netNormal" name="売上" stackId="net" fill="var(--ai)" />
          <Bar
            yAxisId="net"
            dataKey="netRef"
            name="売上（参考情報の日）"
            stackId="net"
            fill="url(#hatchTrend)"
            stroke="var(--dim)"
            strokeWidth={0.5}
            radius={[4, 4, 0, 0]}
          />
          <Line
            yAxisId="qty"
            type="monotone"
            dataKey="qty"
            name="頒布冊数"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// 都道府県別
// ---------------------------------------------------------------------------

function PrefSection({ dash }: { dash?: DashSectionProps }) {
  const masked = useMasked();
  const cities = useQuery({ queryKey: ["cities"], queryFn: () => api.getCities({}) });
  const [metric, setMetric] = useState<"net" | "qty">("net");
  const [excludeTokyo, setExcludeTokyo] = useState(false);

  const rows = useMemo(() => {
    const map = new Map<string, { name: string; net: number; qty: number; days: number }>();
    for (const c of cities.data?.cities ?? []) {
      if (excludeTokyo && c.prefecture === TOKYO) continue;
      const name = c.prefecture || c.city || "不明";
      const cur = map.get(name) ?? { name, net: 0, qty: 0, days: 0 };
      cur.net += c.net;
      cur.qty += c.qty;
      cur.days += c.days.length;
      map.set(name, cur);
    }
    return [...map.values()].sort((a, b) => b[metric] - a[metric]);
  }, [cities.data, metric, excludeTokyo]);

  const unreg = cities.data?.unregistered;
  const showState = cities.isPending || Boolean(cities.error);

  return (
    <ChartCard
      title="都道府県別"
      dash={dash}
      ariaLabel={
        masked
          ? `都道府県別の${metric === "net" ? "売上" : "頒布冊数"}の棒グラフ（スクショモードで数値は非表示）`
          : `都道府県別の${metric === "net" ? "売上" : "頒布冊数"}の棒グラフ。${
              rows[0] ? `最大は${rows[0].name}の${metric === "net" ? yen(rows[0].net) : `${qtyFmt(rows[0].qty)}冊`}` : ""
            }`
      }
      controls={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <TokyoToggle checked={excludeTokyo} onChange={setExcludeTokyo} />
          <SegControl
            ariaLabel="都道府県別の指標"
            value={metric}
            options={[
              { id: "net", label: "売上" },
              { id: "qty", label: "冊数" },
            ]}
            onChange={(v) => setMetric(v as "net" | "qty")}
          />
        </span>
      }
      note={
        <div className="mt-2 text-xs text-[var(--dim)]">
          {excludeTokyo && <p>東京都を除いて集計しています。</p>}
          {unreg && unreg.days.length > 0 && (
            <p className={excludeTokyo ? "mt-1" : undefined}>
              イベント未登録の日（{unreg.days.length}日・売上 {yenMasked(unreg.net, masked)}／{qtyMasked(unreg.qty, masked)}
              冊）は都道府県不明のため含まれていません。
            </p>
          )}
        </div>
      }
    >
      {showState ? (
        <SectionState pending={cities.isPending} error={cities.error} />
      ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--dim)]">
            都道府県が登録された日がまだありません。
          </p>
        ) : (
          <div className={masked ? "chart-blur" : undefined}>
          <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 36)}>
            <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16, top: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={92}
                tick={{ fontSize: 12, fill: "var(--text)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) =>
                  metric === "net"
                    ? [yen(Number(v ?? 0)), "売上"]
                    : [`${qtyFmt(Number(v ?? 0))}冊`, "頒布数"]
                }
              />
              <Bar dataKey={metric} fill="var(--ai)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        )}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// 頒布物ランキング (top 10). 『任意の金額』 is excluded by getProducts.
// ---------------------------------------------------------------------------

const RANK_LIMIT = 10;
/** Characters per label line in the ranking chart; longer names wrap. */
const RANK_LABEL_CHARS = 12;

function ProductsSection({
  onSelect,
  selected,
  dash,
}: {
  onSelect: (product: string) => void;
  selected: string | null;
  dash?: DashSectionProps;
}) {
  const masked = useMasked();
  const products = useQuery({ queryKey: ["products"], queryFn: () => api.getProducts({}) });
  const [metric, setMetric] = useState<"qty" | "net">("qty");
  const [excludeTokyo, setExcludeTokyo] = useState(false);

  const rows = useMemo(() => {
    // With 東京を省く on, each product's totals are re-aggregated from its
    // per-date rows without the 東京都 days.
    const all = (products.data?.products ?? [])
      .map((p) => {
        if (!excludeTokyo) {
          return { product: p.product, qty: p.qty, net: p.net, salesUnreliable: p.salesUnreliable };
        }
        let qty = 0;
        let net = 0;
        for (const d of p.byDate) {
          if (d.prefecture === TOKYO) continue;
          qty += d.qty;
          net += d.net;
        }
        return { product: p.product, qty, net, salesUnreliable: p.salesUnreliable };
      })
      .sort((a, b) => b[metric] - a[metric]);
    return all.slice(0, RANK_LIMIT).map((p, i) => ({
      rank: i + 1,
      name: `${i + 1}. ${p.product}`,
      fullName: p.product,
      qty: p.qty,
      net: p.net,
      salesUnreliable: p.salesUnreliable,
    }));
  }, [products.data, metric, excludeTokyo]);

  const maxLabelLines = rows.reduce(
    (m, r) => Math.max(m, wrapText(r.name, RANK_LABEL_CHARS).length),
    1,
  );
  const rowHeight = Math.max(38, maxLabelLines * 13 + 18);

  const totalCount = products.data?.products.length ?? 0;
  const refInRank = rows.some((r) => r.salesUnreliable);
  const showState = products.isPending || Boolean(products.error);

  return (
    <ChartCard
      title={`頒布物ランキング（${metric === "qty" ? "冊数" : "売上"} 上位${RANK_LIMIT}）`}
      dash={dash}
      dashLabel="頒布物ランキング"
      ariaLabel={
        masked
          ? "頒布物別ランキングの横棒グラフ（スクショモードで数値は非表示）"
          : `頒布物別ランキングの横棒グラフ。${
              rows[0]
                ? `1位は${rows[0].fullName}で${metric === "qty" ? `${qtyFmt(rows[0].qty)}冊` : yen(rows[0].net)}`
                : ""
            }`
      }
      controls={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <TokyoToggle checked={excludeTokyo} onChange={setExcludeTokyo} />
          <SegControl
            ariaLabel="ランキングの指標"
            value={metric}
            options={[
              { id: "qty", label: "冊数" },
              { id: "net", label: "売上" },
            ]}
            onChange={(v) => setMetric(v as "qty" | "net")}
          />
        </span>
      }
      note={
        <div className="mt-2 text-xs text-[var(--dim)]">
          {excludeTokyo && <p>東京都での販売を除いて集計しています。</p>}
          <p>
            全{totalCount}種のうち上位{RANK_LIMIT}種を表示（「任意の金額」は含みません）。
          </p>
          <p className="mt-1">
            バーをタップすると、「頒布物別グラフ」にその頒布物が表示されます。
          </p>
          {refInRank && (
            <p className="mt-1">
              斜線の棒は「除外」の頒布物です（数値の信頼性に注意）。
            </p>
          )}
        </div>
      }
    >
      {showState ? (
        <SectionState pending={products.isPending} error={products.error} />
      ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--dim)]">頒布物の売上データがありません。</p>
        ) : (
          <div className={masked ? "chart-blur" : undefined}>
          <ResponsiveContainer width="100%" height={rows.length * rowHeight + 8}>
            <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16, top: 0, bottom: 0 }}>
              <HatchDef id="hatchProd" />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                tick={<WrappedTick charsPerLine={RANK_LABEL_CHARS} />}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(_label, payload) => {
                  const row = payload?.[0]?.payload as { fullName?: string } | undefined;
                  return row?.fullName ?? "";
                }}
                formatter={(v, name) =>
                  name === "冊数"
                    ? [`${qtyFmt(Number(v ?? 0))}冊`, name]
                    : [yen(Number(v ?? 0)), name]
                }
              />
              <Bar dataKey={metric} name={metric === "qty" ? "冊数" : "売上"} radius={[0, 4, 4, 0]}>
                {rows.map((r) => (
                  <Cell
                    key={r.rank}
                    fill={
                      r.salesUnreliable
                        ? "url(#hatchProd)"
                        : r.fullName === selected
                          ? "var(--accent)"
                          : "var(--ai)"
                    }
                    stroke={
                      r.fullName === selected
                        ? "var(--accent)"
                        : r.salesUnreliable
                          ? "var(--dim)"
                          : undefined
                    }
                    strokeWidth={
                      r.fullName === selected ? 2 : r.salesUnreliable ? 0.5 : 0
                    }
                    style={{ cursor: "pointer" }}
                    onClick={() => onSelect(r.fullName)}
                  />
                ))}
              </Bar>
              {/* Hidden second series so the tooltip always shows both figures. */}
              <Bar dataKey={metric === "qty" ? "net" : "qty"} name={metric === "qty" ? "売上" : "冊数"} hide />
            </BarChart>
          </ResponsiveContainer>
          </div>
        )}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// 頒布物別グラフ: one product at a time — totals, its sales trend
// (per event day or per month, overall only), and its prefecture
// breakdown. Tapping a prefecture in the breakdown lists the events
// where this product was sold in that prefecture.
// Data comes from getProducts (per-date rows joined with event info).
// ---------------------------------------------------------------------------

interface FocusPoint {
  key: string;
  tick: string;
  dateLabel: string;
  qty: number;
  net: number;
  eventName: string | null;
  /** That day's event prefecture ("" when unknown / month rows). */
  prefecture: string;
  salesUnreliable: boolean;
  isFirst: boolean;
}

function FocusTooltip(props: {
  active?: boolean;
  payload?: { payload?: FocusPoint }[];
}) {
  const { hideFirstBadge } = useDisplaySettings();
  if (!props.active) return null;
  const p = props.payload?.[0]?.payload;
  if (!p) return null;
  return (
    <div style={tooltipStyle} className="max-w-[220px] rounded px-2 py-1.5">
      <p className="font-bold">{p.dateLabel}</p>
      {p.eventName && <p>{p.eventName}</p>}
      <p className="tnum">
        {qtyFmt(p.qty)}冊 ・ {yen(p.net)}
      </p>
      {p.isFirst && !hideFirstBadge && (
        <p>{p.prefecture ? `${p.prefecture}で初頒布` : "同県で初頒布"}</p>
      )}
      {p.salesUnreliable && <p>（売上は参考情報の日）</p>}
    </div>
  );
}

interface FocusPrefRow {
  name: string;
  qty: number;
  net: number;
  days: number;
}

function FocusPrefTooltip(props: {
  active?: boolean;
  payload?: { payload?: FocusPrefRow }[];
}) {
  if (!props.active) return null;
  const p = props.payload?.[0]?.payload;
  if (!p) return null;
  return (
    <div style={tooltipStyle} className="rounded px-2 py-1.5">
      <p className="font-bold">{p.name}</p>
      <p className="tnum">
        {qtyFmt(p.qty)}冊 ・ {yen(p.net)} ・ {p.days}日
      </p>
    </div>
  );
}

function ProductFocusSection(props: {
  selected: string | null;
  onSelect: (product: string) => void;
  /** Jump to the 台帳 tab with that day's detail open (optional). */
  onOpenDay?: (date: string) => void;
  dash?: DashSectionProps;
}) {
  const masked = useMasked();
  const products = useQuery({ queryKey: ["products"], queryFn: () => api.getProducts({}) });
  const [gran, setGran] = useState<"event" | "month">("event");
  const [excludeTokyo, setExcludeTokyo] = useState(false);
  // Selector filters under 「頒布物を選ぶ」: while on (the default),
  // 廃盤 / 除外 products are left out of the selector's options.
  const [excludeDiscontinued, setExcludeDiscontinued] = useState(true);
  const [excludeUnreliable, setExcludeUnreliable] = useState(true);
  // Prefecture chosen in the breakdown chart; its event list shows below.
  const [openPref, setOpenPref] = useState<string | null>(null);

  // Selector order: effective release date, newest first (unset products
  // sort last via the 2000-01-01 placeholder) — the app-wide convention.
  const list = useMemo(
    () => [...(products.data?.products ?? [])].sort(byReleaseDateDesc),
    [products.data],
  );
  // Options actually offered by the selector after the two filters.
  // When the selected product is filtered out, the section falls back
  // to the first remaining option.
  const options = useMemo(
    () =>
      list.filter(
        (p) =>
          (!excludeDiscontinued || !p.discontinued) &&
          (!excludeUnreliable || !p.salesUnreliable),
      ),
    [list, excludeDiscontinued, excludeUnreliable],
  );
  const current =
    options.find((p) => p.product === props.selected) ?? options[0] ?? null;

  // The selected product's per-date rows, with 東京都 days removed while
  // 東京を省く is on. Every figure in this section (totals, trend,
  // prefecture breakdown and its event list) is derived from these
  // rows, so the whole section re-aggregates consistently.
  const byDate = useMemo(
    () =>
      (current?.byDate ?? []).filter(
        (d) => !excludeTokyo || d.prefecture !== TOKYO,
      ),
    [current, excludeTokyo],
  );

  // Headline totals: the server aggregates normally, re-aggregated from
  // the filtered rows while 東京を省く is on.
  const disp = useMemo(() => {
    if (!current) return null;
    if (!excludeTokyo) {
      return {
        qty: current.qty,
        net: current.net,
        dayCount: current.dayCount,
        firstDate: current.firstDate,
        lastDate: current.lastDate,
      };
    }
    const sorted = [...byDate].sort((a, b) => a.date.localeCompare(b.date));
    return {
      qty: sorted.reduce((s, d) => s + d.qty, 0),
      net: sorted.reduce((s, d) => s + d.net, 0),
      dayCount: sorted.length,
      firstDate: sorted[0]?.date ?? "―",
      lastDate: sorted[sorted.length - 1]?.date ?? "―",
    };
  }, [current, excludeTokyo, byDate]);

  // X-axis tick labels are plain "M/D"; the full date (with year) is
  // shown in the tooltip.
  const trend = useMemo<FocusPoint[]>(() => {
    if (!current) return [];
    const sorted = [...byDate].sort((a, b) => a.date.localeCompare(b.date));
    if (gran === "event") {
      return sorted.map((d) => {
        const [y = "", m = "", day = ""] = d.date.split("-");
        return {
          key: d.date,
          tick: `${Number(m)}/${Number(day)}`,
          dateLabel: `${y}年${Number(m)}月${Number(day)}日`,
          qty: d.qty,
          net: d.net,
          eventName: d.eventName,
          prefecture: d.prefecture ?? "",
          salesUnreliable: d.salesUnreliable,
          isFirst: d.isFirstAppearance,
        };
      });
    }
    const map = new Map<string, FocusPoint>();
    for (const d of sorted) {
      const key = d.date.slice(0, 7);
      let cur = map.get(key);
      if (!cur) {
        const [y = "", m = ""] = key.split("-");
        cur = {
          key,
          tick: `${y}/${Number(m)}`,
          dateLabel: `${y}年${Number(m)}月`,
          qty: 0,
          net: 0,
          eventName: null,
          prefecture: "",
          salesUnreliable: false,
          isFirst: false,
        };
        map.set(key, cur);
      }
      cur.qty += d.qty;
      cur.net += d.net;
    }
    return [...map.values()];
  }, [current, byDate, gran]);

  const prefRows = useMemo<FocusPrefRow[]>(() => {
    if (!current) return [];
    const map = new Map<string, FocusPrefRow>();
    for (const d of byDate) {
      const name = d.prefecture || "未登録";
      const cur = map.get(name) ?? { name, qty: 0, net: 0, days: 0 };
      cur.qty += d.qty;
      cur.net += d.net;
      cur.days += 1;
      map.set(name, cur);
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty);
  }, [current, byDate]);

  // The breakdown selection belongs to one product under one filter
  // setting; changing either closes the event list.
  useEffect(() => {
    setOpenPref(null);
  }, [current?.product, excludeTokyo]);

  // Events where the selected product was sold in the chosen
  // prefecture, oldest first.
  const prefEvents = useMemo(() => {
    if (!openPref) return [];
    return byDate
      .filter((d) => (d.prefecture || "未登録") === openPref)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [byDate, openPref]);

  const showState = products.isPending || Boolean(products.error);
  const hasRefDay = trend.some((p) => p.salesUnreliable);
  const hasFirst = trend.some((p) => p.isFirst);

  return (
    <ChartCard
      anchorId="product-focus-section"
      title="頒布物別グラフ"
      dash={props.dash}
      ariaLabel={
        current && disp
          ? masked
            ? `${current.product}の頒布物別グラフ（スクショモードで数値は非表示）。持ち込みイベントは${disp.dayCount}件です。`
            : `${current.product}の頒布物別グラフ。総冊数 ${qtyFmt(disp.qty)}冊、総売上 ${yen(disp.net)}、持ち込みイベントは${disp.dayCount}件です。`
          : "頒布物別グラフ"
      }
      controls={
        <SegControl
          ariaLabel="頒布物別グラフの単位"
          value={gran}
          options={[
            { id: "event", label: "イベント日別" },
            { id: "month", label: "月別" },
          ]}
          onChange={(v) => setGran(v as "event" | "month")}
        />
      }
      note={
        current ? (
          <div className="mt-2 text-xs text-[var(--dim)]">
            {excludeTokyo && <p>東京都での販売日を除いて集計しています。</p>}
            {gran === "event" && hasFirst && (
              <p>
                <span aria-hidden className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[var(--accent)]" />
                の棒は、その都道府県で初めて頒布を行ったイベントとなります。（一覧で同県で初頒布とマークしているもの）
              </p>
            )}
            {gran === "event" && hasRefDay && (
              <p className="mt-1">斜線の棒は「売上は参考情報の日」です。</p>
            )}
            {prefRows.some((r) => r.name === "未登録") && (
              <p className="mt-1">
                「未登録」はイベント情報が未登録のため都道府県が分からない日です。
              </p>
            )}
          </div>
        ) : undefined
      }
    >
      {showState ? (
        <SectionState pending={products.isPending} error={products.error} />
      ) : list.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--dim)]">頒布物の売上データがありません。</p>
      ) : (
        <div>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--dim)]">
              頒布物を選ぶ（一覧は発行日の新しい順）
            </span>
            <select
              aria-label="グラフを見る頒布物"
              value={current?.product ?? ""}
              disabled={options.length === 0}
              onChange={(e) => props.onSelect(e.target.value)}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base"
            >
              {options.map((p) => (
                <option key={p.product} value={p.product}>
                  {p.product}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={excludeDiscontinued}
                onChange={(e) => setExcludeDiscontinued(e.target.checked)}
                className="h-4 w-4 shrink-0"
              />
              廃盤を外す
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={excludeUnreliable}
                onChange={(e) => setExcludeUnreliable(e.target.checked)}
                className="h-4 w-4 shrink-0"
              />
              除外を外す
            </label>
          </div>

          {!current ? (
            <p className="py-6 text-center text-sm text-[var(--dim)]">
              「廃盤を外す」「除外を外す」の条件により、表示できる頒布物がありません。チェックを外すと表示されます。
            </p>
          ) : (
          <>

          {(current.salesUnreliable || current.discontinued) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {current.salesUnreliable && <span className="stamp">除外</span>}
              {current.discontinued && <span className="stamp">廃盤</span>}
            </div>
          )}

          <div className="mt-2 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-2">
              <p className="text-[11px] tracking-wide text-[var(--dim)]">発行日</p>
              <p className="tnum mt-0.5 text-base font-bold leading-tight">
                {current.releaseDate
                  ? current.releaseDate
                  : "未設定（仮: 2000-01-01）"}
              </p>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-2">
              <p className="text-[11px] tracking-wide text-[var(--dim)]">総冊数</p>
              <p className="tnum mt-0.5 text-base font-bold leading-tight">
                {qtyMasked(disp?.qty ?? 0, masked)}
                <span className="ml-0.5 text-xs font-normal">冊</span>
              </p>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-2">
              <p className="text-[11px] tracking-wide text-[var(--dim)]">総売上</p>
              <p className="tnum mt-0.5 text-base font-bold leading-tight">{yenMasked(disp?.net ?? 0, masked)}</p>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-2">
              <p className="text-[11px] tracking-wide text-[var(--dim)]">持ち込みイベント</p>
              <p className="tnum mt-0.5 text-base font-bold leading-tight">
                {disp?.dayCount ?? 0}
              </p>
            </div>
          </div>
          <p className="tnum mt-1.5 text-xs text-[var(--dim)]">
            販売期間: {disp?.firstDate || "―"} 〜 {disp?.lastDate || "―"} ・ 1日平均{" "}
            {disp && disp.dayCount > 0 ? qtyMasked(disp.qty / disp.dayCount, masked) : "0"}冊
          </p>

          <p className="font-ledger mt-4 mb-1 text-sm font-bold">
            販売推移（{gran === "event" ? "イベント日別" : "月別"}・冊数）
          </p>
          {trend.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--dim)]">販売実績がありません。</p>
          ) : (
            <div className={masked ? "chart-blur" : undefined}>
            <ResponsiveContainer width="100%" height={186}>
              <BarChart data={trend} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
                <HatchDef id="hatchFocus" />
                <XAxis
                  dataKey="tick"
                  tick={{ fontSize: 10, fill: "var(--text)" }}
                  height={24}
                  axisLine={{ stroke: "var(--border)" }}
                  tickLine={false}
                  minTickGap={20}
                />
                <YAxis
                  width={36}
                  tick={{ fontSize: 10, fill: "var(--dim)" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<FocusTooltip />} />
                <Bar dataKey="qty" name="冊数" radius={[4, 4, 0, 0]}>
                  {trend.map((p) => (
                    <Cell
                      key={p.key}
                      fill={
                        gran === "event" && p.isFirst
                          ? "var(--accent)"
                          : gran === "event" && p.salesUnreliable
                            ? "url(#hatchFocus)"
                            : "var(--ai)"
                      }
                      stroke={
                        gran === "event" && p.salesUnreliable ? "var(--dim)" : undefined
                      }
                      strokeWidth={gran === "event" && p.salesUnreliable ? 0.5 : 0}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
          )}

          <div className="mt-2">
            <TokyoToggle checked={excludeTokyo} onChange={setExcludeTokyo} />
          </div>

          <p className="font-ledger mt-4 mb-1 text-sm font-bold">都道府県別の内訳（冊数）</p>
          <p className="mb-1 text-xs text-[var(--dim)]">
            バーやボタンをタップすると、その都道府県での販売イベント一覧が下に表示されます。
          </p>
          {prefRows.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--dim)]">販売実績がありません。</p>
          ) : (
            <div className={masked ? "chart-blur" : undefined}>
            <ResponsiveContainer width="100%" height={Math.max(96, prefRows.length * 32)}>
              <BarChart
                data={prefRows}
                layout="vertical"
                margin={{ left: 8, right: 16, top: 0, bottom: 0 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={76}
                  tick={{ fontSize: 12, fill: "var(--text)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<FocusPrefTooltip />} />
                <Bar dataKey="qty" name="冊数" radius={[0, 4, 4, 0]}>
                  {prefRows.map((r) => (
                    <Cell
                      key={r.name}
                      fill={openPref === r.name ? "var(--accent)" : "var(--ai)"}
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        setOpenPref(openPref === r.name ? null : r.name)
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
          )}

          {prefRows.length > 0 && (
            <div
              className="mt-2 flex flex-wrap gap-1.5"
              role="group"
              aria-label="都道府県ごとのイベント一覧を開く"
            >
              {prefRows.map((r) => (
                <button
                  key={r.name}
                  type="button"
                  aria-pressed={openPref === r.name}
                  onClick={() => setOpenPref(openPref === r.name ? null : r.name)}
                  className={`rounded-full border px-3 py-1.5 text-xs ${
                    openPref === r.name
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] font-bold text-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  {r.name}のイベント一覧
                </button>
              ))}
            </div>
          )}

          {openPref && current && (
            <div className="mt-3 rounded-[var(--radius)] border-2 border-[var(--accent)] bg-[var(--surface-alt)] p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="font-ledger text-sm font-bold">
                  {openPref}で「{current.product}」を販売したイベント（{prefEvents.length}日）
                </p>
                <button
                  type="button"
                  onClick={() => setOpenPref(null)}
                  aria-label="イベント一覧を閉じる"
                  className="shrink-0 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs"
                >
                  閉じる
                </button>
              </div>
              {prefEvents.length === 0 ? (
                <p className="py-2 text-sm text-[var(--dim)]">該当する日がありません。</p>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {prefEvents.map((d) => (
                    <li key={d.date} className="py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="tnum text-sm font-bold">{dateLabel(d.date)}</p>
                        <p className="tnum shrink-0 text-sm">
                          {qtyMasked(d.qty, masked)}冊 ・ {yenMasked(d.net, masked)}
                        </p>
                      </div>
                      <p className="mt-0.5 text-sm">{d.eventName ?? "（イベント未登録）"}</p>
                      {(d.venue || d.city) && (
                        <p className="text-xs text-[var(--dim)]">
                          {[d.venue, d.city].filter(Boolean).join("・")}
                        </p>
                      )}
                      {d.salesUnreliable && (
                        <p className="text-xs text-[var(--dim)]">（売上は参考情報の日）</p>
                      )}
                      {props.onOpenDay && (
                        <button
                          type="button"
                          onClick={() => props.onOpenDay?.(d.date)}
                          className="mt-1 text-xs font-bold text-[var(--accent)] underline"
                        >
                          イベント一覧でこの日を見る
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          </>
          )}
        </div>
      )}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// イベント種別別
// ---------------------------------------------------------------------------

type TypeKey = EventTypeId | "unregistered";

/**
 * Donut colors, assigned by position in the (user-editable) type
 * list: the first six types get the established palette in order,
 * further types cycle through it, and 未登録 is always dim.
 */
const TYPE_PALETTE = [
  "var(--accent)",
  "var(--ai)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

function typeFill(types: EventTypeDef[], id: TypeKey): string {
  if (id === "unregistered") return "var(--dim)";
  const idx = types.findIndex((t) => t.key === id);
  return TYPE_PALETTE[(idx < 0 ? types.length : idx) % TYPE_PALETTE.length] ?? "var(--dim)";
}

interface TypeRow {
  id: TypeKey;
  label: string;
  net: number;
  qty: number;
  days: number;
  refDays: number;
}

function TypeSection({ dash }: { dash?: DashSectionProps }) {
  const masked = useMasked();
  const types = useEventTypes();
  const typeDays = useQuery({
    queryKey: ["typeBreakdownDays"],
    queryFn: () => api.getTypeBreakdownDays({}),
  });
  const [excludeTokyo, setExcludeTokyo] = useState(false);

  const rows = useMemo<TypeRow[]>(() => {
    const map = new Map<TypeKey, TypeRow>();
    const add = (id: TypeKey, label: string): TypeRow => {
      const cur = map.get(id) ?? { id, label, net: 0, qty: 0, days: 0, refDays: 0 };
      map.set(id, cur);
      return cur;
    };
    for (const d of typeDays.data?.days ?? []) {
      if (excludeTokyo && d.prefecture === TOKYO) continue;
      const id: TypeKey =
        d.eventName === null ? "unregistered" : resolveEventType(d.eventName, d.eventType, types);
      const label = id === "unregistered" ? "未登録" : typeLabel(types, id);
      const cur = add(id, label);
      cur.net += d.net;
      cur.qty += d.qty;
      cur.days += 1;
      if (d.salesUnreliable) cur.refDays += 1;
    }
    const order: TypeKey[] = [...types.map((t) => t.key), "unregistered"];
    return [...map.values()]
      .filter((r) => r.days > 0)
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }, [typeDays.data, excludeTokyo, types]);

  const totalNet = rows.reduce((s, r) => s + r.net, 0);
  const refDays = rows.reduce((s, r) => s + r.refDays, 0);
  const showState = typeDays.isPending || Boolean(typeDays.error);

  return (
    <ChartCard
      title="イベント種別別の内訳（売上）"
      dash={dash}
      dashLabel="イベント種別別の内訳"
      ariaLabel={
        masked
          ? "イベント種別別の売上内訳の円グラフ（スクショモードで数値は非表示）"
          : `イベント種別別の売上内訳の円グラフ。合計 ${yen(totalNet)}。${rows
              .map((r) => `${r.label} ${yen(r.net)}`)
              .join("、")}`
      }
      controls={<TokyoToggle checked={excludeTokyo} onChange={setExcludeTokyo} />}
      note={
        <div className="mt-2">
          {excludeTokyo && (
            <p className="mb-1 text-xs text-[var(--dim)]">東京都での販売日を除いて集計しています。</p>
          )}
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.id} className="flex items-baseline gap-2 text-sm">
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 translate-y-0.5 rounded-sm"
                  style={{ background: typeFill(types, r.id) }}
                />
                <span className="min-w-0 flex-1">
                  {r.label}
                  <span className="tnum ml-1 text-xs text-[var(--dim)]">
                    {r.days}日{r.refDays > 0 ? `（うち参考情報${r.refDays}日）` : ""}
                  </span>
                </span>
                <span className="tnum shrink-0 text-right">
                  <span className="font-bold">{yenMasked(r.net, masked)}</span>
                  <span className="ml-1 text-xs text-[var(--dim)]">
                    {totalNet > 0 ? (masked ? "***%" : pctFmt(r.net / totalNet)) : ""}・
                    {qtyMasked(r.qty, masked)}冊
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--dim)]">
            種別はイベント名からの推定です（手動設定した日はそちらで集計）。
            {refDays > 0 &&
              `「売上は参考情報」の日（${refDays}日）も含めた内訳です。`}
          </p>
        </div>
      }
    >
      {showState ? (
        <SectionState pending={typeDays.isPending} error={typeDays.error} />
      ) : rows.length === 0 || totalNet <= 0 ? (
          <p className="py-6 text-center text-sm text-[var(--dim)]">集計できるデータがありません。</p>
        ) : (
          <div className={masked ? "chart-blur" : undefined}>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, name) => [yen(Number(v ?? 0)), name]}
              />
              <Pie
                data={rows}
                dataKey="net"
                nameKey="label"
                innerRadius="45%"
                outerRadius="80%"
                paddingAngle={1}
                stroke="var(--surface)"
                strokeWidth={2}
              >
                {rows.map((r) => (
                  <Cell key={r.id} fill={typeFill(types, r.id)} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          </div>
        )}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// ダッシュボード tab root: サマリー → 年別売上 → グラフ群 → 都市別。
// Every card-sized section is collapsible from its header and can be
// moved up / down with the header buttons; the order and collapsed
// state persist in localStorage (DashboardSection.tsx).
// ---------------------------------------------------------------------------

/** Dashboard section ids, in their default (original) order. */
const DASHBOARD_SECTION_IDS = [
  "summary",
  "yearly",
  "productFocus",
  "trend",
  "pref",
  "ranking",
  "type",
  "cities",
] as const;

export function ChartsView(props: { onOpenDay?: (date: string) => void }) {
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api.getOverview({}) });
  const days = overview.data?.days ?? [];
  const [focusProduct, setFocusProduct] = useState<string | null>(null);
  const { order, propsFor } = useDashboardLayout(DASHBOARD_SECTION_IDS);

  const jumpToProduct = (name: string) => {
    setFocusProduct(name);
    window.setTimeout(() => {
      document
        .getElementById("product-focus-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  };

  const citiesDash = propsFor("cities");
  const trendDash = propsFor("trend");

  const nodes: Record<string, ReactNode> = {
    summary: overview.data ? (
      <SummaryBand
        key="summary"
        data={overview.data}
        part="totals"
        dash={propsFor("summary")}
      />
    ) : null,
    yearly: overview.data ? (
      <SummaryBand
        key="yearly"
        data={overview.data}
        part="yearly"
        yearlyDash={propsFor("yearly")}
      />
    ) : null,
    productFocus: (
      <ProductFocusSection
        key="productFocus"
        selected={focusProduct}
        onSelect={setFocusProduct}
        onOpenDay={props.onOpenDay}
        dash={propsFor("productFocus")}
      />
    ),
    trend: overview.data ? (
      days.length === 0 ? (
        // No sales yet: the trend slot is an empty-state card, but
        // it still carries the section header (collapse + move)
        // like every other dashboard section.
        <section
          key="trend"
          aria-label="売上推移"
          className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CollapsibleTitle title="売上推移" dash={trendDash} />
            <MoveButtons label="売上推移" dash={trendDash} />
          </div>
          {!trendDash.collapsed && (
            <p className="px-4 py-8 text-center text-sm text-[var(--dim)]">
              まだ売上データがありません。各種CSVを取り込むとグラフが表示されます。
            </p>
          )}
        </section>
      ) : (
        <TrendSection key="trend" days={days} dash={trendDash} />
      )
    ) : null,
    pref: <PrefSection key="pref" dash={propsFor("pref")} />,
    ranking: (
      <ProductsSection
        key="ranking"
        onSelect={jumpToProduct}
        selected={focusProduct}
        dash={propsFor("ranking")}
      />
    ),
    type: <TypeSection key="type" dash={propsFor("type")} />,
    cities: (
      <section
        key="cities"
        aria-label="都市別"
        className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3"
      >
        <div
          className={`flex flex-wrap items-center justify-between gap-2 ${
            citiesDash.collapsed ? "" : "mb-2"
          }`}
        >
          <CollapsibleTitle title="都市別" dash={citiesDash} />
          <MoveButtons label="都市別" dash={citiesDash} />
        </div>
        {/* CitiesView stays mounted while collapsed (hidden only),
            so its 都道府県／都市 filters and open city survive a
            collapse / expand cycle. */}
        <div className={citiesDash.collapsed ? "hidden" : undefined}>
          <CitiesView />
        </div>
      </section>
    ),
  };

  return (
    <div>
      <SectionState pending={overview.isPending} error={overview.error} />
      {order.map((id) => nodes[id] ?? null)}
    </div>
  );
}
