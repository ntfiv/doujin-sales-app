import { PREFECTURES } from "./Ledger";
import { matchesPlaceName } from "./search";

/**
 * Past participation per prefecture: days with a registered event
 * (eventName set) in that prefecture, counted once per day. Keys are
 * canonical prefecture names (matched with the app's place-name
 * matching so suffix variants land on the same prefecture). Shared by
 * every search area whose prefecture dropdown marks visited
 * prefectures (台帳・都市別).
 */
export function prefectureCounts(
  days: Iterable<{ prefecture?: string | null; eventName?: string | null }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of days) {
    if (!d.prefecture || !d.eventName) continue;
    const canon =
      PREFECTURES.find((p) => matchesPlaceName(p, d.prefecture)) ?? d.prefecture;
    counts.set(canon, (counts.get(canon) ?? 0) + 1);
  }
  return counts;
}

/**
 * Orders prefecture values found in the data by the standard
 * north-to-south prefecture order; non-standard values (kept as their
 * own dropdown options so existing registrations stay selectable) are
 * appended in code-point order.
 */
export function orderPrefectures(values: Iterable<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const t = v?.trim();
    if (t) set.add(t);
  }
  const ordered = PREFECTURES.filter((p) => set.has(p));
  const extras = [...set].filter((v) => !PREFECTURES.includes(v)).sort();
  return [...ordered, ...extras];
}

const selectCls =
  "w-full appearance-none rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 pr-9 text-base text-[var(--text)]";
const inputCls =
  "w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text)]";

/**
 * Place filter for the search areas: the prefecture is picked from a
 * dropdown list, the city stays a free-text input (both matched as place
 * names by matchesPlaceName — suffix variants tolerated, no substring
 * matching), and the two sit side by side.
 */
export function PlaceFilter({
  idPrefix,
  prefectures,
  pref,
  onPrefChange,
  city,
  onCityChange,
  prefCounts,
}: {
  idPrefix: string;
  prefectures: string[];
  pref: string;
  onPrefChange: (v: string) => void;
  city: string;
  onCityChange: (v: string) => void;
  /**
   * Optional past-participation counts per prefecture (number of days
   * with a registered event there). When given, prefectures with a
   * count get a mark in their option label — native <option> elements
   * carry text only, so the mark is part of the label text:
   * 「京都府（5回）」.
   */
  prefCounts?: ReadonlyMap<string, number>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="relative">
        <select
          id={`${idPrefix}-pref`}
          aria-label="都道府県で絞り込み"
          className={selectCls}
          value={pref}
          onChange={(e) => onPrefChange(e.target.value)}
        >
          <option value="">都道府県：すべて</option>
          {prefectures.map((p) => {
            // Counts are keyed by canonical prefecture name; options
            // may carry a stored variant, so canonicalize before the
            // lookup (same place-name matching as the counting).
            const canon =
              PREFECTURES.find((c) => matchesPlaceName(c, p)) ?? p;
            const count = prefCounts?.get(canon) ?? prefCounts?.get(p) ?? 0;
            return (
              <option key={p} value={p}>
                {count > 0 ? `${p}（${count}回）` : p}
              </option>
            );
          })}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-[var(--dim)]"
        >
          ▼
        </span>
      </div>
      <input
        id={`${idPrefix}-city`}
        type="search"
        aria-label="市区町村で絞り込み"
        placeholder="市区町村"
        value={city}
        onChange={(e) => onCityChange(e.target.value)}
        className={inputCls}
      />
    </div>
  );
}
