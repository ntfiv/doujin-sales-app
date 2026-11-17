import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { matchesQuery } from "./search";
import { dateLabel, qtyMasked } from "./format";
import { useMasked } from "./mask";
import {
DiscontinuedBadge,
NewProductDialog,
ProductRefBadge,
byReleaseDateDesc,
inputCls,
labelCls,
MERGE_CANDIDATE_GROUPS,
type Product,
} from "./Products";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";

// Input limits come from the actions' request schemas, so the form
// fields and the server can never disagree.
const FIELDS = actionFields<typeof Actions>();

/**
 * 頒布物の管理系セクション（発行日を一括で設定・カテゴリを一括で設定・
 * 廃盤を一括で設定・同じ本を一括で統合・頒布物名の対応と統合履歴）。
 * データ管理タブ内の「頒布物管理」サブタブに表示する。頒布物一覧タブ
 * には一覧・詳細・検索・並び替えと個別編集（頒布物を編集）だけを
 * 残し、一括管理はここに集約した。
 */

/**
 * Whether a category value counts as 未設定 (unset). Square's CSV puts
 * the literal string 「なし」 on products that have no category, so
 * 「なし」 is judged unset exactly like an empty value. This is a
 * display/filter judgment only — the stored category value itself is
 * never rewritten by it.
 */
const isCategoryUnset = (value: string) => {
  const v = value.trim();
  return v === "" || v === "なし";
};

/**
 * 「頒布物を新規登録」: the topmost 頒布物管理 section. A single
 * button opening the shared 新規登録 dialog (Products.tsx
 * NewProductForm) — the same form the 頒布物一覧 tab and the sales
 * editor use. Registered products appear in every list below (and
 * in 頒布物一覧・イベントメモ） even before they have any sales.
 */
