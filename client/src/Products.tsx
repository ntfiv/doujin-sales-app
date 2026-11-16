import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { Modal } from "./Modal";
import { withViewTransition } from "./transitions";
import { matchesQuery } from "./search";
import { dateLabel, daysBetween, qtyMasked, releaseAgeLabel, yenMasked } from "./format";
import { useMasked } from "./mask";
import { useDisplaySettings } from "./display";

export type Product = ApiResponse<typeof api, "getProducts">["products"][number];

export const inputCls =
  "w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text)]";
export const labelCls = "block text-xs font-medium text-[var(--dim)] mb-1";

export function DiscontinuedBadge({ prominent = false }: { prominent?: boolean }) {
  // Default: pale, quiet styling like the 同県で初頒布 badge: a light
  // tinted background with a muted label, no bold solid fill.
  // `prominent` (イベント一覧の日内訳 only): a near-black gray fill
  // with white text so a discontinued book stands out in the day's
  // sales breakdown.
  if (prominent) {
    return (
      <span className="inline-block rounded-full bg-[var(--disc-bg)] px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-[var(--disc-text)]">
        廃盤
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-[var(--surface-alt)] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-[var(--dim)]">
      廃盤
    </span>
  );
}

/** Product-level 「除外」 chip (same look as the day-level 参考情報 one). */
export function ProductRefBadge({ label = "除外" }: { label?: string }) {
  return (
    <span className="inline-block rounded-full bg-[var(--surface-alt)] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-[var(--dim)]">
      {label}
    </span>
  );
}

/**
 * 完売 chip: on that date the copies of this product brought to the
 * event sold out (stock ran short). Hand-recorded per sales row in
 * the ledger's sales editor.
 */
export function SoldOutBadge() {
  return (
    <span className="inline-block rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-white">
      完売
    </span>
  );
}

/**
 * 「新刊」 chip for one sales-history row: shown when the event date
 * falls within ±7 days of the product's release date (発行日−7日〜
 * 発行日＋7日). Judged automatically from the stored release date —
 * products whose release date is unset (仮日付) never get the chip.
 * This replaces the old day-level 「新刊あり」 flag display.
 */
export function NewReleaseBadge() {
  return (
    <span className="inline-block rounded-full border border-[var(--ai)] px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-[var(--ai)]">
      新刊
    </span>
  );
}

export function FirstAppearanceBadge() {
  // 表示設定「『同県で初頒布』のバッジを表示しない」がオンの間は、
  // 判定はそのままにバッジ自体を描画しない（全画面共通）。
  const { hideFirstBadge } = useDisplaySettings();
  if (hideFirstBadge) return null;
  return (
    <span className="inline-block rounded-full bg-[var(--first-bg)] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-[var(--first-text)]">
      同県で初頒布
    </span>
  );
}

/**
 * Placeholder release date for products whose release date is unset.
 * Sorting and age calculations treat unset products as released on
 * 2000-01-01, so they sort as the oldest in 発行日順（新しい順）. The
 * stored date stays empty — nothing is written back; displays show
 * 「未設定（仮: 2000-01-01）」 and may note the first sales date as a
 * 推定 alongside.
 */
export const PLACEHOLDER_RELEASE_DATE = "2000-01-01";

/**
 * The release date used for sorting and age calculations: the stored
 * date when set, otherwise the placeholder date (仮日付), flagged so
 * displays can say the date is unset.
 */
function effectiveRelease(product: Product): { date: string; estimated: boolean } {
  if (product.releaseDate) return { date: product.releaseDate, estimated: false };
  return { date: PLACEHOLDER_RELEASE_DATE, estimated: true };
}

/**
 * The app-wide release-date ordering: effective release date (stored
 * date, or the 2000-01-01 placeholder when unset), newest first; ties
 * fall back to the product name.
 */
export function byReleaseDateDesc(a: Product, b: Product): number {
  return (
    effectiveRelease(b).date.localeCompare(effectiveRelease(a).date) ||
    a.product.localeCompare(b.product, "ja")
  );
}

/**
 * 「頒布物を編集」: the one unified edit dialog for a product — name,
 * category, release date / basis, 廃盤 and 参考情報 flags, all in a
 * single form saved together. A name change keeps the old two-step
 * confirmation (it rewrites every screen and registers the old name as
 * an alias); the other fields save directly. Category is stored on the
 * product's sales rows via setProductCategories.
 */
function ProductEditForm({
  product,
  otherNames,
  categories,
  onDone,
}: {
  product: Product;
  otherNames: string[];
  categories: string[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState(product.product);
  const [category, setCategory] = useState(product.category);
  const [releaseDate, setReleaseDate] = useState(product.releaseDate ?? "");
  const [releaseBasis, setReleaseBasis] = useState(product.releaseBasis);
  const [discontinued, setDiscontinued] = useState(product.discontinued);
  const [salesUnreliable, setSalesUnreliable] = useState(product.salesUnreliable);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = newName.trim();
  const nameChanged = trimmed !== product.product;
  const duplicate = nameChanged && otherNames.includes(trimmed);
  const categoryChanged = category.trim() !== product.category;

  const save = useMutation({
    mutationFn: async () => {
      // Rename first: the release info and category are keyed by the
      // product name, so they must be saved under the new name.
      let name = product.product;
      if (nameChanged) {
        await api.renameProduct({ oldName: product.product, newName: trimmed });
        name = trimmed;
      }
      await api.saveProductRelease({
        product: name,
        releaseDate,
        releaseBasis,
        discontinued,
        salesUnreliable,
      });
      if (categoryChanged) {
        await api.setProductCategories({
          updates: [{ product: name, category: category.trim() }],
        });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["productMerges"] });
      void queryClient.invalidateQueries({ queryKey: ["typeBreakdownDays"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      void queryClient.invalidateQueries({ queryKey: ["cities"] });
      onDone();
    },
    onError: (e) => setError(String(e)),
  });

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    // A rename rewrites history everywhere, so it goes through the
    // confirmation step first; other edits save directly.
    if (nameChanged && !confirming) {
      setConfirming(true);
      return;
    }
    save.mutate();
  };

  const idBase = `edit-${product.product}`;
  return (
    <form onSubmit={submit} noValidate>
      <p className="font-ledger text-sm font-bold">頒布物を編集</p>
      {!confirming ? (
        <>
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">
            <div>
              <label htmlFor={`${idBase}-name`} className={labelCls}>
                頒布物名
              </label>
              <input
                id={`${idBase}-name`}
                className={inputCls}
                value={newName}
                aria-invalid={duplicate || undefined}
                aria-describedby={duplicate ? `${idBase}-duplicate` : undefined}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={300}
              />
              {duplicate ? (
                <p role="alert" id={`${idBase}-duplicate`} className="mt-1 text-sm text-[var(--accent)]">
                  「{trimmed}」という頒布物が既にあります。名前変更ではなく統合になるため、「頒布物を統合」から統合してください。
                </p>
              ) : nameChanged ? (
                <p className="mt-1 text-xs text-[var(--dim)]">
                  名前を変えると旧名は対応表に残り、今後のCSV取込でも自動で新しい名前に寄ります。保存の前に確認画面が出ます。
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor={`${idBase}-category`} className={labelCls}>
                カテゴリ（既存のカテゴリから選ぶか、新しい名前を入力。空欄でカテゴリなし）
              </label>
              <input
                id={`${idBase}-category`}
                className={inputCls}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list={`${idBase}-category-options`}
                placeholder="カテゴリなし"
                maxLength={100}
              />
              <datalist id={`${idBase}-category-options`}>
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor={`${idBase}-date`} className={labelCls}>
                発行日（未設定に戻すときは空欄）
              </label>
              <input
                id={`${idBase}-date`}
                type="date"
                className={inputCls}
                value={releaseDate}
                onChange={(e) => setReleaseDate(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={`${idBase}-basis`} className={labelCls}>
                根拠・メモ（任意）
              </label>
              <input
                id={`${idBase}-basis`}
                className={inputCls}
                value={releaseBasis}
                onChange={(e) => setReleaseBasis(e.target.value)}
                placeholder="例：ブログの発行告知、初売りイベント名など"
              />
            </div>
            <label
              htmlFor={`${idBase}-disc`}
              className="flex cursor-pointer items-start gap-2 text-sm"
            >
              <input
                id={`${idBase}-disc`}
                type="checkbox"
                aria-label="廃盤"
                checked={discontinued}
                onChange={(e) => setDiscontinued(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0"
                style={{ accentColor: "var(--accent)" }}
              />
              <span>
                廃盤
                <span className="block text-xs text-[var(--dim)]">
                  廃盤にした本は、一覧や詳細で「廃盤」と表示されます（過去の実績表示は残ります）。
                </span>
              </span>
            </label>
            <label
              htmlFor={`${idBase}-ref`}
              className="flex cursor-pointer items-start gap-2 text-sm"
            >
              <input
                id={`${idBase}-ref`}
                type="checkbox"
                aria-label="除外（頒布物）"
                checked={salesUnreliable}
                onChange={(e) => setSalesUnreliable(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0"
                style={{ accentColor: "var(--accent)" }}
              />
              <span>
                除外（この頒布物）
                <span className="block text-xs text-[var(--dim)]">
                  記録が正確でない可能性がある頒布物に付けます（価格名で登録されたものなど）。「除外」の印が付き、一覧で非表示にもできます。
                </span>
              </span>
            </label>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
              保存できませんでした：{error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={!trimmed || duplicate || save.isPending}
              className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {nameChanged ? "変更の確認へ" : "保存する"}
            </button>
            <button
              type="button"
              onClick={onDone}
              className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm"
            >
              キャンセル
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm">
            <span className="font-bold">{product.product}</span>
            <span className="text-[var(--dim)]"> → </span>
            <span className="font-bold">{trimmed}</span>
            に名前を変更します。
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-[var(--dim)]">
            <li>過去の売上表示を含むすべての画面で、新しい名前になります。</li>
            <li>
              旧名「{product.product}」は対応表に残り、今後のCSV取込でも自動で「{trimmed}」に寄ります。
            </li>
            <li>このダイアログで変更した他の項目も一緒に保存されます。</li>
          </ul>
          {error && (
            <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
              保存できませんでした：{error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-[var(--radius)] bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {save.isPending ? "保存中…" : "変更して保存する"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm"
            >
              戻る
            </button>
          </div>
        </>
      )}
    </form>
  );
}

function ProductDetail({
  product,
  otherNames,
  categories,
}: {
  product: Product;
  otherNames: string[];
  categories: string[];
}) {
  const masked = useMasked();
  const [editing, setEditing] = useState(false);
  const rel = effectiveRelease(product);

  return (
    <div className="border-t border-dashed border-[var(--border)] px-4 py-3">
      <div className="text-sm">
        {product.releaseDate ? (
          <p>
            発行日：<span className="tnum font-bold">{dateLabel(product.releaseDate)}</span>
            {product.releaseBasis && (
              <span className="ml-2 text-xs text-[var(--dim)]">{product.releaseBasis}</span>
            )}
          </p>
        ) : (
          <p>
            発行日：未設定（仮: 2000年1月1日）
            <span className="ml-2 text-xs text-[var(--dim)]">
              推定：初回販売日 {dateLabel(product.firstDate)}
            </span>
          </p>
        )}
        {/* 廃盤・参考情報のバッジは一覧の行側にだけ出す。詳細にも出すと
            冗長なため、ここではバッジ表示はしない。 */}
        {product.salesUnreliable && (
          <p className="mt-1 text-xs text-[var(--dim)]">
            この頒布物は「除外」に設定されています（記録が正確でない可能性があります）。
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm font-medium"
        >
          頒布物を編集
        </button>
      </div>
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        label={`${product.product}を編集`}
      >
        <ProductEditForm
          product={product}
          otherNames={otherNames}
          categories={categories}
          onDone={() => setEditing(false)}
        />
      </Modal>

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--dim)]">
            <th scope="col" className="py-1 pr-2 font-medium">日付・イベント</th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">冊数</th>
            <th scope="col" className="py-1 text-right font-medium">売上</th>
          </tr>
        </thead>
        <tbody>
          {product.byDate.map((r) => {
            const ageDays = daysBetween(rel.date, r.date);
            // 「新刊」: the event date is within ±7 days of the real
            // (stored) release date. Unset release dates use the
            // placeholder and are excluded via rel.estimated.
            const isNewRelease =
              !rel.estimated && ageDays !== null && Math.abs(ageDays) <= 7;
            return (
              <tr key={r.date} className="border-b border-[var(--border)]/50">
                <td className="py-1.5 pr-2">
                  <span className="tnum">{dateLabel(r.date)}</span>
                  <span className="block text-xs text-[var(--dim)]">
                    {r.eventName
                      ? `${r.eventName}${r.city || r.prefecture ? `（${[r.prefecture, r.city].filter(Boolean).join(" ")}）` : ""}`
                      : "イベント未登録"}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {isNewRelease && <NewReleaseBadge />}
                    {r.isFirstAppearance && <FirstAppearanceBadge />}
                    {r.appearanceNo !== null && r.appearanceNo >= 2 && (
                      <span className="text-xs text-[var(--dim)]">{r.appearanceNo}回目</span>
                    )}
                    {ageDays !== null && !rel.estimated && (
                      <span className="text-xs text-[var(--dim)]">
                        {releaseAgeLabel(ageDays)}
                      </span>
                    )}
                    {r.salesUnreliable && (
                      <span className="text-xs font-medium text-[var(--accent)]">参考情報</span>
                    )}
                    {r.soldOut && <SoldOutBadge />}
                  </span>
                </td>
                <td className="tnum py-1.5 pr-2 text-right align-top">{qtyMasked(r.qty, masked)}</td>
                <td className="tnum py-1.5 text-right align-top">{yenMasked(r.net, masked)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Groups of product names suspected to be the same book registered
 * under multiple names (found while cross-checking release dates
 * against the blog). Shown as one-tap merge candidates — nothing is
 * merged until the user selects, confirms, and runs it.
 */
export const MERGE_CANDIDATE_GROUPS: string[][] = [
  ["ホーバー", "跳ばないホーバー"],
  ["見学ガイド", "ホーバー見る撮るガイド"],
  ["卯酉東海道を往く", "東海道"],
  ["夜行航路", "EX2＿夜行航路"],
  ["瀬戸内", "EX1＿瀬戸内海の多彩な航路"],
  ["フェリー2023", "2023フェリー"],
  ["新刊フェリー2024", "2024フェリー", "フェリ2024"],
];

type ProductSort = "qty" | "net" | "releaseDesc" | "releaseAsc" | "name";

const SORT_OPTIONS: { id: ProductSort; label: string }[] = [
  { id: "qty", label: "冊数順（多い順）" },
  { id: "net", label: "売上順（多い順）" },
  { id: "releaseDesc", label: "発行順（新しい順）" },
  { id: "releaseAsc", label: "発行順（古い順）" },
  { id: "name", label: "名前順" },
];

export function ProductsView() {
  const masked = useMasked();
  const products = useQuery({ queryKey: ["products"], queryFn: () => api.getProducts({}) });
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<ProductSort>("releaseDesc");
  const [hideRef, setHideRef] = useState(true);
  const [hideDiscontinued, setHideDiscontinued] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [canonical, setCanonical] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const allProducts = products.data?.products ?? [];
  const candidateGroups = useMemo(
    () =>
      MERGE_CANDIDATE_GROUPS.map((g) =>
        g.filter((name) => allProducts.some((p) => p.product === name)),
      ).filter((g) => g.length >= 2),
    [allProducts],
  );

  const toggleSelect = (name: string) => {
    setConfirming(false);
    setSelected((prev) => {
      const next = prev.includes(name)
        ? prev.filter((n) => n !== name)
        : [...prev, name];
      if (!next.includes(canonical)) setCanonical(next[0] ?? "");
      return next;
    });
  };

  const startGroupMerge = (group: string[]) => {
    setMergeMode(true);
    setSelected(group);
    setCanonical(group[0] ?? "");
    setConfirming(false);
    setMergeError(null);
  };

  const exitMergeMode = () => {
    setMergeMode(false);
    setSelected([]);
    setCanonical("");
    setConfirming(false);
    setMergeError(null);
  };

  const merge = useMutation({
    mutationFn: async () =>
      await api.mergeProducts({
        canonical,
        sources: selected.filter((n) => n !== canonical),
      }),
    onSuccess: () => {
      exitMergeMode();
      setOpen(null);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["productMerges"] });
      void queryClient.invalidateQueries({ queryKey: ["typeBreakdownDays"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      void queryClient.invalidateQueries({ queryKey: ["cities"] });
    },
    onError: (e) => setMergeError(String(e)),
  });

  const selectedProducts = allProducts.filter((p) => selected.includes(p.product));

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products.data?.products ?? []) if (p.category) set.add(p.category);
    return [...set].sort();
  }, [products.data]);

  const filtered = useMemo(() => {
    const list = (products.data?.products ?? []).filter(
      (p) =>
        matchesQuery(query, p.product) &&
        (!category || p.category === category) &&
        (!hideRef || !p.salesUnreliable) &&
        (!hideDiscontinued || !p.discontinued),
    );
    // 発行順 uses the effective release date: the stored date when set,
    // otherwise the 2000-01-01 placeholder (仮日付) — the same
    // rule the detail view uses. Ties fall back to copies sold.
    const byQty = (a: Product, b: Product) => b.qty - a.qty;
    const sorted = [...list];
    switch (sort) {
      case "qty":
        sorted.sort(byQty);
        break;
      case "net":
        sorted.sort((a, b) => b.net - a.net || byQty(a, b));
        break;
      case "releaseDesc":
        sorted.sort(
          (a, b) =>
            effectiveRelease(b).date.localeCompare(effectiveRelease(a).date) ||
            byQty(a, b),
        );
        break;
      case "releaseAsc":
        sorted.sort(
          (a, b) =>
            effectiveRelease(a).date.localeCompare(effectiveRelease(b).date) ||
            byQty(a, b),
        );
        break;
      case "name":
        sorted.sort((a, b) => a.product.localeCompare(b.product, "ja"));
        break;
    }
    return sorted;
  }, [products.data, query, category, sort, hideRef, hideDiscontinued]);

  if (products.isPending) return <p className="py-8 text-center text-sm text-[var(--dim)]">読み込み中…</p>;
  if (products.error)
    return (
      <p role="alert" className="py-8 text-center text-sm text-[var(--accent)]">
        読み込めませんでした：{String(products.error)}
      </p>
    );

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          aria-label="頒布物名で検索"
          placeholder="頒布物名で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-40 flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base"
        />
        <select
          aria-label="カテゴリで絞り込み"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base"
        >
          <option value="">全カテゴリ</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          aria-label="並び替え"
          value={sort}
          onChange={(e) => setSort(e.target.value as ProductSort)}
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <p className="tnum text-xs text-[var(--dim)]">{filtered.length}頒布物</p>
        <label
          htmlFor="products-hide-ref"
          className="flex cursor-pointer items-center gap-1.5 text-sm"
        >
          <input
            id="products-hide-ref"
            type="checkbox"
            aria-label="除外を非表示"
            checked={hideRef}
            onChange={(e) => setHideRef(e.target.checked)}
            className="h-4 w-4 shrink-0"
            style={{ accentColor: "var(--accent)" }}
          />
          除外を非表示
        </label>
        <label
          htmlFor="products-hide-discontinued"
          className="flex cursor-pointer items-center gap-1.5 text-sm"
        >
          <input
            id="products-hide-discontinued"
            type="checkbox"
            aria-label="廃盤を非表示"
            checked={hideDiscontinued}
            onChange={(e) => setHideDiscontinued(e.target.checked)}
            className="h-4 w-4 shrink-0"
            style={{ accentColor: "var(--accent)" }}
          />
          廃盤を非表示
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={mergeMode}
            onClick={() => (mergeMode ? exitMergeMode() : setMergeMode(true))}
            className={`rounded-[var(--radius)] border px-3 py-1.5 text-sm font-medium ${
              mergeMode
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface)]"
            }`}
          >
            {mergeMode ? "統合をやめる" : "頒布物を統合"}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-[var(--dim)]">
        一括設定・統合・対応表は、データ管理タブの「頒布物管理」にあります。
      </p>

      {mergeMode && (
        <section
          aria-label="頒布物の統合"
          className="mt-2 rounded-[var(--radius)] border border-[var(--accent)] bg-[var(--surface)] p-4"
        >
          <h2 className="font-ledger text-base font-bold">頒布物の統合</h2>
          <p className="mt-1 text-sm text-[var(--dim)]">
            同じ本が複数の名前で登録されている場合に、1つの名前にまとめます。統合したい頒布物を2つ以上選び、残す名前（統合先）を決めてください。売上は統合先に寄り、同日の重複は合算されます。今後のCSV取込でも旧名は自動で統合先に寄ります。取り消しは後からできます。
          </p>
          {candidateGroups.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-[var(--dim)]">
                同じ本の疑いがある組み合わせ（発行日の照合で判明）
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {candidateGroups.map((g) => (
                  <button
                    key={g.join("/")}
                    type="button"
                    onClick={() => startGroupMerge(g)}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1.5 text-xs"
                  >
                    {g.join(" ／ ")}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="tnum mt-3 text-sm">
            選択中：{selected.length}頒布物
            {selected.length > 0 && (
              <span className="text-[var(--dim)]">（{selected.join("、")}）</span>
            )}
          </p>
          {selected.length >= 2 && (
            <div className="mt-2">
              <label htmlFor="merge-canonical" className={labelCls}>
                統合先（残す名前）
              </label>
              <div className="relative max-w-sm">
                <select
                  id="merge-canonical"
                  className={`${inputCls} appearance-none pr-9`}
                  value={canonical}
                  onChange={(e) => {
                    setCanonical(e.target.value);
                    setConfirming(false);
                  }}
                >
                  {selected.map((n) => (
                    <option key={n} value={n}>
                      {n}
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
              <p className="mt-1 text-xs text-[var(--dim)]">
                発行日は統合先の値が優先され、統合先で未設定の項目は統合元から引き継がれます。廃盤・除外は、いずれかの頒布物に付いていれば統合後も引き継がれます。
              </p>
            </div>
          )}
          {selected.length >= 2 && !confirming && (
            <button
              type="button"
              onClick={() => {
                setMergeError(null);
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
              <ul className="mt-1 list-disc pl-5 text-[var(--dim)]">
                <li>
                  売上記録 {selectedProducts.reduce((s, p) => s + p.byDate.length, 0)}
                  件（合計 {qtyMasked(selectedProducts.reduce((s, p) => s + p.qty, 0), masked)}冊）が
                  {canonical} に寄ります。同日の重複は合算されます。
                </li>
                <li>旧名は対応表に残り、今後のCSV取込でも自動で{canonical}に寄ります。</li>
                <li>統合はデータ管理タブ「頒布物管理」の「頒布物名の対応・統合履歴」から取り消せます。</li>
              </ul>
              {mergeError && (
                <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
                  統合できませんでした：{mergeError}
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
        </section>
      )}

      <div className="mt-2 overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
        {filtered.map((p) => {
          const isOpen = open === p.product;
          const isSelected = selected.includes(p.product);
          return (
            <div
              key={p.product}
              className={`border-b border-[var(--border)] bg-[var(--surface)] last:border-b-0 ${
                isOpen ? "row-selected" : ""
              }`}
            >
              <button
                type="button"
                aria-expanded={mergeMode ? undefined : isOpen}
                aria-pressed={mergeMode ? isSelected : undefined}
                aria-label={
                  mergeMode
                    ? `${p.product}を統合対象に${isSelected ? "外す" : "選ぶ"}`
                    : `${p.product}の販売履歴を${isOpen ? "閉じる" : "開く"}`
                }
                onClick={() =>
                  mergeMode
                    ? toggleSelect(p.product)
                    : withViewTransition(() => setOpen(isOpen ? null : p.product))
                }
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                {mergeMode && (
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
                      isSelected
                        ? "border-[var(--accent)] bg-[var(--accent)] font-bold text-white"
                        : "border-[var(--border)] bg-[var(--surface)]"
                    }`}
                  >
                    {isSelected ? "✓" : ""}
                  </span>
                )}
                {p.salesUnreliable && (
                  <div className="flex shrink-0 flex-col items-start gap-1">
                    <ProductRefBadge />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p
                      className={`font-ledger min-w-0 truncate text-base font-bold ${
                        p.discontinued || p.salesUnreliable ? "text-[var(--dim)]" : ""
                      }`}
                    >
                      {p.product}
                    </p>
                    {p.discontinued && <DiscontinuedBadge />}
                  </div>
                  <p className="text-xs text-[var(--dim)]">
                    {p.category || "カテゴリなし"}
                    ・持ち込み回数：<span className="tnum">{p.totalAppearances}回</span>
                    {p.releaseDate ? (
                      <>
                        ・発行 <span className="tnum">{dateLabel(p.releaseDate)}</span>
                      </>
                    ) : (
                      <>・発行日未設定（仮: 2000-01-01）</>
                    )}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tnum text-sm font-bold">{qtyMasked(p.qty, masked)}冊</p>
                  <p className="tnum text-xs text-[var(--dim)]">{yenMasked(p.net, masked)}</p>
                </div>
                {!mergeMode && (
                  <span
                    aria-hidden
                    className={isOpen ? "font-bold text-[var(--accent)]" : "text-[var(--dim)]"}
                  >
                    {isOpen ? "▲" : "▼"}
                  </span>
                )}
              </button>
              {isOpen && !mergeMode && (
                <ProductDetail
                  product={p}
                  otherNames={allProducts
                    .map((x) => x.product)
                    .filter((n) => n !== p.product)}
                  categories={categories}
                />
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="bg-[var(--surface)] px-4 py-8 text-center text-sm text-[var(--dim)]">
            条件に合う頒布物がありません。
          </p>
        )}
      </div>

    </div>
  );
}
