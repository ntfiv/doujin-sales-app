import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { Modal } from "./Modal";
import { dateLabel, qtyFmt, qtyMasked, releaseAgeLabel, yenMasked } from "./format";
import { useMasked } from "./mask";
import { useDisplaySettings } from "./display";
import {
classifyEvent,
fallbackTypeKey,
isEventTypeId,
resolveEventType,
typeLabel,
useEventTypes,
} from "./eventType";
import {
byReleaseDateDesc,
DiscontinuedBadge,
FirstAppearanceBadge,
NewProductDialog,
ProductRefBadge,
SoldOutBadge,
} from "./Products";
import { matchesQuery } from "./search";
import { MasterCandidatePicker } from "./MasterCandidates";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";

// Input limits (maxLength / min / max) come from the actions'
// request schemas, so the form fields and the server can never
// disagree.
const FIELDS = actionFields<typeof Actions>();

export type DaySummary = ApiResponse<typeof api, "getOverview">["days"][number];
type DayDetail = ApiResponse<typeof api, "getDayDetail">;

/**
 * Fields of a registered event that are still blank (event name, venue,
 * prefecture, city). Returns [] for unregistered days and complete ones.
 */
export function missingEventFields(day: DaySummary): string[] {
  if (day.eventName === null) return [];
  const missing: string[] = [];
  if (!day.eventName.trim()) missing.push("イベント名");
  if (!day.venue?.trim()) missing.push("開催施設");
  if (!day.prefecture?.trim()) missing.push("都道府県");
  if (!day.city?.trim()) missing.push("市区町村");
  return missing;
}

const inputCls =
  "w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text)]";
const labelCls = "block text-xs font-medium text-[var(--dim)] mb-1";

/** All 47 prefectures, in the standard north-to-south order. */
export const PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
];

