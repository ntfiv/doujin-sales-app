import { useEffect, useState } from "react";

/**
 * ダッシュボードのセクション並び順・開閉状態 (dashboard layout):
 * the ダッシュボード tab is a stack of card-sized sections (サマリー,
 * 年別売上, 頒布物別グラフ, 売上推移, 都道府県別, 頒布物ランキング,
 * イベント種別別の内訳, 都市別). Each section header can collapse /
 * expand the section, and 上へ / 下へ buttons in the header swap it
 * with its neighbour. Both the order and the collapsed set persist
 * in localStorage (display-only, like the screenshot mode in
 * mask.tsx) so the arrangement survives reloads; no stored sales
 * data is ever touched.
 */

const ORDER_KEY = "dashboard-section-order";
const COLLAPSED_KEY = "dashboard-section-collapsed";

export interface DashSectionProps {
  collapsed: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggleCollapse: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function readOrder(defaultOrder: readonly string[]): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [...defaultOrder];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...defaultOrder];
    const known = parsed.filter(
      (v): v is string => typeof v === "string" && defaultOrder.includes(v),
    );
    // Sections added after the stored order was saved join at the
    // end, in their default position relative to each other.
    const missing = defaultOrder.filter((id) => !known.includes(id));
    return [...known, ...missing];
  } catch {
    return [...defaultOrder];
  }
}

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === true) out[k] = true;
    }
    return out;
  } catch {
    return {};
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode etc.) — the layout still
    // applies for this session.
  }
}

export function useDashboardLayout(defaultOrder: readonly string[]) {
  const [order, setOrder] = useState<string[]>(() => readOrder(defaultOrder));
  const [collapsedMap, setCollapsedMap] =
    useState<Record<string, boolean>>(readCollapsed);

  useEffect(() => {
    write(ORDER_KEY, JSON.stringify(order));
  }, [order]);
  useEffect(() => {
    write(COLLAPSED_KEY, JSON.stringify(collapsedMap));
  }, [collapsedMap]);

  const move = (id: string, dir: -1 | 1) => {
    setOrder((prev) => {
      const idx = prev.indexOf(id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      const a = copy[idx];
      const b = copy[next];
      if (a === undefined || b === undefined) return prev;
      copy[idx] = b;
      copy[next] = a;
      return copy;
    });
  };

  const toggle = (id: string) => {
    setCollapsedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  /** Header props for one section, derived from the current order. */
  const propsFor = (id: string): DashSectionProps => {
    const idx = order.indexOf(id);
    return {
      collapsed: Boolean(collapsedMap[id]),
      isFirst: idx <= 0,
      isLast: idx < 0 || idx >= order.length - 1,
      onToggleCollapse: () => toggle(id),
      onMoveUp: () => move(id, -1),
      onMoveDown: () => move(id, 1),
    };
  };

  return { order, propsFor };
}

/** 上へ / 下へ buttons for a section header. */
export function MoveButtons(props: {
  label: string;
  dash: DashSectionProps;
}) {
  const { dash, label } = props;
  const btn =
    "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs leading-none disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <span className="flex shrink-0 gap-1">
      <button
        type="button"
        aria-label={`「${label}」を上へ移動`}
        disabled={dash.isFirst}
        onClick={dash.onMoveUp}
        className={btn}
      >
        <span aria-hidden>↑</span>
      </button>
      <button
        type="button"
        aria-label={`「${label}」を下へ移動`}
        disabled={dash.isLast}
        onClick={dash.onMoveDown}
        className={btn}
      >
        <span aria-hidden>↓</span>
      </button>
    </span>
  );
}

/**
 * Section title that doubles as the collapse toggle: the heading
 * itself is a button (accordion pattern), with a chevron showing
 * the open / closed state next to the title text.
 */
export function CollapsibleTitle(props: {
  title: string;
  dash: DashSectionProps;
}) {
  const { title, dash } = props;
  return (
    <h2 className="font-ledger min-w-0 text-sm font-bold">
      <button
        type="button"
        aria-expanded={!dash.collapsed}
        aria-label={`「${title}」を${dash.collapsed ? "開く" : "折りたたむ"}`}
        onClick={dash.onToggleCollapse}
        className="flex min-w-0 items-center gap-1.5 text-left"
      >
        <span
          aria-hidden
          className="shrink-0 text-[10px] text-[var(--dim)]"
        >
          {dash.collapsed ? "▶" : "▼"}
        </span>
        <span className="min-w-0">{title}</span>
      </button>
    </h2>
  );
}
