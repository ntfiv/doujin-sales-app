export function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

export function qtyFmt(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString("ja-JP");
  // Non-integer values (averages and other computed figures) are
  // rounded to one decimal place — never the raw long decimal.
  const r = Math.round(n * 10) / 10;
  return r.toLocaleString("ja-JP", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** Share of a whole as a percent string: integers stay integers
 *  ("25%"), anything else is rounded to one decimal place ("33.3%"). */
export function pctFmt(fraction: number): string {
  const p = fraction * 100;
  if (Number.isInteger(p)) return `${p}%`;
  const r = Math.round(p * 10) / 10;
  return `${r.toFixed(1)}%`;
}

/**
 * Screenshot-mode masking (see mask.tsx): when `masked` is on, money
 * renders as "¥***" and copy counts as "***", so a shared screenshot
 * never reveals the figures. Display only — the data is untouched.
 */
export function yenMasked(n: number, masked: boolean): string {
  return masked ? "¥***" : yen(n);
}

export function qtyMasked(n: number, masked: boolean): string {
  return masked ? "***" : qtyFmt(n);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** "2024-08-12" -> "2024年8月12日（月）" */
export function dateLabel(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()] ?? "";
  return `${y}年${m}月${d}日（${wd}）`;
}

/** "2024-08-12" -> "2024年8月12日" (no weekday; used for the
 *  最終登録日 shown at the top of the page) */
export function dateLabelNoWeekday(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/** Whole days from date a to date b (both YYYY-MM-DD); null if unparsable. */
export function daysBetween(a: string, b: string): number | null {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86400000);
}

/**
 * Human label for how long after release a sale happened:
 * 0–29日 → "発行から12日", under a year → "発行から約3.5か月",
 * longer → "発行から1年2か月". Negative (sold before the release date,
 * e.g. an announcement date was recorded) → "発行前".
 */
export function releaseAgeLabel(days: number): string {
  if (days < 0) return "発行前";
  if (days < 30) return `発行から${days}日`;
  const months = days / 30.44;
  if (months < 12) {
    const m = Math.round(months * 10) / 10;
    return `発行から約${Number.isInteger(m) ? m.toFixed(0) : m}か月`;
  }
  const y = Math.floor(months / 12);
  const m = Math.round(months - y * 12);
  if (m === 12) return `発行から${y + 1}年`;
  return m > 0 ? `発行から${y}年${m}か月` : `発行から${y}年`;
}

/** "2024-08-12" -> "2024/8/12（月）" */
export function dateShort(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()] ?? "";
  return `${y}/${m}/${d}（${wd}）`;
}

/** "2024-08-12" -> "2024/8/12" (no weekday) */
export function datePlain(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return `${y}/${m}/${d}`;
}
