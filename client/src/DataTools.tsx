import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import {
decodeCsvBuffer,
downloadTextFile,
eventsToCsv,
isManualCsv,
isSokubaiCsv,
manualSalesTemplateCsv,
parseEventCsv,
parseManualCsv,
parseSokubaiCsv,
parseSquareCsv,
type EventRow,
type ManualParseResult,
} from "./csv";
import { qtyMasked, yenMasked } from "./format";
import { useMask } from "./mask";
import { useDisplaySettings } from "./display";

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["overview"] });
  void queryClient.invalidateQueries({ queryKey: ["cities"] });
  void queryClient.invalidateQueries({ queryKey: ["products"] });
  void queryClient.invalidateQueries({ queryKey: ["typeBreakdownDays"] });
}

const sectionCls =
  "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4";
const btnCls =
  "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-2 text-sm font-medium disabled:opacity-50";

/**
 * 設定ビュー: the screenshot-mode toggle. The mask itself is applied
 * app-wide by MaskProvider (mask.tsx); this is only its switch.
 */
export function ScreenshotModeSection() {
  const { masked, setMasked } = useMask();
  return (
    <section className={sectionCls} aria-labelledby="dt-screenshot">
      <h2 id="dt-screenshot" className="font-ledger text-base font-bold">
        スクショモード
      </h2>
      <p className="mt-1 text-sm text-[var(--dim)]">
        スクリーンショットで共有するときに金額・冊数を隠します。オンにすると金額は「¥***」、冊数は「***」になり、グラフはぼかされます。表示だけのマスクで、データは変わりません。設定はこの端末に保存されます。※個人情報が写っていないかは十分に確認してください。責任は負えません。
      </p>
      <label
        htmlFor="dt-screenshot-mode"
        className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium"
      >
        <input
          id="dt-screenshot-mode"
          type="checkbox"
          aria-label="スクショモード"
          checked={masked}
          onChange={(e) => setMasked(e.target.checked)}
          className="h-4 w-4 shrink-0"
          style={{ accentColor: "var(--accent)" }}
        />
        スクショモード（金額・冊数を隠す）
        {masked && <span className="stamp">適用中</span>}
      </label>
    </section>
  );
}

/**
 * 設定ビュー: display settings section — two app-wide, display-only
 * toggles kept in localStorage by DisplaySettingsProvider
 * (display.tsx). Both default to off (= traditional display).
 */
export function DisplaySettingsSection() {
  const { hideFirstBadge, setHideFirstBadge, hideDiscontinued, setHideDiscontinued } =
    useDisplaySettings();
  return (
    <section className={sectionCls} aria-labelledby="dt-display">
      <h2 id="dt-display" className="font-ledger text-base font-bold">
        表示設定
      </h2>
      <p className="mt-1 text-sm text-[var(--dim)]">
        表示だけの設定です（データ・判定は変わりません）。この端末に保存されます。
      </p>
      <label
        htmlFor="dt-hide-first-badge"
        className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium"
      >
        <input
          id="dt-hide-first-badge"
          type="checkbox"
          aria-label="「同県で初頒布」のバッジを表示しない"
          checked={hideFirstBadge}
          onChange={(e) => setHideFirstBadge(e.target.checked)}
          className="h-4 w-4 shrink-0"
          style={{ accentColor: "var(--accent)" }}
        />
        「同県で初頒布」のバッジを表示しない
        {hideFirstBadge && <span className="stamp">適用中</span>}
      </label>
      <p className="mt-1 pl-6 text-xs text-[var(--dim)]">
        全画面でバッジが非表示になります（判定自体はそのまま）。
      </p>
      <label
        htmlFor="dt-hide-discontinued"
        className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium"
      >
        <input
          id="dt-hide-discontinued"
          type="checkbox"
          aria-label="「廃盤」の頒布物を表示しない"
          checked={hideDiscontinued}
          onChange={(e) => setHideDiscontinued(e.target.checked)}
          className="h-4 w-4 shrink-0"
          style={{ accentColor: "var(--accent)" }}
        />
        「廃盤」の頒布物を表示しない
        {hideDiscontinued && <span className="stamp">適用中</span>}
      </label>
      <p className="mt-1 pl-6 text-xs text-[var(--dim)]">
        イベント一覧の日の内訳で、廃盤の行が非表示になります。合計には廃盤分も含まれます（表示だけの非表示）。
      </p>
    </section>
  );
}

