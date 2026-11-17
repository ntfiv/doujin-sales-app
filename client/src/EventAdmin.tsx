import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { matchesQuery } from "./search";
import { dateLabel } from "./format";
import { inputCls, labelCls } from "./Products";
import type { DaySummary } from "./Ledger";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";

// Input limits come from the actions' request schemas, so the form
// fields and the server can never disagree.
const FIELDS = actionFields<typeof Actions>();
import {
classifyEvent,
fallbackTypeKey,
isEventTypeId,
typeLabel,
useEventTypes,
type EventTypeDef,
} from "./eventType";

/**
 * イベント管理系のセクション（データ管理タブ内の「イベント管理」
 * サブタブに表示）。「イベント種別を一括で設定」と「イベント種別の
 * 管理」（種別そのものの追加・編集・削除）。
 */

/**
 * 「イベント種別を一括で設定」: every registered event with a type
 * picker, so manual event types can be fixed up in one pass and saved
 * in one batch (setEventTypes) — the same interaction shape as
 * 「カテゴリを一括で設定」 for products.
 *
 * Each event's type is resolved manual-first: a stored manual type
 * wins, otherwise the type is classified automatically from the event
 * name. Rows without a manual setting show their automatic result
 * dimmed （自動判定）; rows with one carry a 「手動設定」 badge and
 * still show what the automatic classification would have said.
 * Choosing 「自動判定」 in a row clears its manual setting. Draft
 * edits are local until 保存 is pressed.
 */
