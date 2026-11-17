import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api } from "./api";
import { withViewTransition } from "./transitions";
import { DayRow, NewEventSection } from "./Ledger";
import { CompareTable } from "./Compare";
import { ProductsView } from "./Products";
import { ChartsView } from "./Charts";
import { CsvImportSettingsSection, CsvImportView, DataExportSection, DataResetSection, DisplaySettingsSection, EventCsvImportSection, MasterReplaceSection, ScreenshotModeSection } from "./DataTools";
import { ProductAdminSections } from "./ProductAdmin";
import { UnregisteredView } from "./Unregistered";
import { EventTypeManageSection, EventTypeSection } from "./EventAdmin";
import { resolveEventType, useEventTypes, type EventTypeId } from "./eventType";
import { PlaceFilter, orderPrefectures, prefectureCounts } from "./PlaceFilter";
import { matchesPlaceName, matchesQuery } from "./search";
import { dateLabelNoWeekday } from "./format";
import { MaskProvider } from "./mask";
import { DisplaySettingsProvider } from "./display";
import { HelpView } from "./Help";

type Tab = "ledger" | "products" | "charts" | "data";

/**
 * What the main area shows: one of the four tabs, or one of the
 * dedicated views reached from the top-right shortcut buttons
 * (使い方 = the usage guide, 設定 = screenshot mode, CSV取込 = the
 * CSV import page).
 */
type View = Tab | "help" | "settings" | "csv";

/** Sub-tab inside the データ管理 tab. */
type DataSubTab = "products" | "events" | "general";

/** Ledger event-type filter value: "" = all, "unregistered" = イベント未登録の日. */
type TypeFilter = "" | EventTypeId | "unregistered";

const TABS: { id: Tab; label: string }[] = [
  { id: "ledger", label: "イベント一覧" },
  { id: "products", label: "頒布物一覧" },
  { id: "charts", label: "ダッシュボード" },
  { id: "data", label: "データ管理" },
];

const DATA_SUB_TABS: { id: DataSubTab; label: string }[] = [
  { id: "products", label: "頒布物管理" },
  { id: "events", label: "イベント管理" },
  { id: "general", label: "総合管理" },
];