export function EventForm({
  date,
  initial,
  initialFlags,
  onDone,
  requireEventName = false,
  onSaved,
}: {
  date: string;
  initial: DayDetail["event"];
  initialFlags: DayDetail["flags"];
  onDone: () => void;
  /** New-registration mode: an event name is required to save. */
  requireEventName?: boolean;
  /** Called after a successful save (not on cancel). */
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const types = useEventTypes();
  const [eventName, setEventName] = useState(initial?.eventName ?? "");
  const [venue, setVenue] = useState(initial?.venue ?? "");
  const [prefecture, setPrefecture] = useState(initial?.prefecture ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  // Manual event-type override: "" = 自動判定 (classified from the
  // event name), otherwise the key of one of the stored event types.
  // A stored manual value wins over the automatic classification
  // everywhere.
  const [eventType, setEventType] = useState(initial?.eventType ?? "");
  const autoTypeLabel = typeLabel(types, classifyEvent(eventName || null, types));
  const [salesUnreliable, setSalesUnreliable] = useState(initialFlags.salesUnreliable);
  // There is no day-level 「新刊あり」 flag: 「新刊」 is judged
  // automatically per product from its release date (see Products.tsx).
  const [error, setError] = useState<string | null>(null);
  // Validate-after-interaction: the event-name field is only marked
  // invalid (aria-invalid + :user-invalid styling) once a save has
  // been attempted with it empty — never on first render.
  const [nameInvalid, setNameInvalid] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["overview"] });
    void queryClient.invalidateQueries({ queryKey: ["day", date] });
    void queryClient.invalidateQueries({ queryKey: ["cities"] });
    void queryClient.invalidateQueries({ queryKey: ["products"] });
    void queryClient.invalidateQueries({ queryKey: ["typeBreakdownDays"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      // When nothing about the event itself is entered and none is
      // registered yet, save only the flags so the day stays 未登録.
      const hasEventInput =
        initial !== null ||
        Boolean(
          eventName.trim() ||
            venue.trim() ||
            prefecture ||
            city.trim() ||
            note.trim() ||
            eventType,
        );
      return hasEventInput
        ? await api.saveEvent({
            date,
            eventName,
            venue,
            prefecture,
            city,
            note,
            eventType: isEventTypeId(eventType, types) ? eventType : "",
            salesUnreliable,
          })
        : await api.saveDayFlags({
            date,
            salesUnreliable,
          });
    },
    onSuccess: () => {
      invalidate();
      onSaved?.();
      onDone();
    },
    onError: (e) => setError(String(e)),
  });

  const remove = useMutation({
    mutationFn: async () => await api.deleteEvent({ date }),
    onSuccess: () => {
      invalidate();
      onDone();
    },
    onError: (e) => setError(String(e)),
  });

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    if (requireEventName && !eventName.trim()) {
      setNameInvalid(true);
      setError("イベント名を入力してください。新規登録にはイベント名が必要です。");
      return;
    }
    setNameInvalid(false);
    save.mutate();
  };

  return (
    <form onSubmit={submit} noValidate>
      <p className="font-ledger text-sm font-bold">{dateLabel(date)}のイベント</p>
      {/* 標準イベント一覧の候補: shown whenever the master list has
          entries for this date — also on days that already have a
          user registration, where they are reference only (picking
          one fills the fields; it never saves or overwrites by
          itself). The candidate's 出典 note is not copied into メモ. */}
      <div className="mt-3 empty:hidden">
        <MasterCandidatePicker
          date={date}
          onPick={(c) => {
            setEventName(c.eventName);
            setVenue(c.venue);
            setPrefecture(c.prefecture);
            setCity(c.city);
            if (c.eventName.trim()) setNameInvalid(false);
          }}
        />
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">
        <div>
          <label htmlFor={`ev-name-${date}`} className={labelCls}>
            イベント名{requireEventName ? "（必須）" : ""}
          </label>
          <input
            {...FIELDS.saveEvent.eventName}
            id={`ev-name-${date}`}
            className={inputCls}
            value={eventName}
            required={requireEventName}
            aria-invalid={nameInvalid || undefined}
            aria-describedby={nameInvalid ? `ev-error-${date}` : undefined}
            onChange={(e) => {
              setEventName(e.target.value);
              if (e.target.value.trim()) setNameInvalid(false);
            }}
            placeholder="例：コミックマーケット103"
          />
        </div>
        <div>
          <label htmlFor={`ev-venue-${date}`} className={labelCls}>
            開催施設
          </label>
          <input
            {...FIELDS.saveEvent.venue}
            id={`ev-venue-${date}`}
            className={inputCls}
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="例：東京ビッグサイト"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`ev-pref-${date}`} className={labelCls}>
              都道府県
            </label>
            <div className="relative">
              <select
                id={`ev-pref-${date}`}
                className={`${inputCls} appearance-none pr-9`}
                value={prefecture}
                onChange={(e) => setPrefecture(e.target.value)}
              >
                <option value="">選択してください</option>
                {prefecture && !PREFECTURES.includes(prefecture) && (
                  <option value={prefecture}>{prefecture}（登録済み）</option>
                )}
                {PREFECTURES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-[var(--dim)]"
              >
                ▼
              </span>
            </div>
          </div>
          <div>
            <label htmlFor={`ev-city-${date}`} className={labelCls}>
              市区町村
            </label>
            <input
              {...FIELDS.saveEvent.city}
              id={`ev-city-${date}`}
              className={inputCls}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="例：江東区"
            />
          </div>
        </div>
        <div>
          <label htmlFor={`ev-note-${date}`} className={labelCls}>
            メモ
          </label>
          <input
            {...FIELDS.saveEvent.note}
            id={`ev-note-${date}`}
            className={inputCls}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例：2日目のみ参加"
          />
        </div>
        <div>
          <label htmlFor={`ev-type-${date}`} className={labelCls}>
            イベント種別
          </label>
          <div className="relative">
            <select
              id={`ev-type-${date}`}
              className={`${inputCls} appearance-none pr-9`}
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
            >
              <option value="">自動判定（{autoTypeLabel}）</option>
              {types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-[var(--dim)]"
            >
              ▼
            </span>
          </div>
        </div>
        <fieldset className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <legend className="px-1 text-xs font-medium text-[var(--dim)]">フラグ</legend>
          <label
            htmlFor={`ev-flag-ref-${date}`}
            className="flex cursor-pointer items-start gap-2 py-1.5 text-sm"
          >
            <input
              id={`ev-flag-ref-${date}`}
              type="checkbox"
              aria-label="売上は参考情報"
              checked={salesUnreliable}
              onChange={(e) => setSalesUnreliable(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
              style={{ accentColor: "var(--accent)" }}
            />
            <span>
              売上は参考情報
              <span className="block text-xs text-[var(--dim)]">
                このイベントでの売上データが完全ではない場合にチェック。（売上がない、もしくは『任意の金額』のみで頒布物別内訳がない日）
              </span>
            </span>
          </label>
        </fieldset>
      </div>
      {error && (
        <p role="alert" id={`ev-error-${date}`} className="mt-2 text-sm text-[var(--accent)]">
          保存できませんでした：{error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {save.isPending ? "保存中…" : "保存する"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm"
        >
          キャンセル
        </button>
        {initial && (
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            className="ml-auto px-2 py-2 text-sm text-[var(--accent)] underline disabled:opacity-50"
          >
            登録を削除
          </button>
        )}
      </div>
    </form>
  );
}

type DaySalesRow = DayDetail["rows"][number];

/**
 * In-app sales editor for one day: add a row by picking an
 * already-registered product and entering 冊数・金額， edit an existing
 * row's numbers, or delete a row. Each row also carries a 完売
 * checkbox — that day the copies of that product brought to the event
 * sold out (stock ran short). A brand-new product can also be
 * registered from here （新しい頒布物を登録, the shared 新規登録
 * dialog): once registered it is selected in the add form, ready for
 * its first row. The add form's product picker lists products in the
 * app-wide release order (newest first, unset dates last) and starts
 * with 除外 / 廃盤 products hidden (two checkboxes, both on by
 * default); the filters apply to the picker only — rows already
 * recorded for the day always stay visible and editable. Manual rows are ordinary sales rows: every total and
 * chart picks them up immediately. Note that re-importing a Square
 * CSV later replaces the row for any date × product present in that
 * CSV (the same replace rule as always); rows for products absent
 * from the CSV are left untouched. The 完売 flag is not part of the
 * CSV, so it survives a re-import.
 */
function SalesEditor({
  date,
  rows,
  onClose,
}: {
  date: string;
  rows: DaySalesRow[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: () => api.getProducts({}),
  });
  const [error, setError] = useState<string | null>(null);
  // Validate-after-interaction: fields are marked aria-invalid only
  // after a save attempt fails on them (never on first render).
  const [editInvalid, setEditInvalid] = useState<{ qty: boolean; net: boolean }>({
    qty: false,
    net: false,
  });
  const [addInvalid, setAddInvalid] = useState<{
    product: boolean;
    qty: boolean;
    net: boolean;
  }>({ product: false, qty: false, net: false });
  // Row being edited inline (product name), plus its draft numbers.
  const [editProduct, setEditProduct] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editNet, setEditNet] = useState("");
  const [editSoldOut, setEditSoldOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Add form.
  const [addProduct, setAddProduct] = useState("");
  const [addQty, setAddQty] = useState("");
  const [addNet, setAddNet] = useState("");
  const [addSoldOut, setAddSoldOut] = useState(false);
  // Add-picker filters, both on by default (same wording and default
  // as the 頒布物一覧 tab): while on, 除外 / 廃盤 products are left
  // out of the add picker's options. Picker only — existing rows of
  // the day are never hidden.
  const [hideExcluded, setHideExcluded] = useState(true);
  const [hideDiscontinued, setHideDiscontinued] = useState(true);
  // 新規登録 dialog opened from the add form; a product registered
  // there is selected in the add form straight away.
  const [creatingProduct, setCreatingProduct] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["overview"] });
    void queryClient.invalidateQueries({ queryKey: ["day", date] });
    void queryClient.invalidateQueries({ queryKey: ["cities"] });
    void queryClient.invalidateQueries({ queryKey: ["products"] });
    void queryClient.invalidateQueries({ queryKey: ["typeBreakdownDays"] });
  };

  const save = useMutation({
    mutationFn: async (v: { product: string; qty: number; net: number; soldOut: boolean }) =>
      await api.saveSalesRow({
        date,
        product: v.product,
        qty: v.qty,
        net: v.net,
        soldOut: v.soldOut,
      }),
    onSuccess: (_data, v) => {
      invalidate();
      if (editProduct === v.product) setEditProduct(null);
      setEditInvalid({ qty: false, net: false });
      if (addProduct === v.product) {
        setAddQty("");
        setAddNet("");
        setAddSoldOut(false);
        setAddInvalid({ product: false, qty: false, net: false });
      }
    },
    onError: (e) => setError(String(e)),
  });

  const remove = useMutation({
    mutationFn: async (product: string) => await api.deleteSalesRow({ date, product }),
    onSuccess: () => {
      invalidate();
      setConfirmDelete(null);
    },
    onError: (e) => setError(String(e)),
  });

  const parseNumbers = (
    qtyStr: string,
    netStr: string,
    mark: (v: { qty: boolean; net: boolean }) => void,
  ) => {
    const qty = Number(qtyStr);
    const net = Number(netStr);
    if (qtyStr.trim() === "" || !Number.isFinite(qty) || qty === 0) {
      mark({ qty: true, net: false });
      setError("冊数を入力してください（0以外の数字）。");
      return null;
    }
    if (netStr.trim() === "" || !Number.isFinite(net) || !Number.isInteger(net)) {
      mark({ qty: false, net: true });
      setError("金額（売上・円）を整数で入力してください。");
      return null;
    }
    mark({ qty: false, net: false });
    return { qty, net };
  };

  const submitEdit = (product: string) => {
    setError(null);
    const nums = parseNumbers(editQty, editNet, setEditInvalid);
    if (nums) save.mutate({ product, ...nums, soldOut: editSoldOut });
  };

  const submitAdd = () => {
    setError(null);
    if (!addProduct) {
      setAddInvalid({ product: true, qty: false, net: false });
      setError("追加する頒布物を選んでください。");
      return;
    }
    const nums = parseNumbers(addQty, addNet, (v) =>
      setAddInvalid({ product: false, ...v }),
    );
    if (nums) save.mutate({ product: addProduct, ...nums, soldOut: addSoldOut });
  };

  const inDay = new Set(rows.map((r) => r.product));
  // Picker candidates: every registered product not yet recorded for
  // this day, in the app-wide release order (effective release date,
  // newest first; unset dates sort last via the placeholder).
  const addableAll = (productsQuery.data?.products ?? [])
    .filter((p) => !inDay.has(p.product))
    .sort(byReleaseDateDesc);
  const addable = addableAll.filter(
    (p) =>
      (!hideExcluded || !p.salesUnreliable) &&
      (!hideDiscontinued || !p.discontinued),
  );
  // Turning a filter on can hide the currently picked product; drop
  // the pick then so the select never points at a hidden option.
  const applyHideFilters = (excluded: boolean, discontinued: boolean) => {
    setHideExcluded(excluded);
    setHideDiscontinued(discontinued);
    const picked = addableAll.find((p) => p.product === addProduct);
    if (
      picked &&
      ((excluded && picked.salesUnreliable) ||
        (discontinued && picked.discontinued))
    ) {
      setAddProduct("");
    }
  };
  const numInputCls =
    "w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-base text-[var(--text)]";

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="font-ledger text-sm font-bold">{dateLabel(date)}の売上を編集</p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs whitespace-nowrap"
        >
          閉じる
        </button>
      </div>

      {rows.length > 0 && (
        <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2">
          {rows.map((r) => (
            <li
              key={r.product}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <p className="text-sm font-medium">{r.product}</p>
              {editProduct === r.product ? (
                <div className="mt-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor={`se-qty-${r.product}`} className={labelCls}>
                        冊数
                      </label>
                      <input
                        {...FIELDS.saveSalesRow.qty}
                        id={`se-qty-${r.product}`}
                        type="number"
                        inputMode="numeric"
                        required
                        className={numInputCls}
                        value={editQty}
                        aria-invalid={editInvalid.qty || undefined}
                        aria-describedby={editInvalid.qty ? `se-error-${date}` : undefined}
                        onChange={(e) => setEditQty(e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor={`se-net-${r.product}`} className={labelCls}>
                        金額（売上・円）
                      </label>
                      <input
                        {...FIELDS.saveSalesRow.net}
                        id={`se-net-${r.product}`}
                        type="number"
                        inputMode="numeric"
                        required
                        className={numInputCls}
                        value={editNet}
                        aria-invalid={editInvalid.net || undefined}
                        aria-describedby={editInvalid.net ? `se-error-${date}` : undefined}
                        onChange={(e) => setEditNet(e.target.value)}
                      />
                    </div>
                  </div>
                  <label
                    htmlFor={`se-soldout-${r.product}`}
                    className="mt-2 flex cursor-pointer items-start gap-2 text-sm"
                  >
                    <input
                      id={`se-soldout-${r.product}`}
                      type="checkbox"
                      aria-label={`${r.product}は完売`}
                      checked={editSoldOut}
                      onChange={(e) => setEditSoldOut(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0"
                      style={{ accentColor: "var(--accent)" }}
                    />
                    <span>
                      完売
                      <span className="block text-xs text-[var(--dim)]">
                        その日、持って行った分が足りずに売り切れた
                      </span>
                    </span>
                  </label>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={save.isPending}
                      onClick={() => submitEdit(r.product)}
                      className="rounded-[var(--radius)] bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {save.isPending ? "保存中…" : "保存"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditProduct(null)}
                      className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-sm"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="tnum text-sm text-[var(--dim)]">
                    {qtyFmt(r.qty)}冊 ・ ¥{r.net.toLocaleString("ja-JP")}
                  </span>
                  {r.soldOut && <SoldOutBadge />}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setConfirmDelete(null);
                      setEditInvalid({ qty: false, net: false });
                      setEditProduct(r.product);
                      setEditQty(String(r.qty));
                      setEditNet(String(r.net));
                      setEditSoldOut(r.soldOut);
                    }}
                    className="px-1 py-1 text-sm font-medium underline"
                  >
                    編集
                  </button>
                  {confirmDelete === r.product ? (
                    <>
                      <span className="text-sm text-[var(--accent)]">この行を削除しますか？</span>
                      <button
                        type="button"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(r.product)}
                        className="rounded-[var(--radius)] bg-[var(--accent)] px-3 py-1 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {remove.isPending ? "削除中…" : "削除する"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="px-1 py-1 text-sm underline"
                      >
                        やめる
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setEditProduct(null);
                        setConfirmDelete(r.product);
                      }}
                      className="px-1 py-1 text-sm text-[var(--accent)] underline"
                    >
                      削除
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t border-dashed border-[var(--border)] pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold">売上を追加</p>
          <button
            type="button"
            onClick={() => setCreatingProduct(true)}
            className="ml-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium"
          >
            新しい頒布物を登録
          </button>
        </div>
        <NewProductDialog
          open={creatingProduct}
          onClose={() => setCreatingProduct(false)}
          onCreated={(name) => {
            void queryClient.invalidateQueries({ queryKey: ["products"] });
            setAddProduct(name);
            setAddInvalid({ product: false, qty: false, net: false });
          }}
        />
        {productsQuery.isPending ? (
          <p className="mt-2 text-sm text-[var(--dim)]">頒布物の一覧を読み込み中…</p>
        ) : productsQuery.error ? (
          <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
            頒布物の一覧を読み込めませんでした：{String(productsQuery.error)}
          </p>
        ) : addableAll.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--dim)]">
            追加できる頒布物がありません（すべてこの日に登録済みです）。新しい本は上の「新しい頒布物を登録」から登録できます。
          </p>
        ) : (
          <>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <label
              htmlFor={`se-add-hide-ref-${date}`}
              className="flex cursor-pointer items-center gap-1.5 text-sm"
            >
              <input
                id={`se-add-hide-ref-${date}`}
                type="checkbox"
                aria-label="除外を非表示"
                checked={hideExcluded}
                onChange={(e) => applyHideFilters(e.target.checked, hideDiscontinued)}
                className="h-4 w-4 shrink-0"
                style={{ accentColor: "var(--accent)" }}
              />
              除外を非表示
            </label>
            <label
              htmlFor={`se-add-hide-disc-${date}`}
              className="flex cursor-pointer items-center gap-1.5 text-sm"
            >
              <input
                id={`se-add-hide-disc-${date}`}
                type="checkbox"
                aria-label="廃盤を非表示"
                checked={hideDiscontinued}
                onChange={(e) => applyHideFilters(hideExcluded, e.target.checked)}
                className="h-4 w-4 shrink-0"
                style={{ accentColor: "var(--accent)" }}
              />
              廃盤を非表示
            </label>
          </div>
          {addable.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--dim)]">
              除外・廃盤を非表示にしているため、追加できる頒布物がありません。
            </p>
          ) : (
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2">
            <div>
              <label htmlFor={`se-add-product-${date}`} className={labelCls}>
                頒布物（登録済みから選択）
              </label>
              <div className="relative">
                <select
                  id={`se-add-product-${date}`}
                  className={`${inputCls} appearance-none pr-9`}
                  value={addProduct}
                  required
                  aria-invalid={addInvalid.product || undefined}
                  aria-describedby={addInvalid.product ? `se-error-${date}` : undefined}
                  onChange={(e) => setAddProduct(e.target.value)}
                >
                  <option value="">選択してください</option>
                  {addable.map((p) => (
                    <option key={p.product} value={p.product}>
                      {p.product}
                    </option>
                  ))}
                </select>
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-[var(--dim)]"
                >
                  ▼
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={`se-add-qty-${date}`} className={labelCls}>
                  冊数
                </label>
                <input
                  {...FIELDS.saveSalesRow.qty}
                  id={`se-add-qty-${date}`}
                  type="number"
                  inputMode="numeric"
                  required
                  className={inputCls}
                  value={addQty}
                  aria-invalid={addInvalid.qty || undefined}
                  aria-describedby={addInvalid.qty ? `se-error-${date}` : undefined}
                  onChange={(e) => setAddQty(e.target.value)}
                  placeholder="例：12"
                />
              </div>
              <div>
                <label htmlFor={`se-add-net-${date}`} className={labelCls}>
                  金額（売上・円）
                </label>
                <input
                  {...FIELDS.saveSalesRow.net}
                  id={`se-add-net-${date}`}
                  type="number"
                  inputMode="numeric"
                  required
                  className={inputCls}
                  value={addNet}
                  aria-invalid={addInvalid.net || undefined}
                  aria-describedby={addInvalid.net ? `se-error-${date}` : undefined}
                  onChange={(e) => setAddNet(e.target.value)}
                  placeholder="例：6000"
                />
              </div>
            </div>
            <label
              htmlFor={`se-add-soldout-${date}`}
              className="flex cursor-pointer items-start gap-2 text-sm"
            >
              <input
                id={`se-add-soldout-${date}`}
                type="checkbox"
                aria-label="完売"
                checked={addSoldOut}
                onChange={(e) => setAddSoldOut(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0"
                style={{ accentColor: "var(--accent)" }}
              />
              <span>
                完売
                <span className="block text-xs text-[var(--dim)]">
                  その日、持って行った分が足りずに売り切れた
                </span>
              </span>
            </label>
            <div>
              <button
                type="button"
                disabled={save.isPending}
                onClick={submitAdd}
                className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {save.isPending ? "追加中…" : "この売上を追加"}
              </button>
            </div>
          </div>
          )}
          </>
        )}
      </div>

      {error && (
        <p role="alert" id={`se-error-${date}`} className="mt-2 text-sm text-[var(--accent)]">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * イベントメモ chip for a day row: the day has a saved inventory memo.
 * When counts are recorded, the total rides along （合計N冊）.
 */
export function InventoryMemoBadge({ totalQty }: { totalQty: number }) {
  const masked = useMasked();
  return (
    <span className="inline-block rounded-full bg-[var(--surface-alt)] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-[var(--dim)]">
      イベントメモ{totalQty > 0 ? `（合計${qtyMasked(totalQty, masked)}冊）` : ""}
    </span>
  );
}

/**
 * チケット形式の選択肢 (event_prep.ticket_type の値 → 表示名).
 * "" is 未選択 and has no entry here.
 */
export const TICKET_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "paper_arrived", label: "紙チケット（届いた）" },
  { value: "paper_pending", label: "紙チケット（まだ届いてない）" },
  { value: "electronic", label: "電子チケット" },
  { value: "none", label: "チケット不要" },
];

export function ticketTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return TICKET_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? null;
}

/**
 * Ticket-status chip for a ledger row. The caller gates it to
 * upcoming days (today or later, Asia/Tokyo) with a ticket format
 * set; past days never show it.
 */
export function TicketBadge({ ticketType }: { ticketType: string | null }) {
  const label = ticketTypeLabel(ticketType);
  if (!label) return null;
  return (
    <span className="inline-block rounded-full bg-[var(--prep-bg)] px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-[var(--prep-text)]">
      {label}
    </span>
  );
}

/**
 * 参加前確認のチェック状況 chip for a ledger row: the four departure
 * checks as one compact badge — 品 (POP/お品書き)・告 （参加告知）・
 * チケ (チケットOK)・荷 (荷造りOK) — each prefixed with ✅ when
 * done, and shown pale without it when not. The caller gates it to
 * upcoming days (today or later, Asia/Tokyo) that have a prep
 * record; past days never show it. The guide-by-mail flag is NOT
 * part of this badge.
 */
export function PrepChecksBadge({
  checks,
}: {
  checks: { pop: boolean; announce: boolean; ticket: boolean; packing: boolean } | null;
}) {
  if (!checks) return null;
  const items: { label: string; done: boolean }[] = [
    { label: "品", done: checks.pop },
    { label: "告", done: checks.announce },
    { label: "チケ", done: checks.ticket },
    { label: "荷", done: checks.packing },
  ];
  return (
    <span
      aria-label="参加前確認のチェック状況"
      className="inline-block rounded-full bg-[var(--prep-bg)] px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-[var(--prep-text)]"
    >
      {items.map((it, i) => (
        <span key={it.label}>
          {i > 0 && <span aria-hidden>・</span>}
          <span style={it.done ? undefined : { color: "var(--prep-dim)" }}>
            {it.done ? "✅" : ""}
            {it.label}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Payload of one イベントメモ save (what saveInventoryMemo stores). */
type MemoPayload = {
  url: string;
  memo: string;
  items: { product: string; qty: number }[];
};

/**
 * Counts worth storing from the editor's string fields: positive
 * integers only (blank / 0 / invalid entries are left out), sorted
 * by product so two payloads compare stably.
 */
function memoItemsFromQuantities(
  qs: Record<string, string>,
): { product: string; qty: number }[] {
  return Object.entries(qs)
    .map(([product, v]) => ({ product, qty: Number(v) }))
    .filter((i) => Number.isInteger(i.qty) && i.qty > 0)
    .sort((a, b) => (a.product < b.product ? -1 : a.product > b.product ? 1 : 0));
}

/** Every count field must be blank or a non-negative integer. */
function memoQuantitiesValid(qs: Record<string, string>): boolean {
  for (const v of Object.values(qs)) {
    if (v.trim() === "") continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return false;
  }
  return true;
}

function memoPayloadKey(p: MemoPayload): string {
  return JSON.stringify([p.url, p.memo, p.items.map((i) => [i.product, i.qty])]);
}

/** Trimmed URL plus whether it may be saved (empty, or http/https). */
function memoUrlState(raw: string): { trimmed: string; valid: boolean } {
  const trimmed = raw.trim();
  if (trimmed === "") return { trimmed, valid: true };
  try {
    const u = new URL(trimmed);
    return { trimmed, valid: u.protocol === "http:" || u.protocol === "https:" };
  } catch {
    return { trimmed, valid: false };
  }
}

/**
 * イベントメモ editor for one day: one URL (official site etc.), the
 * per-product counts of copies sent / to bring, and a free memo.
 * The product picker is the registered product list minus 廃盤 and
 * 除外 products — those never appear here (per the user's rule).
 * Counts left blank or 0 are not saved. A product whose count was
 * saved earlier but has since become 廃盤/除外 is hidden from the
 * picker, yet its saved count is carried through an edit unchanged
 * (and still shown in the read-only view) rather than silently
 * dropped. Clearing every field deletes the memo.
 *
 * Autosave (2026-11-17, user request): there is no save button.
 * About a second after the input settles, the current values are
 * saved through saveInventoryMemo, and the footer shows the save
 * state （未保存の変更があります / 保存中… / 保存しました /
 * 保存できませんでした）. A failed save keeps the input intact so
 * it can be retried by typing on or by closing. Closing the dialog
 * — the 閉じる buttons, the backdrop, or Esc — first flushes any
 * pending change through the close guard registered with the
 * parent section; the dialog only closes once everything savable
 * is stored. While the typed URL is not a valid http/https URL
 * yet, only the URL is held back (the payload keeps the last saved
 * URL and a note shows under the field); the memo and counts still
 * save, and the dialog refuses to close (Esc included, via the
 * Modal's close veto) until the URL is fixed or cleared, so the
 * typed URL is never silently discarded. The footer's リセット
 * button clears THIS date's memo only:
 * after a one-tap inline confirmation it cancels any pending
 * autosave, empties the fields, and immediately saves the empty
 * payload, which deletes the stored memo — other dates are
 * untouched, and the emptied fields can never resurrect the old
 * content through a later autosave.
 */
function InventoryMemoEditor({
  date,
  eventName,
  initial,
  onClose,
  registerCloseGuard,
}: {
  date: string;
  eventName: string;
  initial: DayDetail["inventoryMemo"];
  onClose: () => void;
  /** Hands the parent section the close guard (see
   * InventoryMemoSection's requestClose); null unregisters it.
   * flush saves pending changes and reports whether the dialog
   * may close; veto is the synchronous Esc veto (true while the
   * typed URL is invalid, so Esc cannot discard it either). */
  registerCloseGuard: (
    guard: { flush: () => Promise<boolean>; veto: () => boolean } | null,
  ) => void;
}) {
  const queryClient = useQueryClient();
  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: () => api.getProducts({}),
  });
  const [url, setUrl] = useState(initial?.url ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [quantities, setQuantities] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const item of initial?.items ?? []) init[item.product] = String(item.qty);
    return init;
  });
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [qtyInvalid, setQtyInvalid] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "unsaved" | "saving" | "saved" | "error"
  >("idle");
  const [confirmingReset, setConfirmingReset] = useState(false);
  // Whether a memo with content is currently stored for this date;
  // together with the current input it drives the リセット
  // button's disabled state.
  const [savedExists, setSavedExists] = useState(
    () =>
      Boolean(
        initial &&
          (initial.url !== "" ||
            initial.memo.trim() !== "" ||
            initial.items.length > 0),
      ),
  );

  // The newest field values, mirrored into a ref so the serialized
  // save routine always reads the latest input — even while a
  // previous save is still in flight.
  const valuesRef = useRef({ url, memo, quantities });
  valuesRef.current = { url, memo, quantities };
  // The payload as last stored on the server. Autosave saves only
  // when the current payload differs from this; while the typed
  // URL is invalid, the payload keeps this URL （URLだけ保留）.
  const savedRef = useRef<MemoPayload>({
    url: initial?.url ?? "",
    memo: initial?.memo ?? "",
    items: (initial?.items ?? []).map((i) => ({ product: i.product, qty: i.qty })),
  });
  const timerRef = useRef<number | null>(null);
  // Save calls are chained through this promise so two saves never
  // run at once; a queued pass re-reads the newest values.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["overview"] });
    void queryClient.invalidateQueries({ queryKey: ["day", date] });
    void queryClient.invalidateQueries({ queryKey: ["cities"] });
  }, [queryClient, date]);

  /**
   * One serialized save pass: validates the counts, builds the
   * payload (holding the URL back while it is invalid), and stores
   * it when it differs from the last saved payload. Loops so edits
   * typed during a save are picked up by a follow-up pass instead
   * of being lost. Resolves true when everything savable is stored
   * (or there is nothing to store), false when no save could be
   * made (invalid counts, or the save itself failed).
   */
  const runSave = useCallback((): Promise<boolean> => {
    const task = async (): Promise<boolean> => {
      for (let pass = 0; pass < 5; pass++) {
        const cur = valuesRef.current;
        if (!memoQuantitiesValid(cur.quantities)) {
          setQtyInvalid(true);
          setError("冊数は0以上の整数で入力してください。");
          setStatus("unsaved");
          return false;
        }
        setQtyInvalid(false);
        const urlState = memoUrlState(cur.url);
        const payload: MemoPayload = {
          url: urlState.valid ? urlState.trimmed : savedRef.current.url,
          memo: cur.memo,
          items: memoItemsFromQuantities(cur.quantities),
        };
        if (memoPayloadKey(payload) === memoPayloadKey(savedRef.current)) {
          setError(null);
          setStatus("saved");
          return true;
        }
        setStatus("saving");
        try {
          await api.saveInventoryMemo({ date, ...payload });
        } catch (e) {
          setStatus("error");
          setError(`保存できませんでした：${String(e)}`);
          return false;
        }
        savedRef.current = payload;
        setSavedExists(
          payload.url !== "" || payload.memo.trim() !== "" || payload.items.length > 0,
        );
        setError(null);
        setStatus("saved");
        invalidate();
      }
      return true;
    };
    const p = chainRef.current.then(task, task);
    chainRef.current = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }, [date, invalidate]);

  // Debounced autosave: about a second after the last change to
  // the URL, the counts, or the memo, save whatever changed. The
  // first render is skipped — merely opening the editor saves
  // nothing.
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    setStatus((s) => (s === "saving" ? s : "unsaved"));
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void runSave();
    }, 1000);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [url, memo, quantities, runSave]);

  // Close guard for the parent section: cancel the pending
  // debounce and flush immediately. The dialog closes only when
  // this resolves true: a failed save keeps it (and the typed
  // input) open, and so does a still-invalid URL — the memo and
  // counts are flushed, but the unsavable URL text is never
  // silently discarded by a close.
  const flushForClose = useCallback(async (): Promise<boolean> => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const ok = await runSave();
    if (!ok) return false;
    if (!memoUrlState(valuesRef.current.url).valid) {
      setError("URLの形式が正しくないため閉じられません。URLを直すか、空にしてから閉じてください。");
      return false;
    }
    return true;
  }, [runSave]);

  useEffect(() => {
    registerCloseGuard({
      flush: flushForClose,
      veto: () => !memoUrlState(valuesRef.current.url).valid,
    });
    return () => registerCloseGuard(null);
  }, [registerCloseGuard, flushForClose]);

  // リセット: cancel the pending autosave first, empty every
  // field, then save the empty payload at once (the server deletes
  // the memo). valuesRef is updated synchronously, so neither this
  // save nor the autosave the state change schedules can resurrect
  // the pre-reset content.
  const doReset = useCallback(async () => {
    setConfirmingReset(false);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    valuesRef.current = { url: "", memo: "", quantities: {} };
    setUrl("");
    setMemo("");
    setQuantities({});
    setQtyInvalid(false);
    setError(null);
    await runSave();
  }, [runSave]);

  const allProducts = productsQuery.data?.products ?? [];
  // Picker list: registered products except 廃盤 and 除外， newest
  // release first (the app-wide product ordering).
  const eligible = useMemo(
    () =>
      [...allProducts]
        .filter((p) => !p.discontinued && !p.salesUnreliable)
        .sort(byReleaseDateDesc),
    [allProducts],
  );
  const eligibleNames = useMemo(
    () => new Set(eligible.map((p) => p.product)),
    [eligible],
  );
  // Saved counts whose product is no longer pickable (廃盤/除外に
  // なった、または一覧に無い）: hidden here, preserved on save.
  const hiddenItems = (initial?.items ?? []).filter(
    (item) => !eligibleNames.has(item.product),
  );
  const visible = eligible.filter((p) => matchesQuery(search, p.product));

  const enteredItems = memoItemsFromQuantities(quantities);
  const enteredTotal = enteredItems.reduce((s, i) => s + i.qty, 0);
  const urlInvalidNow = !memoUrlState(url).valid;
  const hasInputContent =
    url.trim() !== "" ||
    memo.trim() !== "" ||
    Object.values(quantities).some((v) => v.trim() !== "" && Number(v) > 0);
  const canReset = savedExists || hasInputContent;

  // Fixed width on purpose: this class is used only for the
  // per-product count inputs below. It must NOT carry w-full —
  // combined with the row's flex layout, a full-width shrink-0
  // input squeezed the product-name label to zero width (names
  // invisible, stray horizontal scrollbar), the display bug
  // reported 2026-11-17. The width itself is w-14: about half
  // the earlier w-24, per the user's request (2026-11-17) —
  // at text-base, 56px still leaves ~38px of content width,
  // enough for a 3-digit count and the 「冊数」 placeholder
  // without clipping, and the freed space goes to the
  // product-name label (flex-1) so names truncate later.
  const numInputCls =
    "w-14 shrink-0 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-base text-[var(--text)]";

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-ledger text-sm font-bold">{dateLabel(date)}のイベントメモ</p>
          {eventName && (
            <p className="mt-0.5 text-sm break-words">{eventName}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs whitespace-nowrap"
        >
          閉じる
        </button>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">
        <div>
          <label htmlFor={`inv-url-${date}`} className={labelCls}>
            URL（公式サイトなど）
          </label>
          <input
            {...FIELDS.saveInventoryMemo.url}
            id={`inv-url-${date}`}
            type="url"
            inputMode="url"
            className={inputCls}
            value={url}
            aria-invalid={urlInvalidNow || undefined}
            aria-describedby={error ? `inv-error-${date}` : undefined}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
          {urlInvalidNow && (
            <p className="mt-1 text-xs text-[var(--accent)]">
              URLの形式が正しくないため、このURLはまだ保存されていません（メモ・冊数は自動で保存されます）。
            </p>
          )}
        </div>

        <div>
          <p className={labelCls}>頒布物ごとの冊数（送った／持っていく冊数）</p>
          {productsQuery.isPending ? (
            <p className="text-sm text-[var(--dim)]">頒布物の一覧を読み込み中…</p>
          ) : productsQuery.error ? (
            <p role="alert" className="text-sm text-[var(--accent)]">
              頒布物の一覧を読み込めませんでした：{String(productsQuery.error)}
            </p>
          ) : eligible.length === 0 ? (
            <p className="text-sm text-[var(--dim)]">
              記録できる頒布物がありません（廃盤・除外の頒布物は表示されません）。
            </p>
          ) : (
            <>
              <input
                type="search"
                aria-label="頒布物名で絞り込み"
                placeholder="頒布物名で絞り込み"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={inputCls}
              />
              {/* The single column is minmax(0, 1fr) on purpose: a
                  plain auto column sizes to the widest row's
                  max-content — the longest product name, which is
                  nowrap for truncation — so on phone widths the
                  rows grew past the dialog and pushed the count
                  inputs off-screen (reported 2026-11-17, after the
                  input-width fix alone proved not enough). The
                  outer form grid carries the same template for the
                  same reason. */}
              <ul className="mt-2 grid max-h-72 grid-cols-[minmax(0,1fr)] gap-1.5 overflow-y-auto pr-1">
                {visible.map((p) => (
                  <li
                    key={p.product}
                    className="flex min-w-0 items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5"
                  >
                    <label
                      htmlFor={`inv-qty-${date}-${p.product}`}
                      className="min-w-0 flex-1 truncate text-sm"
                    >
                      {p.product}
                    </label>
                    <input
                      {...FIELDS.saveInventoryMemo.items.qty}
                      id={`inv-qty-${date}-${p.product}`}
                      type="number"
                      inputMode="numeric"
                      className={numInputCls}
                      value={quantities[p.product] ?? ""}
                      aria-invalid={qtyInvalid || undefined}
                      aria-describedby={error ? `inv-error-${date}` : undefined}
                      onChange={(e) =>
                        setQuantities((prev) => ({
                          ...prev,
                          [p.product]: e.target.value,
                        }))
                      }
                      placeholder="冊数"
                    />
                    <span className="shrink-0 text-sm text-[var(--dim)]">冊</span>
                  </li>
                ))}
                {visible.length === 0 && (
                  <li className="px-1 py-2 text-sm text-[var(--dim)]">
                    絞り込みに合う頒布物がありません。
                  </li>
                )}
              </ul>
              <p className="tnum mt-1 text-xs text-[var(--dim)]">
                入力済み：{enteredItems.length}頒布物・合計{enteredTotal.toLocaleString("ja-JP")}冊（空欄・0の頒布物は保存されません）
              </p>
              {hiddenItems.length > 0 && (
                <p className="mt-1 text-xs text-[var(--dim)]">
                  ※ {hiddenItems.map((i) => i.product).join("、")} は廃盤・除外のため一覧に出ませんが、保存済みの冊数（
                  {hiddenItems.map((i) => `${i.product} ${i.qty}冊`).join("、")}
                  ）はそのまま残ります。
                </p>
              )}
            </>
          )}
        </div>

        <div>
          <label htmlFor={`inv-memo-${date}`} className={labelCls}>
            メモ（自由入力）
          </label>
          <textarea
            {...FIELDS.saveInventoryMemo.memo}
            id={`inv-memo-${date}`}
            className={`${inputCls} min-h-24`}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="例：宅配便で前日に送付、残りは当日手持ち"
          />
        </div>
      </div>

      {error && (
        <p role="alert" id={`inv-error-${date}`} className="mt-2 text-sm text-[var(--accent)]">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirmingReset ? (
          <>
            <span className="text-sm">リセットしますか？</span>
            <button
              type="button"
              onClick={() => void doReset()}
              className="rounded-[var(--radius)] bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white"
            >
              リセットする
            </button>
            <button
              type="button"
              onClick={() => setConfirmingReset(false)}
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              やめる
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!canReset}
            onClick={() => setConfirmingReset(true)}
            className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
          >
            リセット
          </button>
        )}
        <p role="status" aria-live="polite" className="ml-auto text-xs text-[var(--dim)]">
          {status === "unsaved" && "未保存の変更があります"}
          {status === "saving" && "保存中…"}
          {status === "saved" && "保存しました"}
          {status === "error" && (
            <span className="font-medium text-[var(--accent)]">保存できませんでした</span>
          )}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

type TicketTypeValue = "" | "paper_arrived" | "paper_pending" | "electronic" | "none";

function toTicketTypeValue(v: string): TicketTypeValue {
  return v === "paper_arrived" ||
    v === "paper_pending" ||
    v === "electronic" ||
    v === "none"
    ? v
    : "";
}

/** Payload of one 参加前確認 save (what saveEventPrep stores). */
type PrepPayload = {
  checkPop: boolean;
  checkAnnounce: boolean;
  checkTicket: boolean;
  checkPacking: boolean;
  entryTime: string;
  startTime: string;
  endTime: string;
  space: string;
  venue: string;
  ticketType: TicketTypeValue;
  guideUrl: string;
  guideByMail: boolean;
};

function prepPayloadKey(p: PrepPayload): string {
  return JSON.stringify([
    p.checkPop,
    p.checkAnnounce,
    p.checkTicket,
    p.checkPacking,
    p.entryTime,
    p.startTime,
    p.endTime,
    p.space,
    p.venue,
    p.ticketType,
    p.guideUrl,
    p.guideByMail,
  ]);
}

/** 「11:00〜16:00」 form for the recorded hours; either side may be blank. */
function prepTimeRange(startTime: string, endTime: string): string | null {
  if (!startTime && !endTime) return null;
  return `${startTime}〜${endTime}`;
}

/**
 * 参加前確認 editor, shown in the day detail ABOVE the sales record
 * while the date is today or later (Asia/Tokyo). Small type
 * throughout, per the user's request. One row of four departure
 * checkboxes (POP/お品書き・参加告知・チケットOK・荷造りOK), then
 * a row with the entry start time (入場開始時間）, the event's
 * hours, and the circle's space number; the ticket-format row below
 * also carries the 場所 input — a prep-side override that never
 * touches the event registration: while it is empty the
 * registration's venue shows as the placeholder, and a typed value
 * wins over it everywhere the venue is displayed. One guide URL
 * (PDF etc.), which renders as a link once it is a valid http/https
 * URL, with a 「メールで来た」 check at the left of its row.
 *
 * Autosave like the イベントメモ editor: no save button. Checks
 * and the ticket select save immediately; text / time / URL fields
 * save about a second after input settles. While the typed guide
 * URL is not a valid http/https URL yet, only the URL is held back
 * (the payload keeps the last saved URL and a note shows under the
 * field); everything else still saves.
 */
function PrepSection({
  date,
  venue,
  prefecture,
  city,
  initial,
}: {
  date: string;
  venue: string;
  prefecture: string;
  city: string;
  initial: DayDetail["prep"];
}) {
  const queryClient = useQueryClient();
  const [checkPop, setCheckPop] = useState(initial?.checkPop ?? false);
  const [checkAnnounce, setCheckAnnounce] = useState(initial?.checkAnnounce ?? false);
  const [checkTicket, setCheckTicket] = useState(initial?.checkTicket ?? false);
  const [checkPacking, setCheckPacking] = useState(initial?.checkPacking ?? false);
  const [entryTime, setEntryTime] = useState(initial?.entryTime ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [space, setSpace] = useState(initial?.space ?? "");
  const [prepVenue, setPrepVenue] = useState(initial?.venue ?? "");
  const [ticketType, setTicketType] = useState<TicketTypeValue>(() =>
    toTicketTypeValue(initial?.ticketType ?? ""),
  );
  const [guideUrl, setGuideUrl] = useState(initial?.guideUrl ?? "");
  const [guideByMail, setGuideByMail] = useState(initial?.guideByMail ?? false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "unsaved" | "saving" | "saved" | "error"
  >("idle");

  const valuesRef = useRef<PrepPayload>({
    checkPop,
    checkAnnounce,
    checkTicket,
    checkPacking,
    entryTime,
    startTime,
    endTime,
    space,
    venue: prepVenue,
    ticketType,
    guideUrl,
    guideByMail,
  });
  valuesRef.current = {
    checkPop,
    checkAnnounce,
    checkTicket,
    checkPacking,
    entryTime,
    startTime,
    endTime,
    space,
    venue: prepVenue,
    ticketType,
    guideUrl,
    guideByMail,
  };
  const savedRef = useRef<PrepPayload>({
    checkPop: initial?.checkPop ?? false,
    checkAnnounce: initial?.checkAnnounce ?? false,
    checkTicket: initial?.checkTicket ?? false,
    checkPacking: initial?.checkPacking ?? false,
    entryTime: initial?.entryTime ?? "",
    startTime: initial?.startTime ?? "",
    endTime: initial?.endTime ?? "",
    space: initial?.space ?? "",
    venue: initial?.venue ?? "",
    ticketType: toTicketTypeValue(initial?.ticketType ?? ""),
    guideUrl: initial?.guideUrl ?? "",
    guideByMail: initial?.guideByMail ?? false,
  });
  const timerRef = useRef<number | null>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["overview"] });
    void queryClient.invalidateQueries({ queryKey: ["day", date] });
  }, [queryClient, date]);

  const runSave = useCallback((): Promise<boolean> => {
    const task = async (): Promise<boolean> => {
      for (let pass = 0; pass < 5; pass++) {
        const cur = valuesRef.current;
        const urlState = memoUrlState(cur.guideUrl);
        const payload: PrepPayload = {
          ...cur,
          space: cur.space.trim(),
          venue: cur.venue.trim(),
          guideUrl: urlState.valid ? urlState.trimmed : savedRef.current.guideUrl,
        };
        if (prepPayloadKey(payload) === prepPayloadKey(savedRef.current)) {
          setError(null);
          setStatus("saved");
          return true;
        }
        setStatus("saving");
        try {
          await api.saveEventPrep({ date, ...payload });
        } catch (e) {
          setStatus("error");
          setError(`保存できませんでした：${String(e)}`);
          return false;
        }
        savedRef.current = payload;
        setError(null);
        setStatus("saved");
        invalidate();
      }
      return true;
    };
    const p = chainRef.current.then(task, task);
    chainRef.current = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }, [date, invalidate]);

  // Debounced autosave for the text / time / URL fields (the first
  // render is skipped — merely opening the detail saves nothing).
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    setStatus((s) => (s === "saving" ? s : "unsaved"));
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void runSave();
    }, 1000);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [entryTime, startTime, endTime, space, prepVenue, guideUrl, runSave]);

  // Checks and the ticket select save immediately: update the ref
  // synchronously so the save reads the new value, cancel any
  // pending debounce, and save now.
  const saveNow = (patch: Partial<PrepPayload>) => {
    valuesRef.current = { ...valuesRef.current, ...patch };
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void runSave();
  };

  const urlInvalidNow = !memoUrlState(guideUrl).valid;
  const linkUrl = (() => {
    const s = memoUrlState(guideUrl);
    return s.valid && s.trimmed !== "" ? s.trimmed : null;
  })();

  const smallInputCls =
    "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]";

  return (
    <section
      aria-label="参加前確認"
      className="mt-3 rounded-[var(--radius)] border border-[var(--border)] px-3 py-2.5"
    >
      <h3 className="font-ledger text-sm font-bold">参加前確認</h3>
      <div className="mt-2 grid gap-2">
        {/* The four checks stay on ONE line even at phone widths
            (user request): text-xs, tight gaps, no wrapping. */}
        <div className="flex flex-nowrap gap-x-3" role="group" aria-label="出発前チェック">
          <label className="flex items-center gap-1 text-xs whitespace-nowrap">
            <input
              type="checkbox"
              checked={checkPop}
              onChange={(e) => {
                setCheckPop(e.target.checked);
                saveNow({ checkPop: e.target.checked });
              }}
              className="h-4 w-4 shrink-0"
              style={{ accentColor: "var(--accent)" }}
            />
            POP/お品書き
          </label>
          <label className="flex items-center gap-1 text-xs whitespace-nowrap">
            <input
              type="checkbox"
              checked={checkAnnounce}
              onChange={(e) => {
                setCheckAnnounce(e.target.checked);
                saveNow({ checkAnnounce: e.target.checked });
              }}
              className="h-4 w-4 shrink-0"
              style={{ accentColor: "var(--accent)" }}
            />
            参加告知
          </label>
          <label className="flex items-center gap-1 text-xs whitespace-nowrap">
            <input
              type="checkbox"
              checked={checkTicket}
              onChange={(e) => {
                setCheckTicket(e.target.checked);
                saveNow({ checkTicket: e.target.checked });
              }}
              className="h-4 w-4 shrink-0"
              style={{ accentColor: "var(--accent)" }}
            />
            チケットOK
          </label>
          <label className="flex items-center gap-1 text-xs whitespace-nowrap">
            <input
              type="checkbox"
              checked={checkPacking}
              onChange={(e) => {
                setCheckPacking(e.target.checked);
                saveNow({ checkPacking: e.target.checked });
              }}
              className="h-4 w-4 shrink-0"
              style={{ accentColor: "var(--accent)" }}
            />
            荷造りOK
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-1">
            <span className="text-xs text-[var(--dim)]">入場開始</span>
            <input
              type="time"
              step={600}
              aria-label="入場開始時間"
              value={entryTime}
              onChange={(e) => setEntryTime(e.target.value)}
              className={smallInputCls}
            />
          </span>
          <span className="flex items-center gap-1">
            <span className="text-xs text-[var(--dim)]">開催時間</span>
            <input
              type="time"
              step={600}
              aria-label="開始時刻"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={smallInputCls}
            />
            <span className="text-sm text-[var(--dim)]">〜</span>
            <input
              type="time"
              step={600}
              aria-label="終了時刻"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={smallInputCls}
            />
          </span>
          <label className="flex items-center gap-1">
            <span className="text-xs text-[var(--dim)]">スペース</span>
            <input
              {...FIELDS.saveEventPrep.space}
              type="text"
              aria-label="スペース番号"
              value={space}
              onChange={(e) => setSpace(e.target.value)}
              placeholder="例：15B"
              className={`${smallInputCls} w-24`}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`prep-ticket-${date}`} className="text-xs text-[var(--dim)]">
            チケット
          </label>
          <div className="relative">
            <select
              id={`prep-ticket-${date}`}
              value={ticketType}
              onChange={(e) => {
                const v = toTicketTypeValue(e.target.value);
                setTicketType(v);
                saveNow({ ticketType: v });
              }}
              className={`${smallInputCls} appearance-none pr-8`}
            >
              <option value="">未選択</option>
              {TICKET_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-[var(--dim)]"
            >
              ▼
            </span>
          </div>
          <label className="flex items-center gap-1">
            <span className="text-xs text-[var(--dim)]">場所</span>
            <input
              {...FIELDS.saveEventPrep.venue}
              type="text"
              aria-label="場所"
              value={prepVenue}
              onChange={(e) => setPrepVenue(e.target.value)}
              placeholder={venue || "場所"}
              className={`${smallInputCls} w-40`}
            />
          </label>
          {/* MAP: opens Google Maps in a new tab searching for the
              displayed venue (prep-side input wins, else the event
              registration's venue), with the day's prefecture and
              city in the query to avoid same-name mix-ups. Hidden
              while no venue is available at all. */}
          {(() => {
            const mapVenue = prepVenue.trim() || venue.trim();
            if (!mapVenue) return null;
            const query = [prefecture.trim(), city.trim(), mapVenue]
              .filter(Boolean)
              .join(" ");
            return (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Googleマップで「${mapVenue}」を開く`}
                className={`${smallInputCls} shrink-0 font-medium no-underline`}
              >
                MAP
              </a>
            );
          })()}
        </div>

        <div>
          <label htmlFor={`prep-guide-${date}`} className={labelCls}>
            案内URL（PDFなど）
          </label>
          <div className="flex items-center gap-2">
            <label className="flex shrink-0 items-center gap-1 text-xs whitespace-nowrap">
              <input
                type="checkbox"
                checked={guideByMail}
                onChange={(e) => {
                  setGuideByMail(e.target.checked);
                  saveNow({ guideByMail: e.target.checked });
                }}
                className="h-4 w-4 shrink-0"
                style={{ accentColor: "var(--accent)" }}
              />
              メールで来た
            </label>
            <input
              {...FIELDS.saveEventPrep.guideUrl}
              id={`prep-guide-${date}`}
              type="url"
              inputMode="url"
              value={guideUrl}
              aria-invalid={urlInvalidNow || undefined}
              onChange={(e) => setGuideUrl(e.target.value)}
              placeholder="https://…"
              className={`${smallInputCls} min-w-0 flex-1`}
            />
          </div>
          {urlInvalidNow ? (
            <p className="mt-1 text-xs text-[var(--accent)]">
              URLの形式が正しくないため、このURLはまだ保存されていません（他の項目は自動で保存されます）。
            </p>
          ) : linkUrl ? (
            <p className="mt-1 text-xs">
              <a
                href={linkUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-[var(--ai)] underline"
              >
                {linkUrl}
              </a>
            </p>
          ) : null}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-[var(--accent)]">
          {error}
        </p>
      )}
      <p role="status" aria-live="polite" className="mt-1.5 text-right text-xs text-[var(--dim)]">
        {status === "unsaved" && "未保存の変更があります"}
        {status === "saving" && "保存中…"}
        {status === "saved" && "保存しました"}
        {status === "error" && (
          <span className="font-medium text-[var(--accent)]">保存できませんでした</span>
        )}
      </p>
    </section>
  );
}

/**
 * Read-only 参加前確認 summary archived at the TOP of the
 * イベントメモ body once the date has passed: only the items that
 * were actually recorded (check state, hours, venue, space, ticket
 * format, guide link). Renders nothing when nothing was recorded.
 */
function PrepArchive({
  prep,
  venue,
}: {
  prep: NonNullable<DayDetail["prep"]>;
  venue: string;
}) {
  const timeRange = prepTimeRange(prep.startTime, prep.endTime);
  const ticketLabel = ticketTypeLabel(prep.ticketType);
  const guideLink = (() => {
    if (!prep.guideUrl) return null;
    try {
      const u = new URL(prep.guideUrl);
      return u.protocol === "http:" || u.protocol === "https:" ? prep.guideUrl : null;
    } catch {
      return null;
    }
  })();
  const anyCheck =
    prep.checkPop || prep.checkAnnounce || prep.checkTicket || prep.checkPacking;
  const checkMark = (done: boolean) => (done ? "✓" : "―");
  // The prep-side venue wins over the event registration's venue,
  // same priority as in the editor.
  const displayVenue = prep.venue || venue;
  return (
    <div className="mb-2 border-b border-dashed border-[var(--border)] pb-2 text-xs">
      <p className="font-bold">参加前確認</p>
      {anyCheck && (
        <p className="mt-0.5">
          出発前チェック：POP/お品書き {checkMark(prep.checkPop)}・参加告知{" "}
          {checkMark(prep.checkAnnounce)}・チケットOK {checkMark(prep.checkTicket)}
          ・荷造りOK {checkMark(prep.checkPacking)}
        </p>
      )}
      {(prep.entryTime || timeRange) && (
        <p className="mt-0.5">
          {prep.entryTime && <>入場開始：{prep.entryTime}</>}
          {prep.entryTime && timeRange && "／"}
          {timeRange && <>開催時間：{timeRange}</>}
        </p>
      )}
      {displayVenue && <p className="mt-0.5">場所：{displayVenue}</p>}
      {prep.space && <p className="mt-0.5">スペース：{prep.space}</p>}
      {ticketLabel && <p className="mt-0.5">チケット：{ticketLabel}</p>}
      {guideLink && (
        <p className="mt-0.5">
          案内{prep.guideByMail ? "（メールで来た）" : ""}：
          <a
            href={guideLink}
            target="_blank"
            rel="noreferrer"
            className="break-all text-[var(--ai)] underline"
          >
            {guideLink}
          </a>
        </p>
      )}
      {!guideLink && prep.guideByMail && <p className="mt-0.5">案内：メールで来た</p>}
    </div>
  );
}

/**
 * Read-only イベントメモ section inside the day detail: the saved URL as
 * a tappable link, the per-product counts with their total, and the
 * free memo — plus the edit entry point. Shown for every day,
 * including future event dates with no sales yet.
 *
 * Collapsible: tapping the heading toggles the body. The initial
 * state follows whether the day has sales entered — days WITH sales
 * start collapsed (the memo is mostly for upcoming events), days
 * WITHOUT sales (future events etc.) start open. The heading always
 * shows whether a memo exists and its total count, so a collapsed
 * section still tells the user what is saved.
 */
function InventoryMemoSection({
  date,
  eventName,
  memo,
  hasSales,
  prep,
  venue,
}: {
  date: string;
  eventName: string;
  memo: DayDetail["inventoryMemo"];
  hasSales: boolean;
  /** 参加前確認 for this date; archived read-only at the top of
   * this section once the date has passed (see showArchive). */
  prep: DayDetail["prep"];
  venue: string;
}) {
  const masked = useMasked();
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(() => !hasSales);
  // Closing the editor dialog goes through the editor's close
  // guard (registered while the editor is mounted): any unsaved
  // change is flushed first, and the dialog stays open when the
  // flush cannot save (or a still-invalid URL would be lost).
  // Every close path — the editor's 閉じる buttons, the backdrop,
  // Esc — funnels into requestClose / the Modal's Esc veto.
  const closeGuardRef = useRef<{
    flush: () => Promise<boolean>;
    veto: () => boolean;
  } | null>(null);
  const registerCloseGuard = useCallback(
    (guard: { flush: () => Promise<boolean>; veto: () => boolean } | null) => {
      closeGuardRef.current = guard;
    },
    [],
  );
  const requestClose = useCallback(() => {
    const guard = closeGuardRef.current;
    if (!guard) {
      setEditing(false);
      return;
    }
    void guard.flush().then((ok) => {
      if (ok) setEditing(false);
    });
  }, []);
  const closeVeto = useCallback(
    () => closeGuardRef.current?.veto() ?? false,
    [],
  );
  // 参加前確認の収納表示： once the date is in the past (Asia/Tokyo),
  // the recorded prep is archived read-only at the top of this
  // section. Upcoming days show the editable PrepSection above the
  // sales record instead, so nothing is archived for them here.
  const showArchive = prep !== null && date < todayInTokyo();
  // Only http/https URLs ever reach storage (enforced on save), but
  // render as a link only when the stored value still parses as one.
  const linkUrl = (() => {
    if (!memo?.url) return null;
    try {
      const u = new URL(memo.url);
      return u.protocol === "http:" || u.protocol === "https:" ? memo.url : null;
    } catch {
      return null;
    }
  })();

  return (
    <section
      aria-label="イベントメモ"
      className="mt-4 border-t border-dashed border-[var(--border)] pt-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-ledger text-sm font-bold">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`inventory-memo-body-${date}`}
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 text-left"
          >
            <span aria-hidden className="text-xs text-[var(--dim)]">
              {open ? "▼" : "▶"}
            </span>
            イベントメモ
            <span className="text-xs font-normal text-[var(--dim)]">
              {memo
                ? memo.items.length > 0
                  ? `（${memo.items.length}頒布物・合計${qtyMasked(memo.totalQty, masked)}冊）`
                  : "（登録あり）"
                : "（未登録）"}
            </span>
          </button>
        </h3>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-xs font-medium"
        >
          {memo ? "イベントメモを編集" : "イベントメモを追加"}
        </button>
      </div>
      {open && (
        /* The toggle lives ONLY on the heading button above; clicks
           in the body never open or close the section (stopPropagation
           is belt-and-braces). The body carries its own generous
           padding (16px sides / 12px top-bottom) plus a gap from the
           heading, so the link, table, and text never sit against
           the section's edges (user report 2026-11-17: tapping near
           the boundary felt like it closed the frame). */
        <div
          id={`inventory-memo-body-${date}`}
          className={memo || showArchive ? "mt-2 px-4 py-3" : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          {showArchive && prep && <PrepArchive prep={prep} venue={venue} />}
          {memo ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 text-sm">
          {linkUrl && (
            <p>
              <span className="text-xs text-[var(--dim)]">URL：</span>
              <a
                href={linkUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-[var(--ai)] underline"
              >
                {linkUrl}
              </a>
            </p>
          )}
          {memo.items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--dim)]">
                  <th scope="col" className="py-1 pr-2 font-medium">頒布物</th>
                  <th scope="col" className="py-1 text-right font-medium">送った冊数</th>
                </tr>
              </thead>
              <tbody>
                {memo.items.map((i) => (
                  <tr key={i.product} className="border-b border-[var(--border)]/50">
                    <td className="py-1.5 pr-2">{i.product}</td>
                    <td className="tnum py-1.5 text-right align-top">
                      {qtyMasked(i.qty, masked)}冊
                    </td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="py-1.5 pr-2">合計</td>
                  <td className="tnum py-1.5 text-right">
                    {qtyMasked(memo.totalQty, masked)}冊
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          {memo.memo && <p className="whitespace-pre-wrap">{memo.memo}</p>}
        </div>
      ) : null}
        </div>
      )}
      <Modal
        open={editing}
        onClose={requestClose}
        closeVeto={closeVeto}
        label={
          eventName
            ? `${dateLabel(date)} ${eventName} のイベントメモ`
            : `${dateLabel(date)}のイベントメモ`
        }
      >
        <InventoryMemoEditor
          date={date}
          eventName={eventName}
          initial={memo}
          onClose={requestClose}
          registerCloseGuard={registerCloseGuard}
        />
      </Modal>
    </section>
  );
}

function DayDetailView({ date }: { date: string }) {
  const masked = useMasked();
  const { hideDiscontinued } = useDisplaySettings();
  const detail = useQuery({
    queryKey: ["day", date],
    queryFn: () => api.getDayDetail({ date }),
  });
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [salesEditing, setSalesEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const removeDay = useMutation({
    mutationFn: async () => await api.deleteSalesDay({ date }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      void queryClient.invalidateQueries({ queryKey: ["cities"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["typeBreakdownDays"] });
      void queryClient.invalidateQueries({ queryKey: ["day", date] });
    },
    onError: (e) => setDeleteError(String(e)),
  });

  if (detail.isPending) return <p className="py-3 text-sm text-[var(--dim)]">読み込み中…</p>;
  if (detail.error)
    return (
      <p role="alert" className="py-3 text-sm text-[var(--accent)]">
        読み込めませんでした：{String(detail.error)}
      </p>
    );
  const data = detail.data;
  // 表示設定「『廃盤』の頒布物を表示しない」: 廃盤の行だけを画面から
  // 外す。合計は従来どおり廃盤分も含めて全行から計算する（表示だけ
  // の非表示で、データ・集計は変えない）。
  const visibleRows = hideDiscontinued
    ? data.rows.filter((r) => !r.discontinued)
    : data.rows;
  const hiddenDiscontinuedCount = data.rows.length - visibleRows.length;
  const totalQty = data.rows.reduce((s, r) => s + r.qty, 0);
  const totalNet = data.rows.reduce((s, r) => s + r.net, 0);

  return (
    <div className="border-t border-dashed border-[var(--border)] px-4 py-3">
      {data.event ? (
        data.event.note ? (
          <p className="text-sm">{data.event.note}</p>
        ) : null
      ) : (
        <p className="text-sm text-[var(--dim)]">
          この日のイベントは未登録です。登録すると都市別・イベント別に集計できます。
        </p>
      )}
      {data.flags.salesUnreliable && (
        <p className="mt-2 text-sm">
          <FlagBadge />
          <span className="ml-2 text-[var(--dim)]">
            売上は参考情報です（元のデータがきちんと入力できていない可能性があります）
          </span>
        </p>
      )}

      {/* 参加前確認： while the date is today or later (Asia/Tokyo)
          it sits editable above the sales record; once the date
          has passed it is archived at the top of the イベントメモ
          section below instead. */}
      {date >= todayInTokyo() && (
        <PrepSection
          date={date}
          venue={data.event?.venue ?? ""}
          prefecture={data.event?.prefecture ?? ""}
          city={data.event?.city ?? ""}
          initial={data.prep}
        />
      )}

      {data.rows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--dim)]">
          この日の売上記録はまだありません。下の「売上を追加」から追加できます（各種CSV取込でも表示されます）。
        </p>
      ) : (
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--dim)]">
            <th scope="col" className="py-1 pr-2 font-medium">頒布物</th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">冊数</th>
            <th scope="col" className="py-1 text-right font-medium">売上</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => (
            <tr key={r.product} className="border-b border-[var(--border)]/50">
              <td className="py-1.5 pr-2">
                {r.product === "任意の金額" ? (
                  <>
                    任意の金額
                    <span className="ml-2 text-xs text-[var(--dim)]">
                      （頒布物不明・本の集計には含めません）
                    </span>
                  </>
                ) : (
                  <>
                    {r.product}
                    {r.category && (
                      <span className="ml-2 text-xs text-[var(--dim)]">{r.category}</span>
                    )}
                  </>
                )}
                {(r.isFirstAppearance ||
                  (r.appearanceNo !== null && r.appearanceNo >= 2) ||
                  r.daysSinceRelease !== null ||
                  r.productSalesUnreliable ||
                  r.discontinued ||
                  r.soldOut) && (
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {r.isFirstAppearance && <FirstAppearanceBadge />}
                    {r.appearanceNo !== null && r.appearanceNo >= 2 && (
                      <span className="text-xs text-[var(--dim)]">{r.appearanceNo}回目</span>
                    )}
                    {r.daysSinceRelease !== null && (
                      <span className="text-xs text-[var(--dim)]">
                        {releaseAgeLabel(r.daysSinceRelease)}
                      </span>
                    )}
                    {r.productSalesUnreliable && <ProductRefBadge label="除外" />}
                    {r.discontinued && <DiscontinuedBadge prominent />}
                    {r.soldOut && <SoldOutBadge />}
                  </span>
                )}
              </td>
              <td className="tnum py-1.5 pr-2 text-right align-top">{qtyMasked(r.qty, masked)}</td>
              <td className="tnum py-1.5 text-right align-top">{yenMasked(r.net, masked)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="py-1.5 pr-2">合計</td>
            <td className="tnum py-1.5 pr-2 text-right">{qtyMasked(totalQty, masked)}</td>
            <td className="tnum py-1.5 text-right">{yenMasked(totalNet, masked)}</td>
          </tr>
        </tbody>
      </table>
      )}
      {hiddenDiscontinuedCount > 0 && (
        <p className="mt-2 text-xs text-[var(--dim)]">
          廃盤の頒布物{hiddenDiscontinuedCount}件は表示設定で隠しています（合計には含まれています）。
        </p>
      )}

      <button
        type="button"
        onClick={() => setSalesEditing(true)}
        className="mt-3 mr-2 rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm font-medium"
      >
        {data.rows.length > 0 ? "売上を追加・編集" : "売上を追加"}
      </button>
      <Modal
        open={salesEditing}
        onClose={() => setSalesEditing(false)}
        label={`${dateLabel(date)}の売上を編集`}
      >
        <SalesEditor date={date} rows={data.rows} onClose={() => setSalesEditing(false)} />
      </Modal>

      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-3 rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm font-medium"
      >
        {data.event ? "イベント情報を編集" : "イベントを登録"}
      </button>
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        label={`${dateLabel(date)}のイベント${data.event ? "情報を編集" : "を登録"}`}
      >
        <EventForm
          date={date}
          initial={data.event}
          initialFlags={data.flags}
          onDone={() => setEditing(false)}
        />
      </Modal>

      <InventoryMemoSection
        date={date}
        eventName={data.event?.eventName ?? ""}
        memo={data.inventoryMemo}
        hasSales={data.rows.length > 0}
        prep={data.prep}
        venue={data.event?.venue ?? ""}
      />

      {data.rows.length > 0 && totalNet === 0 && totalQty === 0 && (
      <div className="mt-4 border-t border-dashed border-[var(--border)] pt-3">
        {confirmingDelete ? (
          <div>
            <p className="text-sm">
              {dateLabel(date)}の売上記録（{data.rows.length}頒布物）とイベント登録・フラグ・イベントメモをすべて削除します。この操作は取り消せません。
            </p>
            {deleteError && (
              <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
                削除できませんでした：{deleteError}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={removeDay.isPending}
                onClick={() => removeDay.mutate()}
                className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {removeDay.isPending ? "削除中…" : "削除する"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm"
              >
                やめる
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setConfirmingDelete(true);
              }}
              className="px-1 py-1 text-sm text-[var(--accent)] underline"
            >
              この日を削除
            </button>
            <span className="text-xs text-[var(--dim)]">
              売上0円・0冊の日は、台帳から取り除けます。
            </span>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

/** Day-level 「参考情報」 chip, shown on day rows and in the day detail. */
export function FlagBadge() {
  return (
    <span className="inline-block rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-[var(--accent)]">
      参考情報
    </span>
  );
}

/**
 * Event-type chip for one day: the manual setting when one is stored,
 * otherwise classified from the registered event name (see
 * eventType.ts). Renders nothing for unregistered days — their type
 * is unknown, not 「その他」. With `hideOther`, a day whose type is
 * the fallback （その他） renders nothing either — the イベント一覧
 * passes it so unclassifiable days carry no chip there; the other
 * DayRow consumers （都市別・未登録チェック） keep the chip.
 */
export function EventTypeBadge({
  day,
  hideOther = false,
}: {
  day: DaySummary;
  hideOther?: boolean;
}) {
  const types = useEventTypes();
  if (day.eventName === null) return null;
  const resolved = resolveEventType(day.eventName, day.eventType, types);
  if (hideOther && resolved === fallbackTypeKey(types)) return null;
  const label = typeLabel(types, resolved);
  return (
    <span className="inline-block rounded-full bg-[var(--surface-alt)] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-[var(--dim)]">
      {label}
    </span>
  );
}

/** The flag chip for one day, or null when the flag is not set. */
export function DayFlagBadges({ day }: { day: DaySummary }) {
  if (!day.salesUnreliable) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      <FlagBadge />
    </span>
  );
}

/** Today as YYYY-MM-DD in the user's timezone (Asia/Tokyo). */
function todayInTokyo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function DayRow({
  day,
  open,
  onToggle,
  compareMode = false,
  compareChecked = false,
  onCompareChange,
  hideOtherTypeBadge = false,
}: {
  day: DaySummary;
  open: boolean;
  onToggle: () => void;
  /**
   * 過去の頒布数を比較モード: when on, a checkbox appears at the
   * left edge of the row so the day can be picked as a comparison
   * column — but ONLY for days with sales. Days without sales
   * (event registration only) render no checkbox (an alignment
   * spacer instead) and can never be comparison targets. The
   * checkbox sits OUTSIDE the row's toggle button (a checkbox
   * inside a <button> would be invalid HTML and would toggle the
   * detail).
   */
  compareMode?: boolean;
  compareChecked?: boolean;
  onCompareChange?: () => void;
  /**
   * When on, the event-type chip is omitted for days whose type is
   * the fallback （その他）. Only the イベント一覧 passes this;
   * 都市別 and 未登録チェック rows keep the chip.
   */
  hideOtherTypeBadge?: boolean;
}) {
  const masked = useMasked();
  const registered = day.eventName !== null;
  const missing = missingEventFields(day);
  const place = [day.prefecture, day.city].filter(Boolean).join(" ");
  // これから開催（今日以降・Asia/Tokyo基準）の行は薄く色付ける。
  // 開いた行は従来どおり row-selected の強調が優先される
  // （.row-selected は非レイヤーCSSなのでユーティリティより勝つ）。
  const upcoming = day.date >= todayInTokyo();
  return (
    <div
      data-day={day.date}
      className={`border-b border-[var(--border)] ${
        upcoming ? "bg-[var(--upcoming-bg)]" : "bg-[var(--surface)]"
      } ${open ? "row-selected" : ""}`}
    >
      <div className="flex items-stretch">
        {compareMode &&
          (day.hasSales ? (
            <label className="flex shrink-0 cursor-pointer items-center pr-1 pl-3">
              <input
                type="checkbox"
                checked={compareChecked}
                onChange={() => onCompareChange?.()}
                aria-label={`${dateLabel(day.date)}${day.eventName ? ` ${day.eventName}` : ""}を過去の頒布数を比較の対象にする`}
                className="h-5 w-5 shrink-0"
                style={{ accentColor: "var(--accent)" }}
              />
            </label>
          ) : (
            // No sales on this day: no checkbox, so the day cannot
            // be picked as a comparison target. The spacer keeps
            // the row's content aligned with the checkable rows
            // (pl-3 + w-5 + pr-1 = 2.25rem, matching the label).
            <span aria-hidden className="w-9 shrink-0" />
          ))}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${dateLabel(day.date)}の詳細を${open ? "閉じる" : "開く"}`}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
        >
        <div className="min-w-0 flex-1">
          <p
            className={`tnum text-xs ${
              open ? "font-bold text-[var(--accent)]" : "text-[var(--dim)]"
            }`}
          >
            {dateLabel(day.date)}
            {open && <span className="ml-2">選択中</span>}
          </p>
          {registered ? (
            <>
              <p className="font-ledger truncate text-base font-bold">
                {day.eventName || "（イベント名なし）"}
              </p>
              <p className="truncate text-xs text-[var(--dim)]">
                {[place, day.venue].filter(Boolean).join("・") || "場所未入力"}
              </p>
              {missing.length > 0 && (
                <p className="mt-0.5 text-xs font-medium text-[var(--accent)]">
                  未入力：{missing.join("・")}
                </p>
              )}
              <span className="mt-1 flex flex-wrap gap-1.5">
                <EventTypeBadge day={day} hideOther={hideOtherTypeBadge} />
                {day.salesUnreliable && <FlagBadge />}
                {day.hasInventoryMemo && (
                  <InventoryMemoBadge totalQty={day.inventoryTotalQty} />
                )}
                {/* チケット状況バッジ: upcoming days only (the
                    `upcoming` flag is today-or-later, Asia/Tokyo);
                    past days never show it. TicketBadge itself
                    renders nothing when no format is set. */}
                {upcoming && <TicketBadge ticketType={day.ticketType} />}
                {/* チェック状況バッジ: same gating as the ticket
                    badge — upcoming days with a prep record only. */}
                {upcoming && <PrepChecksBadge checks={day.prepChecks} />}
              </span>
            </>
          ) : (
            <>
              <p className="mt-0.5 flex items-center gap-2">
                <span className="stamp">イベント未登録</span>
                {day.productCount > 0 && (
                  <span className="text-xs text-[var(--dim)]">{day.productCount}頒布物</span>
                )}
              </p>
              <DayFlagBadges day={day} />
              {(day.hasInventoryMemo ||
                (upcoming && (day.ticketType || day.prepChecks))) && (
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {day.hasInventoryMemo && (
                    <InventoryMemoBadge totalQty={day.inventoryTotalQty} />
                  )}
                  {upcoming && <TicketBadge ticketType={day.ticketType} />}
                  {upcoming && <PrepChecksBadge checks={day.prepChecks} />}
                </span>
              )}
            </>
          )}
        </div>
        <div className="shrink-0 text-right">
          {day.hasSales ? (
            <>
              <p className="tnum text-sm font-bold">{yenMasked(day.net, masked)}</p>
              <p className="tnum text-xs text-[var(--dim)]">{qtyMasked(day.qty, masked)}冊</p>
            </>
          ) : (
            // Event registered ahead of time; no sales recorded yet.
            <p className="text-xs font-medium whitespace-nowrap text-[var(--dim)]">売上なし</p>
          )}
        </div>
        <span
          aria-hidden
          className={`shrink-0 ${open ? "font-bold text-[var(--accent)]" : "text-[var(--dim)]"}`}
        >
          {open ? "▲" : "▼"}
        </span>
        </button>
      </div>
      {open && <DayDetailView date={day.date} />}
    </div>
  );
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today (Asia/Tokyo) as YYYY-MM-DD — the new-event form's default date. */
function todayTokyo(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

/**
 * 「イベントを新規登録」 entry point for the ledger tab: pick any date —
 * including one with no sales yet (e.g. an upcoming event) — and
 * register its event info (name, venue, prefecture, city, note).
 *
 * It never silently overwrites: when the chosen date already has an
 * event registered, the form is replaced by a notice plus a jump to
 * that day in the ledger, where the normal edit form lives. When the
 * date has sales but no event, the registration attaches to those
 * sales, and the day's existing flags are loaded into the form so
 * saving does not clear them.
 */
export function NewEventSection({ onOpenDay }: { onOpenDay: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayTokyo);
  const validDate = DATE_RE.test(date);
  const detail = useQuery({
    queryKey: ["day", date],
    queryFn: () => api.getDayDetail({ date }),
    enabled: open && validDate,
  });
  const existing = detail.data?.event ?? null;
  const hasSales = (detail.data?.rows.length ?? 0) > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium"
      >
        ＋ イベントを新規登録
      </button>
      <Modal open={open} onClose={() => setOpen(false)} label="イベントを新規登録">
      <div className="flex items-center justify-between gap-2">
        <p className="font-ledger text-sm font-bold">イベントを新規登録</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="shrink-0 rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-xs whitespace-nowrap"
        >
          閉じる
        </button>
      </div>
      <div className="mt-3">
        <label htmlFor="new-event-date" className={labelCls}>
          日付
        </label>
        <input
          id="new-event-date"
          type="date"
          className={inputCls}
          value={date}
          aria-invalid={!validDate || undefined}
          aria-describedby={!validDate ? "new-event-date-error" : undefined}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      {!validDate && (
        <p role="alert" id="new-event-date-error" className="mt-2 text-sm text-[var(--accent)]">
          日付を選んでください。
        </p>
      )}
      {validDate && detail.isPending && (
        <p className="mt-2 text-sm text-[var(--dim)]">その日の登録状況を確認中…</p>
      )}
      {validDate && detail.error && (
        <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
          登録状況を確認できませんでした：{String(detail.error)}
        </p>
      )}
      {validDate && detail.data && existing && (
        <div className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] p-3">
          <p className="text-sm">
            {dateLabel(date)}には、すでに「{existing.eventName || "（イベント名なし）"}」が登録されています。
          </p>
          <p className="mt-1 text-sm text-[var(--dim)]">
            新規登録で上書きはされません。内容を変えるときは、その日の行から編集してください。
          </p>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenDay(date);
            }}
            className="mt-2 rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white"
          >
            イベント一覧でその日を開く
          </button>
        </div>
      )}
      {validDate && detail.data && !existing && (
        <>
          {hasSales && (
            <p className="mt-2 text-sm text-[var(--dim)]">
              この日には売上記録があります。登録すると、その日の売上と結びつきます。
            </p>
          )}
          <div className="mt-4 border-t border-dashed border-[var(--border)] pt-3">
            <EventForm
              key={date}
              date={date}
              initial={null}
              initialFlags={detail.data.flags}
              requireEventName
              onDone={() => setOpen(false)}
              onSaved={() => onOpenDay(date)}
            />
          </div>
        </>
      )}
      </Modal>
    </div>
  );
}