/**
 * 設定ビュー: 使用するCSV取り込み — checkboxes choosing which of
 * the three sales-CSV import sections the CSV取込 view shows.
 * Display-only and stored on-device via DisplaySettingsProvider
 * (display.tsx); all three default to shown. The 標準イベント一覧
 * section is not part of the choice and always shows.
 */
export function CsvImportSettingsSection() {
  const {
    showSquareImport,
    setShowSquareImport,
    showSokubaiImport,
    setShowSokubaiImport,
    showManualImport,
    setShowManualImport,
  } = useDisplaySettings();
  const items: {
    id: string;
    label: string;
    checked: boolean;
    set: (v: boolean) => void;
  }[] = [
    {
      id: "dt-csv-square",
      label: "Square売上CSV",
      checked: showSquareImport,
      set: setShowSquareImport,
    },
    {
      id: "dt-csv-sokubai",
      label: "即売レジ売上CSV",
      checked: showSokubaiImport,
      set: setShowSokubaiImport,
    },
    {
      id: "dt-csv-manual",
      label: "手記録CSV",
      checked: showManualImport,
      set: setShowManualImport,
    },
  ];
  return (
    <section className={sectionCls} aria-labelledby="dt-csv-imports">
      <h2 id="dt-csv-imports" className="font-ledger text-base font-bold">
        使用するCSV取り込み
      </h2>
      <p className="mt-1 text-sm text-[var(--dim)]">
        CSV取込画面に表示する取り込みの種類を選びます。チェックを外した取り込みは画面に出なくなります（表示だけの設定で、取り込み済みのデータには影響しません）。設定はこの端末に保存されます。標準イベント一覧の差し替えは常時表示されます。
      </p>
      {items.map((item) => (
        <label
          key={item.id}
          htmlFor={item.id}
          className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium"
        >
          <input
            id={item.id}
            type="checkbox"
            aria-label={`${item.label}を取り込み画面に表示する`}
            checked={item.checked}
            onChange={(e) => item.set(e.target.checked)}
            className="h-4 w-4 shrink-0"
            style={{ accentColor: "var(--accent)" }}
          />
          {item.label}
        </label>
      ))}
    </section>
  );
}

/**
 * CSV取込ビュー: Square, 即売レジ and 手記録 sales CSV import,
 * event-registration CSV import/export, and the note on what this
 * ledger stores.
 */
