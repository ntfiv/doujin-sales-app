import { useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { DaySummary } from "./Ledger";
import { dateLabel, datePlain, qtyMasked } from "./format";
import { useMasked } from "./mask";

/**
 * 過去の頒布数を比較表 (event copy-count comparison).
 *
 * Rows are the products sold on at least one of the checked days;
 * columns are the checked days (in the ledger's display order).
 * Cells show copy counts ONLY — no money anywhere in this table.
 * There is no per-product totals column (row direction), but a
 * footer row totals each event column (column direction). A
 * product with no sales row on a day renders as 「―」 so "not
 * sold there" is distinguishable from a recorded 0.
 *
 * Data comes from the existing getProducts action (per-product
 * per-date breakdown); 『任意の金額』 is excluded there as always,
 * since it is not a product. No new action or schema is involved.
 *
 * A cell whose day is the product's first appearance in that
 * event's prefecture (同県で初頒布 — the same judgement as the
 * badge elsewhere: first sale in the prefecture, released after
 * the previous participation there) renders its count in red
 * (the accent color) so first-in-prefecture days stand out.
 *
 * Column widths (all viewports): the title column is fixed at
 * 25% of the table width and every event column gets an explicit
 * equal share of the remaining 75% (75 / number of days, set
 * inline on each <col>). Relying on unspecified columns sharing
 * the leftover space evenly proved unreliable — a long event
 * name in a header could stretch its column — so the widths are
 * pinned explicitly and the header event name wraps anywhere
 * (break-all) to fit its column instead.
 *
 * Narrow screens (see .compare-table in theme.css): the table's
 * minimum width grows with the number of compared days (driven
 * by the --compare-cols custom property set below) so date
 * headers are never crushed, and the table scrolls sideways with
 * the product column stuck to the left edge — the 25% / equal
 * split ratios hold against that wider table width, so the
 * proportions survive the scroll. Cell padding and type are also
 * tightened one step via the sm: variants in the markup.
 */
export function CompareTable({ days }: { days: DaySummary[] }) {
  const masked = useMasked();
  // 「廃盤を外す」「除外を外す」: both default ON, same behavior as
  // the same-named checkboxes on the dashboard's per-product chart —
  // while ON, products with that flag are dropped from the rows.
  const [excludeDiscontinued, setExcludeDiscontinued] = useState(true);
  const [excludeUnreliable, setExcludeUnreliable] = useState(true);
  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: () => api.getProducts({}),
    enabled: days.length > 0,
  });

  const selectedDates = useMemo(() => days.map((d) => d.date), [days]);
  const selectedSet = useMemo(() => new Set(selectedDates), [selectedDates]);

  const rows = useMemo(() => {
    const products = (productsQuery.data?.products ?? []).filter(
      (p) =>
        (!excludeDiscontinued || !p.discontinued) &&
        (!excludeUnreliable || !p.salesUnreliable),
    );
    const built = products
      .map((p) => {
        const byDate = new Map(
          p.byDate.map((r) => [r.date, { qty: r.qty, isFirst: r.isFirstAppearance }]),
        );
        const cells = selectedDates.map((date) => byDate.get(date) ?? null);
        const total = cells.reduce<number>((s, c) => s + (c?.qty ?? 0), 0);
        return { product: p.product, cells, total };
      })
      .filter((r) => r.cells.some((c) => c !== null));
    // Most copies across the compared days first (the product list's
    // usual 冊数順）; ties by name so the order is stable.
    built.sort((a, b) => b.total - a.total || a.product.localeCompare(b.product, "ja"));
    return built;
  }, [productsQuery.data, selectedDates, excludeDiscontinued, excludeUnreliable]);

  // Whether any product row would exist without the 廃盤/除外
  // filters — used to pick the right empty-state message.
  const hasUnfilteredRows = useMemo(
    () =>
      (productsQuery.data?.products ?? []).some((p) =>
        p.byDate.some((r) => selectedSet.has(r.date)),
      ),
    [productsQuery.data, selectedSet],
  );

  // Per-event column totals for the footer row (over the displayed
  // products only, after the 廃盤/除外 filters).
  const dayTotals = useMemo(
    () =>
      selectedDates.map((_, i) =>
        rows.reduce<number>((s, r) => s + (r.cells[i]?.qty ?? 0), 0),
      ),
    [rows, selectedDates],
  );

  return (
    <section
      aria-label="過去の頒布数を比較"
      className="mt-4 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="px-4 pt-3 pb-2">
        <h2 className="font-ledger text-base font-bold">過去の頒布数を比較</h2>
        {days.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--dim)]">
            下の一覧で、売上がある日の左のチェックを入れてください（売上がない日は比較対象に選べません）。
          </p>
        ) : (
          <p className="mt-1 text-sm text-[var(--dim)]">
            <span className="tnum">{days.length}件</span>
            のイベントの頒布冊数を比較中（金額は表示しません）。「―」は販売記録なし、赤字は同県で初頒布の冊数です。
          </p>
        )}
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
        {days.length > 0 && (
          <p className="mt-2 text-xs text-[var(--dim)] sm:hidden">
            表は横にスクロールできます（頒布物名は左端に固定）。
          </p>
        )}
      </div>

      {days.length > 0 && productsQuery.isPending && (
        <p className="px-4 pb-4 text-sm text-[var(--dim)]">頒布物の一覧を読み込み中…</p>
      )}
      {days.length > 0 && productsQuery.error && (
        <div className="px-4 pb-4">
          <p role="alert" className="text-sm text-[var(--accent)]">
            頒布物の一覧を読み込めませんでした：{String(productsQuery.error)}
          </p>
          <button
            type="button"
            className="mt-2 rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-sm"
            onClick={() => void productsQuery.refetch()}
          >
            再読み込み
          </button>
        </div>
      )}
      {days.length > 0 && productsQuery.data && rows.length === 0 && (
        <p className="px-4 pb-4 text-sm text-[var(--dim)]">
          {hasUnfilteredRows
            ? "「廃盤を外す」「除外を外す」の条件で表示できる頒布物がありません。"
            : "選ばれたイベントには頒布物の販売記録がありません。"}
        </p>
      )}
      {/* The table scroller carries overscroll-x-contain: a
          horizontal swipe on the table must not chain to the page
          when the table reaches its edge. The page's own scroller
          (the SDK's fixed [data-generated-space-root] box) is
          locked sideways in theme.css — overflow-x clip,
          overscroll-behavior-x none, touch-action pan-y — so a
          swipe outside the table cannot pan the page either.
          max-w-full keeps this scroller itself inside the card. */}
      {days.length > 0 && productsQuery.data && rows.length > 0 && (
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
          <table
            className="compare-table w-full table-fixed text-[13px] sm:text-sm"
            style={{ "--compare-cols": days.length } as CSSProperties}
          >
            <colgroup>
              {/* タイトル列は全体の25％に固定し、残りの75％は
                  イベント列が厳密に等分する。各列に明示的に幅を
                  与える（幅指定なしの列同士の自動等分は、長い
                  イベント名の見出しに引っ張られて崩れることが
                  あるため）。 */}
              <col style={{ width: "25%" }} />
              {days.map((d) => (
                <col key={d.date} style={{ width: `${75 / days.length}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-y border-[var(--border)] bg-[var(--surface-alt)] text-left align-top">
                <th scope="col" className="sticky left-0 z-10 bg-[var(--surface-alt)] px-2 py-2 font-medium max-sm:shadow-[3px_0_5px_-3px_rgba(0,0,0,0.3)] sm:px-3">
                  頒布物
                </th>
                {days.map((d) => (
                  <th key={d.date} scope="col" className="px-1.5 py-2 text-right font-medium sm:px-2">
                    <span className="tnum block text-[11px] whitespace-nowrap sm:text-xs">
                      {datePlain(d.date)}
                    </span>
                    {/* break-all: a long event name wraps mid-word
                        to fit the strictly equal column width
                        instead of stretching the column. */}
                    <span className="block text-[11px] leading-tight font-normal break-all text-[var(--dim)]">
                      {d.eventName ?? "イベント未登録"}
                    </span>
                    <span className="sr-only">{dateLabel(d.date)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const max = Math.max(
                  ...r.cells.map((c) => c?.qty ?? Number.NEGATIVE_INFINITY),
                );
                return (
                  <tr key={r.product} className="border-b border-[var(--border)]/50">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-[var(--surface)] px-2 py-1.5 text-left font-normal break-words max-sm:shadow-[3px_0_5px_-3px_rgba(0,0,0,0.3)] sm:px-3"
                    >
                      {r.product}
                    </th>
                    {r.cells.map((c, i) => (
                      <td
                        key={selectedDates[i]}
                        className={`tnum px-1.5 py-1.5 text-right align-top sm:px-2 ${
                          c === null
                            ? "text-[var(--dim)]"
                            : `${c.isFirst ? "text-[var(--accent)]" : ""}${
                                c.qty === max && days.length > 1 ? " font-bold" : ""
                              }`
                        }`}
                      >
                        {c === null ? "―" : qtyMasked(c.qty, masked)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <th scope="row" className="sticky left-0 z-10 bg-[var(--surface)] px-2 py-1.5 text-left max-sm:shadow-[3px_0_5px_-3px_rgba(0,0,0,0.3)] sm:px-3">
                  合計
                </th>
                {dayTotals.map((t, i) => (
                  <td key={selectedDates[i]} className="tnum px-1.5 py-1.5 text-right sm:px-2">
                    {qtyMasked(t, masked)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {days.length > 0 && productsQuery.data && rows.length > 0 && (
        <p className="px-4 pt-1 pb-3 text-xs text-[var(--dim)]">
          合計はこの表に並んだ頒布物の冊数のみ（『任意の金額』は含みません）。各行で一番多い冊数は太字です。
        </p>
      )}
    </section>
  );
}