function NewProductSection() {
  const [creating, setCreating] = useState(false);
  return (
    <section
      aria-label="頒布物を新規登録"
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 className="font-ledger text-base font-bold">頒布物を新規登録</h2>
      <p className="mt-1 text-sm text-[var(--dim)]">
        CSVからの取り込みがメインの使い方ですが、イベント前に新刊を登録することで事前にイベントメモで活用することもできます。
      </p>
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white"
        >
          新しい頒布物を登録
        </button>
      </div>
      <NewProductDialog open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}

/**
 * 「発行日を一括で設定」: the second 頒布物管理 section. Same
 * checkbox-list shape as 「廃盤を一括で設定」: every product gets a
 * checkbox plus its current 発行日 (未設定 when unset) and its 初頒布日
 * (firstDate — the first day it was sold). Pressing 「初頒布日を取得
 * する」 immediately saves: each checked product's release date is set
 * to its first sales date via setReleaseDatesFromFirstSales (already-
 * set dates are overwritten). Unlike the draft-based sections there is
 * nothing to stage here — the value comes from the sales data itself,
 * so the button applies at once. Products with no sales rows
 * (hand-registered ones) have no first sales date: their checkbox is
 * disabled and the row says so （売上がないため対象外）.
 */
function ReleaseDateSection({ allProducts }: { allProducts: Product[] }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [onlyUnset, setOnlyUnset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const hasSales = (p: Product) => p.dayCount > 0 && p.firstDate !== "";
  const unsetCount = allProducts.filter((p) => !p.releaseDate).length;
  // 一覧の並びは発行日順（新しい順）— 実効発行日（未設定は仮日付
  // 2000-01-01）で比べる、アプリ全体の統一ルール。
  const visible = [...allProducts].sort(byReleaseDateDesc).filter(
    (p) =>
      matchesQuery(search, p.product) &&
      (!onlyUnset || !p.releaseDate),
  );

  const toggle = (name: string) => {
    setResult(null);
    setError(null);
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  const apply = useMutation({
    mutationFn: async () =>
      await api.setReleaseDatesFromFirstSales({ products: selected }),
    onSuccess: (res) => {
      setSelected([]);
      setResult(
        `${res.updated}頒布物の発行日を初頒布日に設定しました。` +
          (res.skipped.length > 0
            ? `（売上がなく設定できなかった頒布物：${res.skipped.join("、")}）`
            : ""),
      );
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      void queryClient.invalidateQueries({ queryKey: ["typeBreakdownDays"] });
    },
    onError: (e) => setError(String(e)),
  });

  return (
    <section
      aria-label="発行日を一括で設定"
      className="mt-5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 className="font-ledger text-base font-bold">発行日を一括で設定</h2>
      <p className="mt-1 text-sm text-[var(--dim)]">
        チェックした頒布物の発行日に、初回販売日（初頒布日）を設定できます。下のボタンを押すとその場で保存されます。発行日が設定済みの頒布物も、チェックすれば初頒布日で上書きされます。個別の設定は各頒布物の「頒布物を編集」からもできます。
      </p>
      <p className="tnum mt-2 text-sm">
        現在 <span className="font-bold">{unsetCount}頒布物</span> が発行日未設定
        {selected.length > 0 && (
          <span className="ml-2 font-bold text-[var(--accent)]">
            選択中 {selected.length}件
          </span>
        )}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="発行日を一括で設定で頒布物名を検索"
          placeholder="頒布物名で検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-40 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base"
        />
        <label
          htmlFor="rel-only-unset"
          className="flex cursor-pointer items-center gap-2 text-sm"
        >
          <input
            id="rel-only-unset"
            type="checkbox"
            aria-label="発行日未設定のみ表示"
            checked={onlyUnset}
            onChange={(e) => setOnlyUnset(e.target.checked)}
            className="h-4 w-4 shrink-0"
            style={{ accentColor: "var(--accent)" }}
          />
          未設定のみ表示
        </label>
      </div>

      <div className="mt-2 max-h-80 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] px-2 py-1">
        {visible.map((p) => {
          const canSet = hasSales(p);
          return (
            <label
              key={p.product}
              htmlFor={`rel-${p.product}`}
              className={`flex items-center gap-2 py-1.5 text-sm ${
                canSet ? "cursor-pointer" : "text-[var(--dim)]"
              }`}
            >
              <input
                id={`rel-${p.product}`}
                type="checkbox"
                aria-label={`${p.product}を初頒布日で発行日に設定する対象に選ぶ`}
                checked={selected.includes(p.product)}
                disabled={!canSet}
                onChange={() => toggle(p.product)}
                className="h-4 w-4 shrink-0 disabled:opacity-40"
                style={{ accentColor: "var(--accent)" }}
              />
              <span className="min-w-0 flex-1">
                {p.product}
                <span className="tnum ml-2 text-xs text-[var(--dim)]">
                  発行日：
                  {p.releaseDate ? dateLabel(p.releaseDate) : "未設定"}
                  ・初頒布日：
                  {canSet ? dateLabel(p.firstDate) : "売上なし"}
                </span>
              </span>
              {!p.releaseDate && <span className="stamp">未設定</span>}
              {!canSet && (
                <span className="text-xs text-[var(--dim)]">
                  売上がないため対象外
                </span>
              )}
            </label>
          );
        })}
        {visible.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-[var(--dim)]">
            条件に合う頒布物がありません。
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
          設定できませんでした：{error}
        </p>
      )}
      {result && (
        <p className="mt-2 text-sm text-[var(--dim)]">{result}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={selected.length === 0 || apply.isPending}
          onClick={() => {
            setError(null);
            setResult(null);
            apply.mutate();
          }}
          className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {apply.isPending
            ? "設定中…"
            : `初頒布日を取得する（${selected.length}件）`}
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => setSelected([])}
            className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm"
          >
            選択をクリア
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-[var(--dim)]">
        ※ 既に発行日が設定済みの頒布物も、チェックして押すと初頒布日で上書きされます。
      </p>
    </section>
  );
}

/**
 * 「カテゴリを一括で設定」: every product with an editable category
 * field, so categories can be fixed up in one pass and saved in one
 * batch (setProductCategories). Each field offers the existing
 * categories via a datalist and also accepts a brand-new category name.
 * Products with no category — including ones whose category is the
 * Square placeholder 「なし」 — are badged 「未設定」 and can be
 * filtered to, so the unset ones are easy to find. Draft edits are
 * local until 保存 is pressed. Category lives on the sales rows (see
 * the action), so saving rewrites every sales row of each changed
 * product.
 */
function CategorySection({ allProducts }: { allProducts: Product[] }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [search, setSearch] = useState("");
  const [onlyUnset, setOnlyUnset] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    for (const p of allProducts) if (p.category) set.add(p.category);
    return [...set].sort((a, b) => a.localeCompare(b, "ja"));
  }, [allProducts]);

  const current = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of allProducts) m[p.product] = p.category;
    return m;
  }, [allProducts]);
  const values = draft ?? current;
  const changed = allProducts.filter(
    (p) => (values[p.product] ?? "") !== p.category,
  );
  const unsetCount = allProducts.filter((p) => isCategoryUnset(values[p.product] ?? "")).length;
  // 一覧の並びは発行日順（新しい順）— 実効発行日（未設定は仮日付
  // 2000-01-01）で比べる、アプリ全体の統一ルール。
  const visible = [...allProducts].sort(byReleaseDateDesc).filter(
    (p) =>
      matchesQuery(search, p.product) &&
      (!onlyUnset || isCategoryUnset(values[p.product] ?? "")),
  );

  const applyToUnset = () => {
    const cat = bulkCategory.trim();
    if (!cat) return;
    setSaved(false);
    setError(null);
    const next = { ...values };
    for (const p of allProducts) {
      if (isCategoryUnset(next[p.product] ?? "")) next[p.product] = cat;
    }
    setDraft(next);
  };

  const save = useMutation({
    mutationFn: async () =>
      await api.setProductCategories({
        updates: changed.map((p) => ({
          product: p.product,
          category: (values[p.product] ?? "").trim(),
        })),
      }),
    onSuccess: () => {
      setDraft(null);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      void queryClient.invalidateQueries({ queryKey: ["typeBreakdownDays"] });
    },
    onError: (e) => setError(String(e)),
  });

  return (
    <section
      aria-label="カテゴリを一括で設定"
      className="mt-5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 className="font-ledger text-base font-bold">カテゴリを一括で設定</h2>
      <p className="mt-1 text-sm text-[var(--dim)]">
        全頒布物のカテゴリをまとめて変更できます（既存から選択、または新しい名前を入力。空欄でカテゴリなし）。CSVの「なし」は取り込み時に未設定へ変換されます。変更は下の「カテゴリの変更を保存」を押すまで反映されません。個別の変更は各頒布物の「頒布物を編集」からもできます。
      </p>
      <p className="tnum mt-2 text-sm">
        現在 <span className="font-bold">{unsetCount}頒布物</span> がカテゴリ未設定
        {changed.length > 0 && (
          <span className="ml-2 font-bold text-[var(--accent)]">
            未保存の変更 {changed.length}件
          </span>
        )}
      </p>

      <div className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] p-3">
        <label htmlFor="cat-bulk-fill" className={labelCls}>
          未設定の頒布物すべてに同じカテゴリを入れる
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            {...FIELDS.setProductCategories.updates.category}
            id="cat-bulk-fill"
            className={`${inputCls} min-w-40 flex-1`}
            value={bulkCategory}
            onChange={(e) => setBulkCategory(e.target.value)}
            list="category-options"
            placeholder="例：フェリー"
          />
          <button
            type="button"
            disabled={!bulkCategory.trim()}
            onClick={applyToUnset}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            未設定分に入力
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="カテゴリ設定で頒布物名を検索"
          placeholder="頒布物名で検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-40 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base"
        />
        <label
          htmlFor="cat-only-unset"
          className="flex cursor-pointer items-center gap-2 text-sm"
        >
          <input
            id="cat-only-unset"
            type="checkbox"
            aria-label="カテゴリ未設定のみ表示"
            checked={onlyUnset}
            onChange={(e) => setOnlyUnset(e.target.checked)}
            className="h-4 w-4 shrink-0"
            style={{ accentColor: "var(--accent)" }}
          />
          未設定のみ表示
        </label>
      </div>

      <datalist id="category-options">
        {existingCategories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="mt-2 max-h-96 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] px-2 py-1">
        {visible.map((p) => {
          const value = values[p.product] ?? "";
          const isChanged = value !== p.category;
          const isUnset = isCategoryUnset(value);
          return (
            <div key={p.product} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 basis-48 text-sm">
                {p.product}
                <span className="tnum ml-2 text-xs text-[var(--dim)]">
                  {p.releaseDate
                    ? `発行 ${dateLabel(p.releaseDate)}`
                    : "発行日未設定（仮: 2000-01-01）"}
                </span>
              </span>
              {isUnset && (
                <span className="stamp">未設定</span>
              )}
              {isChanged && (
                <span className="text-xs font-bold text-[var(--accent)]">変更あり</span>
              )}
              <input
                {...FIELDS.setProductCategories.updates.category}
                aria-label={`${p.product}のカテゴリ`}
                className="w-40 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                value={value}
                list="category-options"
                placeholder="カテゴリなし"
                onChange={(e) => {
                  setSaved(false);
                  setError(null);
                  setDraft({ ...values, [p.product]: e.target.value });
                }}
              />
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-[var(--dim)]">
            条件に合う頒布物がありません。
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
          保存できませんでした：{error}
        </p>
      )}
      {saved && changed.length === 0 && (
        <p className="mt-2 text-sm text-[var(--dim)]">カテゴリの変更を保存しました。</p>
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
          {save.isPending ? "保存中…" : `カテゴリの変更を保存（${changed.length}件）`}
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

/**
 * 「廃盤を一括で設定」: every product with a checkbox reflecting its current
 * 廃盤 state, so the user can flip many at once and save them in one
 * batch (setDiscontinuedFlags). Search + 廃盤のみ表示 keep the long
 * list manageable. Draft edits are local until 保存 is pressed.
 */
function DiscontinuedSection({ allProducts }: { allProducts: Product[] }) {
  const masked = useMasked();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null);
  const [search, setSearch] = useState("");
  const [onlyDiscontinued, setOnlyDiscontinued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const current = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const p of allProducts) m[p.product] = p.discontinued;
    return m;
  }, [allProducts]);
  const values = draft ?? current;
  const changed = allProducts.filter(
    (p) => (values[p.product] ?? false) !== p.discontinued,
  );
  const discontinuedCount = allProducts.filter((p) => values[p.product]).length;
  // 一覧の並びは発行日順（新しい順）— 実効発行日（未設定は仮日付
  // 2000-01-01）で比べる、アプリ全体の統一ルール。
  const visible = [...allProducts].sort(byReleaseDateDesc).filter(
    (p) =>
      matchesQuery(search, p.product) &&
      (!onlyDiscontinued || (values[p.product] ?? false)),
  );

  const save = useMutation({
    mutationFn: async () =>
      await api.setDiscontinuedFlags({
        updates: changed.map((p) => ({
          product: p.product,
          discontinued: values[p.product] ?? false,
        })),
      }),
    onSuccess: () => {
      setDraft(null);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["typeBreakdownDays"] });
    },
    onError: (e) => setError(String(e)),
  });

  return (
    <section
      aria-label="廃盤を一括で設定"
      className="mt-5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 className="font-ledger text-base font-bold">廃盤を一括で設定</h2>
      <p className="mt-1 text-sm text-[var(--dim)]">
        全頒布物の廃盤チェックをまとめて付け外しできます。変更は下の「廃盤の変更を保存」を押すまで反映されません。廃盤の本は一覧・詳細で「廃盤」と表示されます（過去の実績表示は残ります）。個別の変更は各頒布物の「頒布物を編集」からもできます。
      </p>
      <p className="tnum mt-2 text-sm">
        現在 <span className="font-bold">{discontinuedCount}頒布物</span> が廃盤
        {changed.length > 0 && (
          <span className="ml-2 font-bold text-[var(--accent)]">
            未保存の変更 {changed.length}件
          </span>
        )}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="廃盤を一括で設定で頒布物名を検索"
          placeholder="頒布物名で検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-40 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base"
        />
        <label
          htmlFor="disc-only"
          className="flex cursor-pointer items-center gap-2 text-sm"
        >
          <input
            id="disc-only"
            type="checkbox"
            aria-label="廃盤のみ表示"
            checked={onlyDiscontinued}
            onChange={(e) => setOnlyDiscontinued(e.target.checked)}
            className="h-4 w-4 shrink-0"
            style={{ accentColor: "var(--accent)" }}
          />
          廃盤のみ表示
        </label>
      </div>

      <div className="mt-2 max-h-80 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] px-2 py-1">
        {visible.map((p) => {
          const checked = values[p.product] ?? false;
          const isChanged = checked !== p.discontinued;
          return (
            <label
              key={p.product}
              htmlFor={`disc-${p.product}`}
              className="flex cursor-pointer items-center gap-2 py-1.5 text-sm"
            >
              <input
                id={`disc-${p.product}`}
                type="checkbox"
                aria-label={`${p.product}を廃盤にする`}
                checked={checked}
                onChange={(e) => {
                  setSaved(false);
                  setError(null);
                  setDraft({ ...values, [p.product]: e.target.checked });
                }}
                className="h-4 w-4 shrink-0"
                style={{ accentColor: "var(--accent)" }}
              />
              <span className="min-w-0 flex-1">
                {p.product}
                <span className="tnum ml-2 text-xs text-[var(--dim)]">
                  累計 {qtyMasked(p.qty, masked)}冊
                  {p.releaseDate
                    ? `・発行 ${dateLabel(p.releaseDate)}`
                    : "・発行日未設定（仮: 2000-01-01）"}
                </span>
              </span>
              {checked && <DiscontinuedBadge />}
              {isChanged && (
                <span className="text-xs font-bold text-[var(--accent)]">変更あり</span>
              )}
            </label>
          );
        })}
        {visible.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-[var(--dim)]">
            条件に合う頒布物がありません。
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
          保存できませんでした：{error}
        </p>
      )}
      {saved && changed.length === 0 && (
        <p className="mt-2 text-sm text-[var(--dim)]">廃盤の変更を保存しました。</p>
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
          {save.isPending ? "保存中…" : `廃盤の変更を保存（${changed.length}件）`}
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

/**
 * 「同じ本を一括で統合」: checkbox multi-select + canonical picker that runs
 * the same mergeProducts action as the list's 統合 mode (same-day sums,
 * old names become aliases, undoable from the history below). The
 * 「頒布物名の対応・統合履歴」 block (MergeManagement) is rendered at
 * the bottom of this same frame, below the merge controls.
 */
function BulkMergeSection({
  allProducts,
  candidateGroups,
}: {
  allProducts: Product[];
  candidateGroups: string[][];
}) {
  const masked = useMasked();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [canonical, setCanonical] = useState("");
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (name: string) => {
    setConfirming(false);
    setError(null);
    setSelected((prev) => {
      const next = prev.includes(name)
        ? prev.filter((n) => n !== name)
        : [...prev, name];
      if (!next.includes(canonical)) setCanonical(next[0] ?? "");
      return next;
    });
  };

  const startGroup = (group: string[]) => {
    setSelected(group);
    setCanonical(group[0] ?? "");
    setConfirming(false);
    setError(null);
  };

  const reset = () => {
    setSelected([]);
    setCanonical("");
    setConfirming(false);
    setError(null);
  };

  const merge = useMutation({
    mutationFn: async () =>
      await api.mergeProducts({
        canonical,
        sources: selected.filter((n) => n !== canonical),
      }),
    onSuccess: () => {
      reset();
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["productMerges"] });
      void queryClient.invalidateQueries({ queryKey: ["typeBreakdownDays"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      void queryClient.invalidateQueries({ queryKey: ["cities"] });
    },
    onError: (e) => setError(String(e)),
  });

  const selectedProducts = allProducts.filter((p) => selected.includes(p.product));
  // 一覧の並びは発行日順（新しい順）— 実効発行日（未設定は仮日付
  // 2000-01-01）で比べる、アプリ全体の統一ルール。
  const visible = [...allProducts]
    .sort(byReleaseDateDesc)
    .filter((p) => matchesQuery(search, p.product));

  return (
    <section
      aria-label="同じ本を一括で統合"
      className="mt-5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 className="font-ledger text-base font-bold">同じ本を一括で統合</h2>

      {candidateGroups.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-[var(--dim)]">
            同じ本の疑いがある組み合わせ（発行日の照合で判明）— 押すと選択に反映されます
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {candidateGroups.map((g) => (
              <button
                key={g.join("/")}
                type="button"
                onClick={() => startGroup(g)}
                className="rounded-full border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1.5 text-xs"
              >
                {g.join(" ／ ")}
              </button>
            ))}
          </div>
        </div>
      )}

      <input
        type="search"
        aria-label="同じ本を一括で統合で頒布物名を検索"
        placeholder="頒布物名で検索"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mt-3 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base"
      />
      <div className="mt-2 max-h-80 overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] px-2 py-1">
        {visible.map((p) => (
          <label
            key={p.product}
            htmlFor={`bulk-merge-${p.product}`}
            className="flex cursor-pointer items-center gap-2 py-1.5 text-sm"
          >
            <input
              id={`bulk-merge-${p.product}`}
              type="checkbox"
              aria-label={`${p.product}を統合対象に選ぶ`}
              checked={selected.includes(p.product)}
              onChange={() => toggle(p.product)}
              className="h-4 w-4 shrink-0"
              style={{ accentColor: "var(--accent)" }}
            />
            <span className="min-w-0 flex-1">
              {p.product}
              <span className="tnum ml-2 text-xs text-[var(--dim)]">
                累計 {qtyMasked(p.qty, masked)}冊・{p.dayCount}日で販売
                {p.releaseDate
                  ? `・発行 ${dateLabel(p.releaseDate)}`
                  : "・発行日未設定（仮: 2000-01-01）"}
              </span>
            </span>
            {p.discontinued && <DiscontinuedBadge />}
            {p.salesUnreliable && <ProductRefBadge />}
          </label>
        ))}
        {visible.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-[var(--dim)]">
            条件に合う頒布物がありません。
          </p>
        )}
      </div>

      <p className="tnum mt-3 text-sm">
        選択中：{selected.length}頒布物
        {selected.length > 0 && (
          <span className="text-[var(--dim)]">（{selected.join("、")}）</span>
        )}
      </p>

      {selected.length >= 2 && (
        <div className="mt-2">
          <label htmlFor="bulk-merge-canonical" className={labelCls}>
            統合先（残す名前）
          </label>
          <div className="relative max-w-sm">
            <select
              id="bulk-merge-canonical"
              className={`${inputCls} appearance-none pr-9`}
              value={canonical}
              onChange={(e) => {
                setCanonical(e.target.value);
                setConfirming(false);
              }}
            >
              {[...selectedProducts].sort(byReleaseDateDesc).map((p) => (
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
      )}

      {selected.length >= 2 && !confirming && (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className="mt-3 rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white"
        >
          統合の確認へ
        </button>
      )}
      {confirming && canonical && (
        <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-alt)] p-3 text-sm">
          <p>
            <span className="font-bold">{canonical}</span> に、
            {selected.filter((n) => n !== canonical).join("、")} を統合します。
          </p>
          <p className="tnum mt-1 text-[var(--dim)]">
            対象の売上記録 {selectedProducts.reduce((s, p) => s + p.byDate.length, 0)}
            件（合計 {qtyMasked(selectedProducts.reduce((s, p) => s + p.qty, 0), masked)}冊）
          </p>
          <p className="mt-1 text-[var(--dim)]">
            統合すると、売上は統合先に寄り、同日の重複は合算されます。今後のCSV取込でも旧名は自動で統合先に寄ります。発行日・廃盤・除外は統合先が優先され、未設定の分は統合元から引き継ぎます。統合はあとから取り消せます。
          </p>
          {error && (
            <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
              統合できませんでした：{error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={merge.isPending}
              onClick={() => merge.mutate()}
              className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {merge.isPending ? "統合中…" : "統合する"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm"
            >
              戻る
            </button>
          </div>
        </div>
      )}
      {!confirming && error && (
        <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
          統合できませんでした：{error}
        </p>
      )}
      {selected.length > 0 && !confirming && (
        <button
          type="button"
          onClick={reset}
          className="mt-2 px-1 py-1 text-sm text-[var(--dim)] underline"
        >
          選択をクリア
        </button>
      )}

      {/* 頒布物名の対応・統合履歴 lives at the bottom of this frame,
          separated from the merge controls by a divider line. It
          renders nothing while there are no aliases and no merge
          history. */}
      <MergeManagement />
    </section>
  );
}

/**
 * 「頒布物名の対応・統合履歴」: the alias list (旧名 → 統合先・変更後）
 * and the undoable merge history. Rendered inside the 「同じ本を
 * 一括で統合」 frame (BulkMergeSection), below the merge controls
 * and separated from them by a divider line — it is no longer a
 * frame of its own. The alias list and merge history can grow long,
 * so the block stays collapsible and starts closed, as before.
 * Renders nothing while there are no aliases and no merge history.
 */
function MergeManagement() {
  const queryClient = useQueryClient();
  const merges = useQuery({
    queryKey: ["productMerges"],
    queryFn: () => api.getProductMerges({}),
  });
  const [confirmUndoId, setConfirmUndoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The alias list and merge history can grow long, so the whole
  // block is collapsible and starts closed.
  const [open, setOpen] = useState(false);

  const undo = useMutation({
    mutationFn: async (mergeId: number) => await api.undoProductMerge({ mergeId }),
    onSuccess: () => {
      setConfirmUndoId(null);
      void queryClient.invalidateQueries({ queryKey: ["productMerges"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["typeBreakdownDays"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      void queryClient.invalidateQueries({ queryKey: ["cities"] });
    },
    onError: (e) => setError(String(e)),
  });

  const data = merges.data;
  if (!data || (data.aliases.length === 0 && data.merges.length === 0)) return null;

  return (
    <section
      aria-label="頒布物名の対応と統合履歴"
      className="mt-5 border-t border-[var(--border)] pt-4"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="font-ledger text-base font-bold">頒布物名の対応・統合履歴</span>
        <span aria-hidden className={open ? "font-bold text-[var(--accent)]" : "text-[var(--dim)]"}>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {!open && (
        <p className="mt-1 text-xs text-[var(--dim)]">
          対応 {data.aliases.length}件・統合履歴 {data.merges.length}件（押すと開きます）
        </p>
      )}
      {open && data.aliases.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-[var(--dim)]">
            旧名で取り込んでも、変更後・統合先の名前に寄ります（統合と名前変更の両方）
          </p>
          <ul className="mt-1 grid gap-0.5 text-sm">
            {data.aliases.map((a) => (
              <li key={a.alias}>
                {a.alias} <span className="text-[var(--dim)]">→</span>{" "}
                <span className="font-bold">{a.canonical}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && data.merges.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-[var(--dim)]">統合履歴（取り消しできます）</p>
          <ul className="mt-1 grid gap-2">
            {data.merges.map((m) => (
              <li
                key={m.id}
                className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm"
              >
                <p>
                  <span className="font-bold">{m.canonical}</span>
                  <span className="text-[var(--dim)]"> ← </span>
                  {m.sources.join("、")}
                </p>
                {confirmUndoId === m.id ? (
                  <div className="mt-2">
                    <p className="text-xs text-[var(--dim)]">
                      統合前の状態に戻します（合算された記録も元の内訳に戻ります）。統合後に取り込んだ同じ日・同じ頒布物の記録は、戻した内容で置き換わります。
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={undo.isPending}
                        onClick={() => undo.mutate(m.id)}
                        className="rounded-[var(--radius)] bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {undo.isPending ? "戻しています…" : "取り消す"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmUndoId(null)}
                        className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-sm"
                      >
                        やめる
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setConfirmUndoId(m.id);
                    }}
                    className="mt-1 px-1 py-1 text-sm text-[var(--accent)] underline"
                  >
                    この統合を取り消す
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && error && (
        <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
          取り消しできませんでした：{error}
        </p>
      )}
    </section>
  );
}

/**
 * The management sections, in order: 頒布物を新規登録 →
 * 発行日を一括で設定 → カテゴリを一括で設定 → 廃盤を一括で設定 →
 * 同じ本を一括で統合 （頒布物名の対応・統合履歴 is inside that last
 * frame, at its bottom — see MergeManagement).
 * Rendered in the データ管理 tab's 「頒布物管理」 sub-tab (App).
 */
export function ProductAdminSections() {
  const products = useQuery({ queryKey: ["products"], queryFn: () => api.getProducts({}) });

  const allProducts = products.data?.products ?? [];
  const candidateGroups = useMemo(
    () =>
      MERGE_CANDIDATE_GROUPS.map((g) =>
        g.filter((name) => allProducts.some((p) => p.product === name)),
      ).filter((g) => g.length >= 2),
    [allProducts],
  );

  if (products.isPending)
    return (
      <p className="py-4 text-center text-sm text-[var(--dim)]">
        頒布物の管理情報を読み込み中…
      </p>
    );
  if (products.error)
    return (
      <p role="alert" className="py-4 text-center text-sm text-[var(--accent)]">
        頒布物の管理情報を読み込めませんでした：{String(products.error)}
      </p>
    );

  return (
    <>
      <NewProductSection />
      <ReleaseDateSection allProducts={allProducts} />
      <CategorySection allProducts={allProducts} />
      <DiscontinuedSection allProducts={allProducts} />
      <BulkMergeSection allProducts={allProducts} candidateGroups={candidateGroups} />
    </>
  );
}
