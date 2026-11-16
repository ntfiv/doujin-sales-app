import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { matchesQuery } from "./search";

// ---------------------------------------------------------------------------
// Event types. The type list itself is user-editable data, stored
// server-side (event_types table) and managed in イベント管理 →
// イベント種別の管理： the user can add types, rename them, change
// their automatic-classification keywords, reorder them, and delete
// them. Until the server list loads (and as the pre-seed fallback)
// the eleven built-in types below are used, with exactly the keys
// and keywords the server seeds (the original six keep the keys and
// keywords the classification originally hard-coded; five more —
// デザインフェスタ / ZINEフェス / COMIC CITY系 /
// サンシャインクリエイション / 技術書典 — were added 2026-11-16 to
// cover every system in the standard event master list).
//
// An event's type is resolved manual-first: when the user has stored
// a manual type for the event (イベント情報を編集 or the bulk
// 種別設定 in イベント管理）, that wins; otherwise the type is
// classified automatically from the registered event name by walking
// the type list in order and fuzzy-matching each type's keywords
// (so コミティア also hits COMITIA spellings). Comiket days are
// often registered as just "C99" / "C104", so while a type with the
// key "comiket" exists, a bare C + number token also counts as that
// type. Shared by the イベント一覧 (row badges + type filter) and
// the ダッシュボード tab （種別別の内訳 and the trend-chart day
// markers).
//
// 「その他」 (key "other") is LOCKED: it always sits at the TOP of
// the list and can never be deleted （イベント種別の管理）. That
// position is display-only — it carries no keywords, so the
// classification walk above never matches it and it can never take
// priority over another type's keywords; it remains purely the
// fallback for names no type matches, found by key (fallbackType),
// not by position.
// ---------------------------------------------------------------------------

/** A type's stable key (stored on events as the manual type). */
export type EventTypeId = string;

export interface EventTypeDef {
  key: string;
  label: string;
  keywords: string[];
}

export const DEFAULT_EVENT_TYPES: EventTypeDef[] = [
  { key: "other", label: "その他", keywords: [] },
  { key: "comiket", label: "コミックマーケット", keywords: ["コミックマーケット", "コミケ"] },
  { key: "comitia", label: "コミティア系", keywords: ["コミティア"] },
  { key: "designfesta", label: "デザインフェスタ", keywords: ["デザインフェスタ", "デザフェス"] },
  { key: "bungaku", label: "文学フリマ系", keywords: ["文学フリマ", "文フリ"] },
  { key: "zinefes", label: "ZINEフェス", keywords: ["ZINEフェス"] },
  { key: "comiccity", label: "COMIC CITY系", keywords: ["COMIC CITY", "コミックシティ", "SUPER COMIC CITY"] },
  { key: "sunshine", label: "サンシャインクリエイション", keywords: ["サンシャインクリエイション"] },
  { key: "omobaza", label: "おもバザ", keywords: ["おもバザ", "おもしろ同人誌バザール"] },
  { key: "touhou", label: "例大祭・東方系", keywords: ["例大祭", "東方"] },
  { key: "techbook", label: "技術書典", keywords: ["技術書典"] },
];

/**
 * The current event-type list from the server (query key
 * ["eventTypes"], shared by every consumer). Falls back to the
 * eleven built-ins while loading or on error, so first paint
 * matches the seeded behavior.
 */
export function useEventTypes(): EventTypeDef[] {
  const q = useQuery({ queryKey: ["eventTypes"], queryFn: () => api.getEventTypes({}) });
  return q.data?.types ?? DEFAULT_EVENT_TYPES;
}

/**
 * The type an unmatched name falls back to: the "other"-keyed type
 * when one exists, else the first keyword-less type (a catch-all by
 * construction), else the last type in the list.
 */
function fallbackType(types: EventTypeDef[]): EventTypeDef | undefined {
  return (
    types.find((t) => t.key === "other") ??
    types.find((t) => t.keywords.length === 0) ??
    types[types.length - 1]
  );
}

/**
 * The key of the fallback type （その他） in the current list — the
 * type an event resolves to when neither a manual setting nor any
 * keyword matches. Used by the 「その他のみ表示」 filter and by the
 * ledger badge, which is hidden for this type.
 */
export function fallbackTypeKey(types: EventTypeDef[]): string {
  return fallbackType(types)?.key ?? "other";
}

export function classifyEvent(name: string | null, types: EventTypeDef[]): EventTypeId {
  const fallback = fallbackType(types)?.key ?? "other";
  if (!name) return fallback;
  for (const t of types) {
    if (
      t.key === "comiket" &&
      /(^|[^A-Za-z0-9])C\s?\d{2,3}([^0-9]|$)/.test(name)
    ) {
      return t.key;
    }
    if (t.keywords.some((k) => matchesQuery(k, name))) return t.key;
  }
  return fallback;
}

/** Whether a stored value names a type in the current list. */
export function isEventTypeId(
  value: string | null | undefined,
  types: EventTypeDef[],
): value is EventTypeId {
  return value != null && types.some((t) => t.key === value);
}

/** Display label for a type key; unknown keys read as 「その他」. */
export function typeLabel(types: EventTypeDef[], id: string): string {
  return types.find((t) => t.key === id)?.label ?? "その他";
}

/**
 * The effective event type of one day: the manual setting when one is
 * stored (and still exists), otherwise the automatic classification
 * from the event name. `manualType` is the value carried on day
 * summaries / event details (null = no manual setting).
 */
export function resolveEventType(
  name: string | null,
  manualType: string | null | undefined,
  types: EventTypeDef[],
): EventTypeId {
  if (isEventTypeId(manualType, types)) return manualType;
  return classifyEvent(name, types);
}