export function App() {
  const [view, setViewState] = useState<View>("ledger");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // View switches cross-fade via a same-document view transition
  // (skipped automatically for reduced-motion users).
  const setView = (next: View) => withViewTransition(() => setViewState(next));

  // WAI-ARIA tabs pattern: arrow keys move between tabs (with
  // automatic activation), Home/End jump to the ends. Roving
  // tabindex keeps only the selected tab in the tab order; when a
  // dedicated view （設定 / CSV取込） is showing, no tab is selected
  // and the first tab stays reachable.
  const onTablistKeyDown = (e: KeyboardEvent) => {
    const idx = TABS.findIndex((t) => t.id === view);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = idx < 0 ? 0 : (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft")
      next = idx < 0 ? TABS.length - 1 : (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = TABS[next];
    if (!target) return;
    setView(target.id);
    tabRefs.current[next]?.focus();
  };
  const [dataSubTab, setDataSubTab] = useState<DataSubTab>("products");
  const [year, setYear] = useState<string>("");
  const [query, setQuery] = useState("");
  const [pref, setPref] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [openDay, setOpenDay] = useState<string | null>(null);
  // 過去の頒布数を比較モード: while on, each ledger row for a day
  // WITH sales carries a checkbox and the comparison table renders
  // above the list. Days without sales (event registration only)
  // get no checkbox and can never be comparison targets.
  // `compareDates` holds the checked dates; entering the mode —
  // and any later change to the filtered list — auto-checks the
  // top sales days of the currently displayed (filtered) list.
  // How many days get auto-checked depends on the viewport width:
  // phone widths (the same <640px breakpoint as the compare
  // table's phone layout in theme.css) get the top 3, wider
  // screens the top 5.
  const [compareMode, setCompareMode] = useState(false);
  const [compareDates, setCompareDates] = useState<string[]>([]);
  const [compareAutoCount, setCompareAutoCount] = useState<number>(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 639px)").matches
      ? 3
      : 5,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setCompareAutoCount(mq.matches ? 3 : 5);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Jump from a chart to one day in the ledger: clear the ledger
  // filters so the day is visible, open its detail, switch tabs, and
  // scroll the (highlighted) day row into view so its position in the
  // list is obvious.
  const openLedgerDay = (date: string) => {
    setYear("");
    setQuery("");
    setPref("");
    setCityQuery("");
    setTypeFilter("");
    setOpenDay(date);
    setView("ledger");
    window.setTimeout(() => {
      document
        .querySelector(`[data-day="${date}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  };

  // Jump from 売上を取り込む's 頒布物設定CSV section to the
  // データのエクスポート section (データ管理 > 総合管理）: switch
  // tabs, then scroll the export section into view once rendered.
  const openExportSection = () => {
    setDataSubTab("general");
    setView("data");
    window.setTimeout(() => {
      document
        .querySelector("#dt-export-section")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
  };

  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api.getOverview({}) });
  const types = useEventTypes();

  const years = useMemo(
    () => (overview.data?.years ?? []).map((y) => y.year),
    [overview.data],
  );
  const prefOptions = useMemo(
    () => orderPrefectures((overview.data?.days ?? []).map((d) => d.prefecture)),
    [overview.data],
  );
  // Past participation per prefecture, so visited prefectures get
  // the 「（n回）」 mark in the dropdown.
  const prefCounts = useMemo(
    () => prefectureCounts(overview.data?.days ?? []),
    [overview.data],
  );
  const filterActive = Boolean(query.trim() || pref || cityQuery.trim() || typeFilter);
  const filteredDays = useMemo(() => {
    const days = overview.data?.days ?? [];
    return days.filter(
      (d) =>
        (!year || d.date.startsWith(year)) &&
        matchesQuery(query, d.eventName, d.venue, d.note) &&
        matchesPlaceName(pref, d.prefecture) &&
        matchesPlaceName(cityQuery, d.city) &&
        (typeFilter === ""
          ? true
          : typeFilter === "unregistered"
            ? d.eventName === null
            : d.eventName !== null &&
              resolveEventType(d.eventName, d.eventType, types) === typeFilter),
    );
  }, [overview.data, year, query, pref, cityQuery, typeFilter, types]);

  // Auto-check for 過去の頒布数を比較： entering compare mode, or
  // changing the search / filters while in it, checks the top days
  // WITH SALES of the filtered list — the top 3 on phone widths,
  // the top 5 on wider screens (compareAutoCount). Days without
  // sales are never auto-checked. The dependency is the eligible
  // (sales) dates joined into a string, so a background refetch
  // returning the same list does NOT reset the user's manual
  // checks — only an actual change to which sales days are
  // displayed (or to the auto-check count when the viewport
  // crosses the breakpoint) does.
  const filteredSalesDatesKey = filteredDays
    .filter((d) => d.hasSales)
    .map((d) => d.date)
    .join(",");
  useEffect(() => {
    if (!compareMode) return;
    setCompareDates(
      filteredSalesDatesKey.split(",").filter(Boolean).slice(0, compareAutoCount),
    );
    // filteredSalesDatesKey and compareAutoCount fully determine
    // the auto-checked set; filteredDays is intentionally not a
    // dependency (see the note above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode, filteredSalesDatesKey, compareAutoCount]);

  const toggleCompareDate = (date: string) => {
    // Only days with sales can be comparison targets; a day
    // without sales has no checkbox, and this guard keeps it
    // unselectable even if a stale date lingers in state.
    const day = filteredDays.find((d) => d.date === date);
    if (day && !day.hasSales) return;
    setCompareDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date],
    );
  };
  // Checked days in the ledger's display order (the table's column
  // order follows the list, not the order boxes were ticked).
  // Restricted to days with sales, like the checkboxes themselves.
  const compareDays = useMemo(
    () => filteredDays.filter((d) => d.hasSales && compareDates.includes(d.date)),
    [filteredDays, compareDates],
  );

  const data = overview.data;

  return (
    <MaskProvider>
    <DisplaySettingsProvider>
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <main className="mx-auto w-full max-w-3xl px-4 pb-10">
        {/* Totals band */}
        {overview.isPending && (
          <p className="py-10 text-center text-sm text-[var(--dim)]">台帳を読み込み中…</p>
        )}
        {overview.error && (
          <div className="py-10 text-center">
            <p role="alert" className="text-sm text-[var(--accent)]">
              台帳を読み込めませんでした：{String(overview.error)}
            </p>
            <button
              type="button"
              className="mt-3 rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm"
              onClick={() => void overview.refetch()}
            >
              再読み込み
            </button>
          </div>
        )}
        {data && (
          <>
            {/* Registration status. The grand-totals band and the
                per-year chart that used to sit here now live at the
                top of the ダッシュボード tab (SummaryBand.tsx). */}
            <section aria-label="登録状況" className="flex items-start justify-between gap-3 pt-5">
              <p className="font-ledger flex flex-wrap gap-x-5 gap-y-1 text-[10px] font-bold">
                <span>
                  最終登録日：
                  <span className="tnum">
                    {data.lastRegisteredDate ? dateLabelNoWeekday(data.lastRegisteredDate) : "―"}
                  </span>
                </span>
                <span>
                  登録件数：
                  <span className="tnum">{data.registeredCount.toLocaleString("ja-JP")}件</span>
                </span>
              </p>
              {/* Top-right shortcuts to the dedicated views:
                  使い方 (usage guide), 設定 (screenshot mode) and
                  CSV取込 (CSV import). */}
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  aria-pressed={view === "help"}
                  onClick={() => setView("help")}
                  className={`rounded-[var(--radius)] border px-2.5 py-1 text-xs font-medium ${
                    view === "help"
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] font-bold text-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  使い方
                </button>
                <button
                  type="button"
                  aria-pressed={view === "settings"}
                  onClick={() => setView("settings")}
                  className={`rounded-[var(--radius)] border px-2.5 py-1 text-xs font-medium ${
                    view === "settings"
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] font-bold text-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  設定
                </button>
                <button
                  type="button"
                  aria-pressed={view === "csv"}
                  onClick={() => setView("csv")}
                  className={`rounded-[var(--radius)] border px-2.5 py-1 text-xs font-medium ${
                    view === "csv"
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] font-bold text-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  売上を取り込む
                </button>
              </div>
            </section>

            {/* Tabs (WAI-ARIA tabs pattern): the selected tab is
                marked with aria-selected and, beyond color, with a
                bold label; its accent fill runs to the tab bar's
                bottom edge. Inactive
                panels stay mounted but hidden. */}
            <div className="sticky top-0 z-10 -mx-4 mt-4 bg-[var(--bg)] px-4 py-2">
              <div
                role="tablist"
                aria-label="表示切替"
                onKeyDown={onTablistKeyDown}
                className="grid grid-cols-4 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]"
              >
                {TABS.map((t, i) => (
                  <button
                    key={t.id}
                    ref={(el) => {
                      tabRefs.current[i] = el;
                    }}
                    type="button"
                    role="tab"
                    id={`tab-${t.id}`}
                    aria-selected={view === t.id}
                    aria-controls={`panel-${t.id}`}
                    tabIndex={view === t.id || (i === 0 && !TABS.some((x) => x.id === view)) ? 0 : -1}
                    onClick={() => setView(t.id)}
                    className={`whitespace-nowrap px-0.5 py-2 text-[10px] font-medium sm:text-sm ${
                      view === t.id
                        ? "bg-[var(--accent)] font-bold text-white"
                        : "text-[var(--text)]"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              role="tabpanel"
              id="panel-ledger"
              aria-labelledby="tab-ledger"
              hidden={view !== "ledger"}
            >
              {view === "ledger" && (
              <section aria-label="イベント一覧">
                <div>
                  {/* イベント名検索とイベント種別を横並びに（検索欄が
                      やや広め）。スマホ幅でも1行に収まるよう、両方
                      とも min-w-0 で縮められるようにする。 */}
                  <div className="flex gap-2">
                  <input
                    type="search"
                    aria-label="イベント名・開催施設・メモで検索"
                    placeholder="イベント名・施設名で検索（例：コミティア／COMITIA）"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="min-w-0 flex-[3] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base"
                  />
                  <div className="relative min-w-0 flex-[2]">
                    <select
                      id="ledger-search-type"
                      aria-label="イベント種別で絞り込み"
                      className="w-full appearance-none rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 pr-9 text-base text-[var(--text)]"
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                    >
                      <option value="">イベント種別：すべて</option>
                      {types.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                      <option value="unregistered">未登録</option>
                    </select>
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-[var(--dim)]"
                    >
                      ▼
                    </span>
                  </div>
                  </div>
                  <div className="mt-2">
                    <PlaceFilter
                      idPrefix="ledger-search"
                      prefectures={prefOptions}
                      pref={pref}
                      onPrefChange={setPref}
                      city={cityQuery}
                      onCityChange={setCityQuery}
                      prefCounts={prefCounts}
                    />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="年で絞り込み">
                  <button
                    type="button"
                    aria-pressed={year === ""}
                    onClick={() => setYear("")}
                    className={`rounded-full border px-3 py-1.5 text-xs ${
                      year === ""
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] font-bold text-[var(--accent)]"
                        : "border-[var(--border)] bg-[var(--surface)]"
                    }`}
                  >
                    全期間
                  </button>
                  {years.map((y) => (
                    <button
                      key={y}
                      type="button"
                      aria-pressed={year === y}
                      onClick={() => setYear(year === y ? "" : y)}
                      className={`tnum rounded-full border px-3 py-1.5 text-xs ${
                        year === y
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] font-bold text-[var(--accent)]"
                          : "border-[var(--border)] bg-[var(--surface)]"
                      }`}
                    >
                      {y}年
                    </button>
                  ))}
                  </div>
                  {/* 過去の頒布数を比較 toggle, to the right of the period
                      (year) selection as requested. Pressing it
                      again returns to the normal list. Sized exactly
                      like the standard action buttons elsewhere in
                      the app (e.g. 「頒布物を統合」 in 頒布物一覧）:
                      radius token (not a pill), px-3 py-1.5, text-sm
                      font-medium. */}
                  <button
                    type="button"
                    aria-pressed={compareMode}
                    onClick={() => setCompareMode((v) => !v)}
                    className={`ml-auto rounded-[var(--radius)] border px-3 py-1.5 text-sm font-medium ${
                      compareMode
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border-[var(--border)] bg-[var(--surface)]"
                    }`}
                  >
                    過去の頒布数を比較
                  </button>
                </div>
                {compareMode && (
                  <p className="mt-1 text-xs text-[var(--dim)]">
                    比較モード：イベント一覧の左にあるチェックで比べるイベントを選択出来ます。（検索条件の上位{compareAutoCount}件が自動選択されています）
                  </p>
                )}

                {/* 過去の頒布数を比較表 sits ABOVE the day list: with many
                    events the table would otherwise be far below
                    the fold. */}
                {compareMode && <CompareTable days={compareDays} />}

                <div className="mt-3 overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
                  {filteredDays.map((d) => (
                    <DayRow
                      key={d.date}
                      day={d}
                      open={openDay === d.date}
                      onToggle={() =>
                        withViewTransition(() =>
                          setOpenDay(openDay === d.date ? null : d.date),
                        )
                      }
                      compareMode={compareMode}
                      compareChecked={compareDates.includes(d.date)}
                      onCompareChange={() => toggleCompareDate(d.date)}
                      hideOtherTypeBadge
                    />
                  ))}
                  {filteredDays.length === 0 && (
                    <p className="bg-[var(--surface)] px-4 py-8 text-center text-sm text-[var(--dim)]">
                      {filterActive
                        ? "検索条件に合う日がありません。表記を変えて（ひらがな／英字など）試してみてください。"
                        : "この期間の売上はありません。"}
                    </p>
                  )}
                </div>
              </section>
              )}
            </div>

            <div
              role="tabpanel"
              id="panel-products"
              aria-labelledby="tab-products"
              hidden={view !== "products"}
            >
              {view === "products" && <ProductsView />}
            </div>
            <div
              role="tabpanel"
              id="panel-charts"
              aria-labelledby="tab-charts"
              hidden={view !== "charts"}
            >
              {view === "charts" && <ChartsView onOpenDay={openLedgerDay} />}
            </div>
            <div
              role="tabpanel"
              id="panel-data"
              aria-labelledby="tab-data"
              hidden={view !== "data"}
            >
              {view === "data" && (
                <section aria-label="データ管理">
                  {/* Sub-tabs dividing データ管理 into 頒布物管理 / イベント管理 */}
                  <div
                    role="group"
                    aria-label="データ管理の内訳"
                    className="mb-4 grid grid-cols-3 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]"
                  >
                    {DATA_SUB_TABS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={dataSubTab === t.id}
                        onClick={() => withViewTransition(() => setDataSubTab(t.id))}
                        className={`px-2 py-2 text-sm font-medium ${
                          dataSubTab === t.id
                            ? "bg-[var(--accent-soft)] font-bold text-[var(--accent)] shadow-[inset_0_-3px_0_0_var(--accent)]"
                            : "text-[var(--text)]"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {dataSubTab === "products" ? (
                    <ProductAdminSections />
                  ) : dataSubTab === "events" ? (
                    <>
                    {/* イベントの登録グループ: 新規登録・未登録チェック・
                        イベント登録CSVを取り込む の3セクションを
                        ひとつの外枠で囲う。種別関係の2セクションは
                        枠の外に置く。 */}
                    <div className="mb-6 rounded-[var(--radius)] border border-[var(--border)] p-3 sm:p-4">
                      <h2 className="font-ledger mb-3 text-base font-bold">
                        イベントの登録
                      </h2>
                      <div className="grid gap-4">
                      <section
                        aria-labelledby="dt-new-event"
                        className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
                      >
                        <h3 id="dt-new-event" className="font-ledger text-base font-bold">
                          イベントを新規登録
                        </h3>
                        <p className="mt-1 mb-3 text-sm text-[var(--dim)]">
                          売上データのない日でも先に登録できます。
                        </p>
                        <NewEventSection onOpenDay={openLedgerDay} />
                      </section>
                      <section
                        aria-labelledby="dt-unregistered"
                        className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
                      >
                        <h3 id="dt-unregistered" className="font-ledger text-base font-bold">
                          イベント未登録チェック
                        </h3>
                        <p className="mt-1 mb-3 text-sm text-[var(--dim)]">
                          未登録の日をまとめて確認できます。未登録の日は都市別・頒布物別の集計に入りません。
                        </p>
                        <UnregisteredView days={data.days} />
                      </section>
                      <EventCsvImportSection />
                      </div>
                    </div>
                    <div className="grid gap-6">
                      <EventTypeSection days={data.days} />
                      <EventTypeManageSection days={data.days} />
                    </div>
                    </>
                  ) : (
                    /* 総合管理: 標準イベント一覧の差し替え /
                       データのエクスポート / テスト用データとリセット */
                    <div className="grid gap-6">
                      <MasterReplaceSection />
                      <DataExportSection />
                      <DataResetSection />
                    </div>
                  )}
                </section>
              )}
            </div>

            {/* Dedicated views reached from the top-right buttons.
                Not tabs, so no tabpanel role — plain regions. */}
            <div role="region" aria-label="使い方" hidden={view !== "help"}>
              {view === "help" && <HelpView />}
            </div>
            <div role="region" aria-label="設定" hidden={view !== "settings"}>
              {view === "settings" && (
                <div className="grid gap-4">
                  <DisplaySettingsSection />
                  <CsvImportSettingsSection />
                  <ScreenshotModeSection />
                </div>
              )}
            </div>
            <div role="region" aria-label="売上を取り込む" hidden={view !== "csv"}>
              {view === "csv" && <CsvImportView onOpenExport={openExportSection} />}
            </div>
          </>
        )}
      </main>
    </div>
    </DisplaySettingsProvider>
    </MaskProvider>
  );
}