export function EventTypeSection({ days }: { days: DaySummary[] }) {
  const queryClient = useQueryClient();
  const types = useEventTypes();
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [search, setSearch] = useState("");
  const [onlyAuto, setOnlyAuto] = useState(false);
  const [onlyOther, setOnlyOther] = useState(false);
  const [bulkType, setBulkType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Only registered days have a type at all; unregistered days are
  // 種別不明 and stay out of this list.
  const events = useMemo(
    () =>
      days
        .filter((d) => d.eventName !== null)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [days],
  );

  const current = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of events) m[d.date] = d.eventType ?? "";
    return m;
  }, [events]);
  const values = draft ?? current;
  const changed = events.filter((d) => (values[d.date] ?? "") !== (d.eventType ?? ""));
  const manualCount = events.filter((d) => (values[d.date] ?? "") !== "").length;
  // 「その他のみ表示」: the day's CURRENT type — the draft manual
  // setting when one is chosen, otherwise the automatic
  // classification — is the fallback type （その他）. Manual and
  // automatic その他 days both match.
  const otherKey = fallbackTypeKey(types);
  const visible = events.filter((d) => {
    const v = values[d.date] ?? "";
    const resolved = isEventTypeId(v, types) ? v : classifyEvent(d.eventName, types);
    return (
      matchesQuery(search, d.eventName, d.venue) &&
      (!onlyAuto || v === "") &&
      (!onlyOther || resolved === otherKey)
    );
  });

  const applyToAuto = () => {
    if (!isEventTypeId(bulkType, types)) return;
    setSaved(false);
    setError(null);
    const next = { ...values };
    for (const d of events) {
      if ((next[d.date] ?? "") === "") next[d.date] = bulkType;
    }
    setDraft(next);
  };

  const save = useMutation({
    mutationFn: async () =>
      await api.setEventTypes({
        updates: changed.map((d) => {
          const v = values[d.date] ?? "";
          return {
            date: d.date,
            eventType: isEventTypeId(v, types) ? v : "",
          };
        }),
      }),
    onSuccess: () => {
      setDraft(null);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      void queryClient.invalidateQueries({ queryKey: ["typeBreakdownDays"] });
      void queryClient.invalidateQueries({ queryKey: ["cities"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["day"] });
    },
    onError: (e) => setError(String(e)),
  });

  return (
    <section
      aria-label="イベント種別を一括で設定"
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 className="font-ledger text-base font-bold">イベント種別を一括で設定</h2>
      <p className="mt-1 text-sm text-[var(--dim)]">
        全イベントの種別をまとめて変更できます。種別は通常イベント名から自動判定され（薄字が自動判定の結果）、手動で選ぶと手動設定が優先されます。「自動判定」に戻すと推定に戻ります。変更は下の「種別の変更を保存」を押すまで反映されません。個別の変更は各日の「イベント情報を編集」からもできます。
      </p>
      <p className="tnum mt-2 text-sm">
        現在 <span className="font-bold">{manualCount}件</span> が手動設定（残り{" "}
        {events.length - manualCount}件は自動判定）
        {changed.length > 0 && (
          <span className="ml-2 font-bold text-[var(--accent)]">
            未保存の変更 {changed.length}件
          </span>
        )}
      </p>

      <div className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] p-3">
        <label htmlFor="type-bulk-fill" className={labelCls}>
          自動判定のイベントすべてに同じ種別を手動設定する
        </label>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-40 flex-1">
            <select
              id="type-bulk-fill"
              className={`${inputCls} appearance-none pr-9`}
              value={bulkType}
              onChange={(e) => setBulkType(e.target.value)}
            >
              <option value="">種別を選んでください</option>
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
          <button
            type="button"
            disabled={!isEventTypeId(bulkType, types)}
            onClick={applyToAuto}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            自動判定分に設定
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="種別設定でイベント名を検索"
          placeholder="イベント名・施設名で検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-40 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base"
        />
        <label
          htmlFor="type-only-auto"
          className="flex cursor-pointer items-center gap-2 text-sm"
        >
          <input
            id="type-only-auto"
            type="checkbox"
            aria-label="自動判定のみ表示"
            checked={onlyAuto}
            onChange={(e) => setOnlyAuto(e.target.checked)}
            className="h-4 w-4 shrink-0"
            style={{ accentColor: "var(--accent)" }}
          />
          自動判定のみ表示
        </label>
        <label
          htmlFor="type-only-other"
          className="flex cursor-pointer items-center gap-2 text-sm"
        >
          <input
            id="type-only-other"
            type="checkbox"
            aria-label="その他のみ表示"
            checked={onlyOther}
            onChange={(e) => setOnlyOther(e.target.checked)}
            className="h-4 w-4 shrink-0"
            style={{ accentColor: "var(--accent)" }}
          />
          その他のみ表示
        </label>
      </div>

      <div className="mt-2 max-h-96 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] px-2 py-1">
        {visible.map((d) => {
          const value = values[d.date] ?? "";
          const isChanged = value !== (d.eventType ?? "");
          const isManual = value !== "";
          const autoLabel = typeLabel(types, classifyEvent(d.eventName, types));
          return (
            <div key={d.date} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 basis-48 text-sm">
                <span className="tnum text-xs text-[var(--dim)]">{dateLabel(d.date)}</span>
                <span className="block truncate font-medium">
                  {d.eventName || "（イベント名なし）"}
                </span>
                <span className="block text-xs text-[var(--dim)]">
                  {isManual
                    ? `自動判定では「${autoLabel}」`
                    : `自動判定：${autoLabel}`}
                </span>
              </span>
              {isManual && (
                <span className="inline-block rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-[var(--accent)]">
                  手動設定
                </span>
              )}
              {isChanged && (
                <span className="text-xs font-bold text-[var(--accent)]">変更あり</span>
              )}
              <div className="relative w-48">
                <select
                  aria-label={`${dateLabel(d.date)} ${d.eventName ?? ""}のイベント種別`}
                  className={`w-full appearance-none rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 pr-8 text-sm ${
                    isManual ? "" : "text-[var(--dim)]"
                  }`}
                  value={value}
                  onChange={(e) => {
                    setSaved(false);
                    setError(null);
                    setDraft({ ...values, [d.date]: e.target.value });
                  }}
                >
                  <option value="">自動判定（{autoLabel}）</option>
                  {types.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
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
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-[var(--dim)]">
            条件に合うイベントがありません。
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
          保存できませんでした：{error}
        </p>
      )}
      {saved && changed.length === 0 && (
        <p className="mt-2 text-sm text-[var(--dim)]">種別の変更を保存しました。</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={changed.length === 0 || save.isPending}
          onClick={() => {
            setError(null);
            save.mutate();
          }}
          className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {save.isPending ? "保存中…" : `種別の変更を保存（${changed.length}件）`}
        </button>
        {changed.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setSaved(false);
            }}
            className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm"
          >
            変更を取り消す
          </button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// イベント種別の管理
// ---------------------------------------------------------------------------

/** One editable row of the type list. `key` is null for a type added
 *  in this editing session and not saved yet (the server generates
 *  its key on save). Keywords are edited as one comma-joined text. */
interface TypeDraftRow {
  key: string | null;
  label: string;
  keywords: string;
}

function toDraftRows(types: EventTypeDef[]): TypeDraftRow[] {
  const rows = types.map((t) => ({
    key: t.key,
    label: t.label,
    keywords: t.keywords.join(", "),
  }));
  // 「その他」 is locked to the top of the list (see
  // EventTypeManageSection); pin it first in the draft as well so
  // it can never start a session anywhere else.
  const otherIdx = rows.findIndex((r) => r.key === "other");
  if (otherIdx > 0) {
    const [other] = rows.splice(otherIdx, 1);
    if (other) rows.unshift(other);
  }
  return rows;
}

/** Splits the keyword editing text (comma / 、separated) into words. */
function parseKeywordText(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,、，]/)
        .map((k) => k.trim())
        .filter((k) => k !== ""),
    ),
  ];
}

/**
 * 「イベント種別の管理」: the type list itself — add types, rename
 * them, edit their automatic-classification keywords, reorder them
 * (list order is the classification priority), and delete them.
 * Edits are a local draft until 「種別リストの変更を保存」 is
 * pressed; saving replaces the stored list in one saveEventTypes
 * call. Deleting a type that events use asks for confirmation with
 * the usage counts first (manual settings on those events fall back
 * to automatic classification when the type is saved away).
 *
 * Exception: 「その他」 (key "other") is locked — pinned to the top
 * of the list, immovable, undeletable, and its keywords field is
 * disabled (it must stay keyword-less so its top position never
 * gives it classification priority; the server enforces the same
 * lock in saveEventTypes). Its label can still be renamed.
 */
export function EventTypeManageSection({ days }: { days: DaySummary[] }) {
  const queryClient = useQueryClient();
  const serverTypes = useEventTypes();
  const [draft, setDraft] = useState<TypeDraftRow[] | null>(null);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const rows = draft ?? toDraftRows(serverTypes);
  // 「その他」 (key "other") never carries keywords: it is the
  // keyword-less fallback, so its draft keywords are dropped here
  // (the server enforces the same on save).
  const normalized = rows.map((r) => ({
    key: r.key,
    label: r.label.trim(),
    keywords: r.key === "other" ? [] : parseKeywordText(r.keywords),
  }));
  const changed =
    JSON.stringify(normalized) !==
    JSON.stringify(
      serverTypes.map((t) => ({ key: t.key, label: t.label, keywords: t.keywords })),
    );
  const hasEmptyLabel = rows.some((r) => r.label.trim() === "");

  // How many registered events currently resolve to each type,
  // split by manual setting vs automatic classification — shown on
  // each row and in the delete confirmation.
  const usage = useMemo(() => {
    const map = new Map<string, { manual: number; auto: number }>();
    const bump = (key: string, kind: "manual" | "auto") => {
      const cur = map.get(key) ?? { manual: 0, auto: 0 };
      cur[kind] += 1;
      map.set(key, cur);
    };
    for (const d of days) {
      if (d.eventName === null) continue;
      if (isEventTypeId(d.eventType, serverTypes)) bump(d.eventType, "manual");
      else bump(classifyEvent(d.eventName, serverTypes), "auto");
    }
    return map;
  }, [days, serverTypes]);

  const edit = (next: TypeDraftRow[]) => {
    setSaved(false);
    setError(null);
    setDraft(next);
  };
  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= rows.length) return;
    // The locked 「その他」 row never moves, and no row can be
    // moved across it — it stays at the top of the list.
    if (rows[idx]?.key === "other" || rows[target]?.key === "other") return;
    const next = [...rows];
    const [row] = next.splice(idx, 1);
    if (!row) return;
    next.splice(target, 0, row);
    setConfirmIdx(null);
    edit(next);
  };
  const removeRow = (idx: number) => {
    setConfirmIdx(null);
    edit(rows.filter((_, i) => i !== idx));
  };

  const save = useMutation({
    mutationFn: async () => await api.saveEventTypes({ types: normalized }),
    onSuccess: () => {
      setDraft(null);
      setConfirmIdx(null);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["eventTypes"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      void queryClient.invalidateQueries({ queryKey: ["typeBreakdownDays"] });
      void queryClient.invalidateQueries({ queryKey: ["cities"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["day"] });
    },
    onError: (e) => setError(String(e)),
  });

  return (
    <section
      aria-label="イベント種別の管理"
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 className="font-ledger text-base font-bold">イベント種別の管理</h2>
      <p className="mt-1 text-sm text-[var(--dim)]">
        種別の追加・変更・削除ができます。自動判定はリストの上から順にキーワードを照合し、最初に一致した種別になります（並び順＝優先順）。種別名の変更は表示名のみで、手動設定したイベントにも引き継がれます。種別を削除すると、その種別を設定していたイベントは自動判定に戻ります。変更は下の「種別リストの変更を保存」を押すまで反映されません。「その他」は一番上に固定され、削除・移動はできません。キーワードを持たない受け皿なので、一番上にあっても他の種別の判定より優先されることはありません。
      </p>

      <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] px-3 py-1">
        {rows.map((r, i) => {
          const u = r.key ? usage.get(r.key) : undefined;
          const isConfirming = confirmIdx === i;
          const isLocked = r.key === "other";
          return (
            <div key={r.key ?? `new-${i}`} className="border-b py-2.5 last:border-b-0">
              <div className="flex items-start gap-2">
                <div className="flex shrink-0 flex-col gap-1 pt-0.5">
                  <button
                    type="button"
                    aria-label={`「${r.label || "新規種別"}」を上へ移動`}
                    disabled={i === 0 || isLocked || rows[i - 1]?.key === "other"}
                    onClick={() => move(i, -1)}
                    className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`「${r.label || "新規種別"}」を下へ移動`}
                    disabled={
                      i === rows.length - 1 || isLocked || rows[i + 1]?.key === "other"
                    }
                    onClick={() => move(i, 1)}
                    className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xs disabled:opacity-40"
                  >
                    ↓
                  </button>
                </div>
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <div>
                    <label htmlFor={`type-label-${i}`} className={labelCls}>
                      種別名
                    </label>
                    <input
                      {...FIELDS.saveEventTypes.types.label}
                      id={`type-label-${i}`}
                      className={inputCls}
                      value={r.label}
                      onChange={(e) =>
                        edit(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                      }
                      placeholder="例：鉄道系イベント"
                    />
                  </div>
                  <div>
                    <label htmlFor={`type-keywords-${i}`} className={labelCls}>
                      自動判定キーワード（カンマ区切り）
                    </label>
                    <input
                      id={`type-keywords-${i}`}
                      className={inputCls}
                      value={isLocked ? "" : r.keywords}
                      disabled={isLocked}
                      onChange={(e) =>
                        edit(
                          rows.map((x, j) => (j === i ? { ...x, keywords: e.target.value } : x)),
                        )
                      }
                      placeholder={
                        isLocked
                          ? "キーワードなし（どの種別にも一致しない場合の受け皿）"
                          : "例：コミティア, COMITIA"
                      }
                    />
                  </div>
                  <p className="tnum text-xs text-[var(--dim)]">
                    {isLocked && "一番上に固定（削除・移動はできません）。"}
                    {r.key === null
                      ? "新規の種別（保存すると追加されます）"
                      : u && (u.manual > 0 || u.auto > 0)
                        ? `使用中：手動設定 ${u.manual}件・自動判定 ${u.auto}件`
                        : "この種別を使っているイベントはまだありません"}
                  </p>
                </div>
                {isLocked ? (
                  <span className="shrink-0 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-alt)] px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-[var(--dim)]">
                    固定
                  </span>
                ) : (
                <button
                  type="button"
                  aria-label={`「${r.label || "新規種別"}」を削除`}
                  onClick={() => {
                    if (r.key === null) removeRow(i);
                    else setConfirmIdx(isConfirming ? null : i);
                  }}
                  className="shrink-0 rounded-[var(--radius)] border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--accent)]"
                >
                  削除
                </button>
                )}
              </div>
              {isConfirming && (
                <div className="mt-2 rounded-[var(--radius)] bg-[var(--accent-soft)] p-3 text-sm">
                  <p>
                    種別「{r.label}」を削除しますか？
                    {u && u.manual > 0 && (
                      <>
                        この種別が手動設定されているイベントが{" "}
                        <span className="tnum font-bold">{u.manual}件</span>{" "}
                        あります。削除すると、それらは自動判定に戻ります。
                      </>
                    )}
                    {u && u.auto > 0 && (
                      <>
                        自動判定でこの種別になっているイベントが{" "}
                        <span className="tnum font-bold">{u.auto}件</span>{" "}
                        あります。削除後は別の種別に判定されます。
                      </>
                    )}
                    {(!u || (u.manual === 0 && u.auto === 0)) &&
                      "この種別を使っているイベントはありません。"}
                    削除は「種別リストの変更を保存」を押したときに確定します。
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="rounded-[var(--radius)] bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white"
                    >
                      削除する
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmIdx(null)}
                      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
                    >
                      やめる
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-[var(--dim)]">
            種別がありません。「種別を追加」から追加してください（保存には最低1つの種別が必要です）。
          </p>
        )}
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => {
            setConfirmIdx(null);
            edit([...rows, { key: null, label: "", keywords: "" }]);
          }}
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium"
        >
          種別を追加
        </button>
      </div>

      {hasEmptyLabel && (
        <p className="mt-2 text-sm text-[var(--accent)]">
          種別名が空の行があります。名前を入力すると保存できます。
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
          保存できませんでした：{error}
        </p>
      )}
      {saved && !changed && (
        <p className="mt-2 text-sm text-[var(--dim)]">種別リストの変更を保存しました。</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!changed || hasEmptyLabel || rows.length === 0 || save.isPending}
          onClick={() => {
            setError(null);
            save.mutate();
          }}
          className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {save.isPending ? "保存中…" : "種別リストの変更を保存"}
        </button>
        {changed && (
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setConfirmIdx(null);
              setSaved(false);
            }}
            className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm"
          >
            変更を取り消す
          </button>
        )}
      </div>
    </section>
  );
}