export function CsvImportView() {
  const queryClient = useQueryClient();
  const { masked } = useMask();
  const { showSquareImport, showSokubaiImport, showManualImport } = useDisplaySettings();
  const squareRef = useRef<HTMLInputElement>(null);
  const sokubaiRef = useRef<HTMLInputElement>(null);
  const manualRef = useRef<HTMLInputElement>(null);
  const eventRef = useRef<HTMLInputElement>(null);
  const masterRef = useRef<HTMLInputElement>(null);
  const [squareMsg, setSquareMsg] = useState<string | null>(null);
  const [squareErr, setSquareErr] = useState<string | null>(null);
  const [sokubaiMsg, setSokubaiMsg] = useState<string | null>(null);
  const [sokubaiErr, setSokubaiErr] = useState<string | null>(null);
  const [manualMsg, setManualMsg] = useState<string | null>(null);
  const [manualErr, setManualErr] = useState<string | null>(null);
  // Parsed 手記録CSV waiting for the preview confirmation.
  const [manualPending, setManualPending] = useState<ManualParseResult | null>(null);
  const [eventMsg, setEventMsg] = useState<string | null>(null);
  const [eventErr, setEventErr] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [masterMsg, setMasterMsg] = useState<string | null>(null);
  const [masterErr, setMasterErr] = useState<string | null>(null);
  // Parsed master CSV waiting for the replace confirmation.
  const [masterPending, setMasterPending] = useState<EventRow[] | null>(null);

  const masterQuery = useQuery({
    queryKey: ["masterEvents"],
    queryFn: () => api.getMasterEvents({}),
  });
  const masterCount = masterQuery.data?.events.length ?? null;

  const importSales = useMutation({
    mutationFn: async (rows: Parameters<typeof api.importSales>[0]["rows"]) =>
      await api.importSales({ rows }),
    onSuccess: (res) => {
      invalidateAll(queryClient);
      setSquareMsg(
        `${res.dates}日分・${res.imported}件の頒布物別集計を取り込みました（同じ日付・頒布物は新しい内容で置き換え）。`,
      );
    },
    onError: (e) => setSquareErr(`取り込みに失敗しました：${String(e)}`),
  });

  // 即売レジ rows land in the same sales table through the same
  // importSales action, so replacement / 完売-flag preservation /
  // alias resolution behave exactly like a Square re-import.
  const importSokubai = useMutation({
    mutationFn: async (rows: Parameters<typeof api.importSales>[0]["rows"]) =>
      await api.importSales({ rows }),
    onSuccess: (res) => {
      invalidateAll(queryClient);
      setSokubaiMsg(
        `${res.dates}日分・${res.imported}件の頒布物別集計を取り込みました（同じ日付・頒布物は新しい内容で置き換え）。`,
      );
    },
    onError: (e) => setSokubaiErr(`取り込みに失敗しました：${String(e)}`),
  });

  // 手記録 rows land in the same sales table through the same
  // importSales action, so replacement / 完売-flag preservation /
  // alias resolution behave exactly like a Square re-import.
  const importManual = useMutation({
    mutationFn: async (rows: Parameters<typeof api.importSales>[0]["rows"]) =>
      await api.importSales({ rows }),
    onSuccess: (res) => {
      invalidateAll(queryClient);
      setManualPending(null);
      setManualMsg(
        `${res.dates}日分・${res.imported}件の頒布物別集計を取り込みました（同じ日付・頒布物は新しい内容で置き換え）。`,
      );
    },
    onError: (e) => setManualErr(`取り込みに失敗しました：${String(e)}`),
  });

  const importEvents = useMutation({
    mutationFn: async (events: Parameters<typeof api.importEvents>[0]["events"]) =>
      await api.importEvents({ events }),
    onSuccess: (res) => {
      invalidateAll(queryClient);
      setEventMsg(`${res.imported}件のイベント登録を取り込みました。`);
    },
    onError: (e) => setEventErr(`取り込みに失敗しました：${String(e)}`),
  });

  const onSquareFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setSquareMsg(null);
    setSquareErr(null);
    try {
      const text = decodeCsvBuffer(await file.arrayBuffer());
      if (isSokubaiCsv(text)) {
        setSquareErr(
          showSokubaiImport
            ? "このファイルは即売レジのCSVのようです。下の「即売レジ売上CSVを取り込む」から取り込んでください。"
            : "このファイルは即売レジのCSVのようです。設定の「使用するCSV取り込み」で「即売レジ売上CSV」の表示をオンにしてから取り込んでください。",
        );
        return;
      }
      if (isManualCsv(text)) {
        setSquareErr(
          showManualImport
            ? "このファイルは手記録CSVのようです。下の「手記録CSVを取り込む」から取り込んでください。"
            : "このファイルは手記録CSVのようです。設定の「使用するCSV取り込み」で「手記録CSV」の表示をオンにしてから取り込んでください。",
        );
        return;
      }
      const { rows, skipped } = parseSquareCsv(text);
      if (rows.length === 0) {
        setSquareErr("取り込める売上行がありませんでした。");
        return;
      }
      const total = rows.reduce((s, r) => s + r.net, 0);
      setSquareMsg(
        `「${file.name}」を読み取りました：${rows.length}件の集計（売上 ${yenMasked(total, masked)}${skipped ? `、読み飛ばし${skipped}行` : ""}）。取り込み中…`,
      );
      importSales.mutate(rows);
    } catch (e) {
      setSquareErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onSokubaiFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setSokubaiMsg(null);
    setSokubaiErr(null);
    try {
      const text = decodeCsvBuffer(await file.arrayBuffer());
      const { rows, transactions } = parseSokubaiCsv(text);
      if (rows.length === 0) {
        setSokubaiErr("取り込める売上行がありませんでした。");
        return;
      }
      const totalQty = rows.reduce((s, r) => s + r.qty, 0);
      const total = rows.reduce((s, r) => s + r.net, 0);
      setSokubaiMsg(
        `「${file.name}」を読み取りました：${transactions}件の取引・${rows.length}件の集計（${totalQty}冊・売上 ${yenMasked(total, masked)}）。取り込み中…`,
      );
      importSokubai.mutate(rows);
    } catch (e) {
      setSokubaiErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onManualFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setManualMsg(null);
    setManualErr(null);
    setManualPending(null);
    try {
      const text = decodeCsvBuffer(await file.arrayBuffer());
      if (isSokubaiCsv(text)) {
        setManualErr(
          showSokubaiImport
            ? "このファイルは即売レジのCSVのようです。上の「即売レジ売上CSVを取り込む」から取り込んでください。"
            : "このファイルは即売レジのCSVのようです。設定の「使用するCSV取り込み」で「即売レジ売上CSV」の表示をオンにしてから取り込んでください。",
        );
        return;
      }
      const result = parseManualCsv(text);
      if (result.rows.length === 0) {
        setManualErr(
          result.invalid.length > 0
            ? `取り込める行がありませんでした（不正な行${result.invalid.length}件：${result.invalid[0]?.reason ?? ""}）。`
            : "取り込める売上行がありませんでした。",
        );
        return;
      }
      // Preview first: the user confirms the totals (and sees any
      // invalid rows) before anything is written.
      setManualPending(result);
    } catch (e) {
      setManualErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onEventFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setEventMsg(null);
    setEventErr(null);
    try {
      const text = decodeCsvBuffer(await file.arrayBuffer());
      const events = parseEventCsv(text);
      const filled = events.filter((e) => e.eventName || e.venue || e.city || e.prefecture);
      if (filled.length === 0) {
        setEventErr("イベント情報が入力された行がありませんでした。");
        return;
      }
      importEvents.mutate(filled);
    } catch (e) {
      setEventErr(e instanceof Error ? e.message : String(e));
    }
  };

  const replaceMaster = useMutation({
    mutationFn: async (events: EventRow[]) =>
      await api.replaceMasterEvents({ events }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["masterEvents"] });
      setMasterPending(null);
      setMasterMsg(
        `標準イベント一覧を${res.replaced}件で丸ごと差し替えました。登録済みのイベント（参加実績）は変わりません。`,
      );
    },
    onError: (e) => setMasterErr(`差し替えに失敗しました：${String(e)}`),
  });

  const onMasterFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setMasterMsg(null);
    setMasterErr(null);
    setMasterPending(null);
    try {
      const text = decodeCsvBuffer(await file.arrayBuffer());
      const rows = parseEventCsv(text);
      const filled = rows.filter((r) => r.eventName);
      if (filled.length === 0) {
        setMasterErr("イベント名の入った行がありませんでした。");
        return;
      }
      setMasterPending(filled);
    } catch (e) {
      setMasterErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onExportEvents = async () => {
    setExportErr(null);
    try {
      const res = await api.listEvents({});
      downloadTextFile("event-dates.csv", eventsToCsv(res.events));
    } catch (e) {
      setExportErr(`書き出しに失敗しました：${String(e)}`);
    }
  };

  return (
    <div className="grid gap-4">
      {showSquareImport && (
      <section id="csv-import-section" className={sectionCls} aria-labelledby="dt-square">
        <h2 id="dt-square" className="font-ledger text-base font-bold">
          Square売上CSVを取り込む
        </h2>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Squareの「商品売上」CSV（UTF-16／タブ区切り）を、この端末内で日付×頒布物に集計して取り込みます。注文ID・顧客情報・カード情報などは読み取らず、保存もしません。同じ日付・頒布物は新しい集計で置き換わります。
        </p>
        <div className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] p-3">
          <p className="text-sm font-bold">CSVの取得手順（Squareダッシュボード）</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-[var(--dim)]">
            <li>
              <a
                href="https://app.squareup.com/dashboard/sales/reports/item-sales"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Squareダッシュボード
              </a>
              で「レポート」→「商品別売上」を開く
            </li>
            <li>取り込みたい期間だけを表示範囲に設定する（下記参照）</li>
            <li>右上のメニューから「詳細CSV」をダウンロードする</li>
          </ol>
          <p className="mt-2 text-sm font-bold">表示範囲の決め方</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[var(--dim)]">
            <li>
              <span className="font-medium text-[var(--text)]">1日分だけ取り込む場合</span>：
              表示範囲をその日だけ（開始日＝終了日＝その日）に設定する
            </li>
            <li>
              <span className="font-medium text-[var(--text)]">任意の期間を取り込む場合</span>：
              表示範囲をその期間だけに設定する
            </li>
            <li>
              <span className="font-medium text-[var(--text)]">全期間を取り込む場合</span>：
              表示範囲を 1/1〜12/31 に設定し（取得できるのは1年分まで）、
              年の数だけ（必要な年ごとに）同じ手順を繰り返す
            </li>
          </ul>
          <p className="mt-2 text-sm text-[var(--dim)]">
            ※期間が重なるCSVを取り込んでも二重登録にはなりません（同じ日付は置き換え・上書きのみ）。
          </p>
        </div>
        <input
          ref={squareRef}
          type="file"
          accept=".csv,text/csv,text/tab-separated-values"
          className="hidden"
          aria-label="Square売上CSVファイル"
          onChange={(e) => void onSquareFile(e)}
        />
        <button
          type="button"
          className={`${btnCls} mt-3`}
          disabled={importSales.isPending}
          onClick={() => squareRef.current?.click()}
        >
          {importSales.isPending ? "取り込み中…" : "CSVファイルを選ぶ"}
        </button>
        {squareMsg && <p className="mt-2 text-sm">{squareMsg}</p>}
        {squareErr && (
          <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
            {squareErr}
          </p>
        )}
      </section>
      )}

      {showSokubaiImport && (
      <section className={sectionCls} aria-labelledby="dt-sokubai">
        <h2 id="dt-sokubai" className="font-ledger text-base font-bold">
          即売レジ売上CSVを取り込む
        </h2>
        <p className="mt-1 text-sm text-[var(--dim)]">
          同人特化の現金レジアプリ「即売レジ」の販売記録CSV（1日1ファイル）にも対応しています。この端末内で日付×頒布物に集計して取り込みます。日付はファイル名ではなくCSV内の取引日時から判定し、金額はファイル末尾の合計額を正とします。取引の小計合計と合計額が一致しないファイルは、内容を確認できるよう取り込まずに知らせます。他のCSV取込と同じく、同じ日付・頒布物は新しい集計で置き換わり、完売チェックなどの手入力フラグは保持されます。
        </p>
        <div className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] p-3">
          <p className="text-sm font-bold">CSVの取得手順（即売レジ）</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-[var(--dim)]">
            <li>即売レジで「記録をつける」をオンにして販売を記録する</li>
            <li>記録管理からその日の販売記録CSVを共有／書き出す（ファイル名は log@日時.csv など）</li>
            <li>書き出したCSVをここで選ぶ（1日分ずつ取り込めます）</li>
          </ol>
        </div>
        <input
          ref={sokubaiRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label="即売レジ売上CSVファイル"
          onChange={(e) => void onSokubaiFile(e)}
        />
        <button
          type="button"
          className={`${btnCls} mt-3`}
          disabled={importSokubai.isPending}
          onClick={() => sokubaiRef.current?.click()}
        >
          {importSokubai.isPending ? "取り込み中…" : "CSVファイルを選ぶ"}
        </button>
        {sokubaiMsg && <p className="mt-2 text-sm">{sokubaiMsg}</p>}
        {sokubaiErr && (
          <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
            {sokubaiErr}
          </p>
        )}
      </section>
      )}

      {showManualImport && (
      <section className={sectionCls} aria-labelledby="dt-manual">
        <h2 id="dt-manual" className="font-ledger text-base font-bold">
          手記録CSVを取り込む
        </h2>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Squareやレジアプリを使わず、自分で記録した売上を取り込むための形式です。表計算ソフトなどで下の形式のCSVを作って選ぶと、内容を確認してから取り込みます。この端末内で日付×頒布物に集計し、他のCSV取込と同じく同じ日付・頒布物は新しい集計で置き換わり、完売チェックなどの手入力フラグは保持されます。
        </p>
        <div className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] p-3">
          <p className="text-sm font-bold">手記録CSVの形式</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[var(--dim)]">
            <li>文字コードはUTF-8（BOM可）、カンマ区切り、1行目はヘッダー必須</li>
            <li>1行＝1日×1頒布物。同じ日付×頒布物が複数行ある場合は、冊数と金額を合算して取り込みます</li>
            <li>
              <span className="font-medium text-[var(--text)]">日付</span>（必須）：YYYY-MM-DD形式（YYYY/MM/DDも可）
            </li>
            <li>
              <span className="font-medium text-[var(--text)]">頒布物名</span>（必須）
            </li>
            <li>
              <span className="font-medium text-[var(--text)]">冊数</span>（必須）：その日に売れた冊数
            </li>
            <li>
              <span className="font-medium text-[var(--text)]">金額</span>（必須）：その行の売上金額。そのまま純売上として取り込みます
            </li>
            <li>
              <span className="font-medium text-[var(--text)]">カテゴリ</span>（任意）：「なし」と書くと未設定として取り込みます
            </li>
            <li>ヘッダーは英語（date, product, qty, amount, category）でも読み取れます</li>
          </ul>
          <p className="mt-2 text-sm font-bold">記入例</p>
          <pre className="mt-1 overflow-x-auto rounded-[var(--radius)] bg-[var(--surface)] p-2 text-xs leading-relaxed">
            {`日付,頒布物名,冊数,金額,カテゴリ
2026-01-11,サンプル本A,3,3000,本
2026-01-11,サンプル本B,2,1000,
2026-01-12,サンプル本A,1,1000,本`}
          </pre>
          <p className="mt-2 text-sm text-[var(--dim)]">
            ※日付が読めない・冊数や金額が数値でない行は取り込まず、確認画面で件数と理由を表示します。
          </p>
        </div>
        <input
          ref={manualRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label="手記録CSVファイル"
          onChange={(e) => void onManualFile(e)}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={btnCls}
            disabled={importManual.isPending}
            onClick={() => manualRef.current?.click()}
          >
            CSVファイルを選ぶ
          </button>
          <button
            type="button"
            className={btnCls}
            onClick={() => downloadTextFile("manual-sales-template.csv", manualSalesTemplateCsv())}
          >
            テンプレートCSVをダウンロード
          </button>
        </div>
        {manualPending && (
          <div className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] p-3">
            <p className="text-sm font-bold">取り込み内容の確認</p>
            <p className="mt-1 text-sm">
              {new Set(manualPending.rows.map((r) => r.date)).size}日分・
              {manualPending.rows.length}件の集計（データ{manualPending.dataLines}行を集計）：
              合計{qtyMasked(manualPending.rows.reduce((s, r) => s + r.qty, 0), masked)}冊・
              売上 {yenMasked(manualPending.rows.reduce((s, r) => s + r.net, 0), masked)}
            </p>
            {manualPending.invalid.length > 0 && (
              <div className="mt-2">
                <p className="text-sm text-[var(--accent)]">
                  不正な行が{manualPending.invalid.length}件あります（これらの行は取り込みません）：
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[var(--dim)]">
                  {manualPending.invalid.slice(0, 10).map((inv) => (
                    <li key={inv.line}>
                      {inv.line}行目：{inv.reason}
                    </li>
                  ))}
                  {manualPending.invalid.length > 10 && (
                    <li>ほか{manualPending.invalid.length - 10}件</li>
                  )}
                </ul>
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                disabled={importManual.isPending}
                onClick={() => importManual.mutate(manualPending.rows)}
              >
                {importManual.isPending ? "取り込み中…" : "この内容で取り込む"}
              </button>
              <button
                type="button"
                className={btnCls}
                onClick={() => setManualPending(null)}
              >
                やめる
              </button>
            </div>
          </div>
        )}
        {manualMsg && <p className="mt-2 text-sm">{manualMsg}</p>}
        {manualErr && (
          <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
            {manualErr}
          </p>
        )}
      </section>
      )}

      <section className={sectionCls} aria-labelledby="dt-events">
        <h2 id="dt-events" className="font-ledger text-base font-bold">
          イベント登録CSVを取り込む
        </h2>
        <p className="mt-1 text-sm text-[var(--dim)]">
          列は date, event_name, venue, prefecture, city, note（日付はYYYY-MM-DD）。同じ日付は置き換わります。
        </p>
        <input
          ref={eventRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label="イベント登録CSVファイル"
          onChange={(e) => void onEventFile(e)}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={btnCls}
            disabled={importEvents.isPending}
            onClick={() => eventRef.current?.click()}
          >
            {importEvents.isPending ? "取り込み中…" : "CSVファイルを選ぶ"}
          </button>
          <button type="button" className={btnCls} onClick={() => void onExportEvents()}>
            登録済みイベントをCSVで書き出す
          </button>
        </div>
        {eventMsg && <p className="mt-2 text-sm">{eventMsg}</p>}
        {eventErr && (
          <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
            {eventErr}
          </p>
        )}
        {exportErr && (
          <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
            {exportErr}
          </p>
        )}
      </section>

      <section className={sectionCls} aria-labelledby="dt-master">
        <h2 id="dt-master" className="font-ledger text-base font-bold">
          標準イベント一覧を差し替える
        </h2>
        <p className="mt-1 text-sm text-[var(--dim)]">
          標準イベント一覧（現在{masterCount === null ? "…" : `${masterCount}件`}）は、イベント登録フォームや未登録チェックで表示される候補の元データです。参照専用で、参加実績には混ざりません。新しいマスターCSV（列は
          date, event_name, venue, prefecture, city,
          note）を選ぶと、確認のうえ現在の候補を丸ごと差し替えます。登録済みのイベントは変わりません。
        </p>
        <p className="mt-1 text-sm text-[var(--dim)]">
          標準イベント一覧の最新版は GitHub で公開しています：
          <a
            href="https://github.com/ntfiv/doujin-event-master"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] underline"
          >
            ntfiv/doujin-event-master
          </a>
          （新しいマスターCSVはここからダウンロードできます）
        </p>
        <input
          ref={masterRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label="標準イベント一覧CSVファイル"
          onChange={(e) => void onMasterFile(e)}
        />
        <button
          type="button"
          className={`${btnCls} mt-3`}
          disabled={replaceMaster.isPending}
          onClick={() => masterRef.current?.click()}
        >
          マスターCSVファイルを選ぶ
        </button>
        {masterPending && (
          <div className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] p-3">
            <p className="text-sm">
              {masterPending.length}件の候補を読み取りました。現在の標準イベント一覧（
              {masterCount === null ? "…" : `${masterCount}件`}）を丸ごと差し替えますか？
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                disabled={replaceMaster.isPending}
                onClick={() => replaceMaster.mutate(masterPending)}
              >
                {replaceMaster.isPending ? "差し替え中…" : "差し替える"}
              </button>
              <button
                type="button"
                className={btnCls}
                onClick={() => setMasterPending(null)}
              >
                やめる
              </button>
            </div>
          </div>
        )}
        {masterMsg && <p className="mt-2 text-sm">{masterMsg}</p>}
        {masterErr && (
          <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
            {masterErr}
          </p>
        )}
      </section>

      <section className={sectionCls} aria-labelledby="dt-about">
        <h2 id="dt-about" className="font-ledger text-base font-bold">
          この台帳に保存されるもの
        </h2>
        <ul className="mt-1 list-disc pl-5 text-sm text-[var(--dim)]">
          <li>売上の日付×頒布物集計（日付・頒布物名・カテゴリ・冊数・金額・取引件数）</li>
          <li>自分で登録したイベント情報（イベント名・開催施設・都道府県・市区町村・メモ）</li>
          <li>標準イベント一覧（候補表示専用の参照データ。参加実績とは別に保存され、件数などの集計には入りません）</li>
        </ul>
        <p className="mt-2 text-sm text-[var(--dim)]">
          注文ID・支払いID・顧客情報・デバイス名・カード情報・店舗名は、取り込み時にも保存時にも扱いません。
        </p>
      </section>
    </div>
  );
}
