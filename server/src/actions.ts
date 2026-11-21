// Actions for 同人誌売上管理 (doujin sales ledger).
//
// Sales are stored only as (date, product) aggregates parsed from Square
// exports. Raw transaction identifiers (order IDs, payment IDs, customer
// data, device names, card details) are never accepted by any action here:
// the client-side importer strips them before anything is sent.

import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import { SEED_SALES } from "./seed-data";
import { ANY_AMOUNT_REF_DATES, SEED_FLAGS } from "./flag-seed-data";
import { SEED_PRODUCT_RELEASES } from "./release-seed-data";
import { SEED_MASTER_EVENTS } from "./master-seed-data";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD形式で入力してください");

// 『任意の金額』 is Square's lump-sum entry name, not a book title. Its
// rows stay in `sales` — the money and copies are real, so day totals,
// year totals, and grand totals include them — but it is never treated
// as a product: the product list, per-product statistics, merge
// candidates, and product counts all exclude it. Day-detail
// breakdowns still show the row, labeled as product-unknown.
const LUMP_SUM_PRODUCT = "任意の金額";

// Products whose Square entries are prices or lump sums rather than
// book titles — their recorded figures cannot be trusted as per-book
// sales, so they carry the product-level 「売り上げは参考情報」 flag
// from the start (applied by applyProductRefFlags). The user can
// toggle the flag per product afterwards.
const REF_FLAG_PRODUCTS = ["500", "100", LUMP_SUM_PRODUCT];

// ---------------------------------------------------------------------------
// Test dummy data (insertDummyData). Clearly-labelled throwaway rows
// for checking the dashboard / compare / list displays: every product
// and event name carries the 【ダミー】 prefix so the rows can never
// be mistaken for real records, and the whole set is wiped by
// resetAllData like any other user-entered data. Dates are picked
// from a fixed candidate list, skipping any date that already has
// sales or an event registration, so dummy rows always land on their
// own days and never mix into a real event day.
// ---------------------------------------------------------------------------

const DUMMY_PRODUCT_PREFIX = "【ダミー】";

const DUMMY_PRODUCTS: { product: string; category: string; price: number }[] = [
  { product: "【ダミー】サンプル本A", category: "本", price: 1000 },
  { product: "【ダミー】サンプル本B", category: "本", price: 500 },
  { product: "【ダミー】サンプルグッズC", category: "グッズ", price: 1500 },
];

/** Copies sold per dummy day (row) x dummy product (column). */
const DUMMY_QTY: number[][] = [
  [12, 5, 3],
  [8, 9, 2],
  [15, 4, 6],
  [6, 11, 4],
];

const DUMMY_CANDIDATE_DATES = [
  "2026-12-05",
  "2026-12-12",
  "2026-12-19",
  "2027-01-09",
  "2027-01-16",
  "2027-01-23",
  "2027-01-30",
  "2027-02-06",
  "2027-02-13",
  "2027-02-20",
];

const DUMMY_PLACES: { prefecture: string; city: string }[] = [
  { prefecture: "東京都", city: "千代田区" },
  { prefecture: "大阪府", city: "大阪市" },
  { prefecture: "愛知県", city: "名古屋市" },
  { prefecture: "福岡県", city: "福岡市" },
];

const eventShape = z.object({
  date: dateStr,
  eventName: z.string().max(200),
  venue: z.string().max(200),
  prefecture: z.string().max(50),
  city: z.string().max(100),
  note: z.string().max(1000),
});

// Manual event-type override values: the `key` of one row in the
// event_types table, plus "" for 「自動判定」 (no manual setting —
// the type is classified from the event name instead). The set of
// valid keys is user-editable data, so the request schema accepts
// any string and the handlers validate it against the stored type
// list (an unknown key — e.g. a type deleted after the form was
// rendered — is stored as "", i.e. back to automatic).
const eventTypeValue = z.string().max(100);

// The eleven built-in event types, seeded into the event_types
// table (seedEventTypes) and used as the effective list until the
// seed has run. The original six keep exactly the keys and keyword
// sets the classification used when the types were hard-coded, so
// existing manual settings and automatic results are unchanged.
// The five added in 2026-11-16 (designfesta / zinefes / comiccity /
// sunshine / techbook) cover the remaining systems of the standard
// event master list (events-master.csv, 1,306 rows): classifying
// every master event name with this list lands each name in its own
// system (238 / 373 / 127 / 130 / 155 / 80 / 83 / 54 / 43 / 22; the
// one exception is ZINE PARK渋谷 — ZINEフェス's sister brand, whose
// name carries no type keyword, so it falls through to その他）. List order is the classification
// priority for the keyword walk; 「その他」 (key "other", no
// keywords) is the exception — it is LOCKED to the FRONT of the
// list (pinned in the management UI, undeletable) purely as a
// display position. Having no keywords it never wins the walk, so
// its top position gives it no classification priority; it stays
// the fallback for names no type matches, and loadEventTypes /
// saveEventTypes enforce the pin server-side.
// `keywords` is the stored comma-separated form.
const DEFAULT_EVENT_TYPES: { key: string; label: string; keywords: string }[] = [
  { key: "other", label: "その他", keywords: "" },
  { key: "comiket", label: "コミックマーケット", keywords: "コミックマーケット,コミケ" },
  { key: "comitia", label: "コミティア系", keywords: "コミティア" },
  { key: "designfesta", label: "デザインフェスタ", keywords: "デザインフェスタ,デザフェス" },
  { key: "bungaku", label: "文学フリマ系", keywords: "文学フリマ,文フリ" },
  { key: "zinefes", label: "ZINEフェス", keywords: "ZINEフェス" },
  { key: "comiccity", label: "COMIC CITY系", keywords: "COMIC CITY,コミックシティ,SUPER COMIC CITY" },
  { key: "sunshine", label: "サンシャインクリエイション", keywords: "サンシャインクリエイション" },
  { key: "omobaza", label: "おもバザ", keywords: "おもバザ,おもしろ同人誌バザール" },
  { key: "touhou", label: "例大祭・東方系", keywords: "例大祭,東方" },
  { key: "techbook", label: "技術書典", keywords: "技術書典" },
];

// Marker row written by saveEventTypes when the user deletes every
// type: it keeps the table non-empty so the "not seeded yet" check
// (zero rows) does not resurrect the built-in defaults. Never shown.
const EVENT_TYPES_EMPTIED_KEY = "__emptied__";

const eventTypeDefShape = z.object({
  key: z.string(),
  label: z.string(),
  keywords: z.array(z.string()),
});

function parseKeywords(stored: string): string[] {
  return stored
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k !== "");
}

interface StoredEventType {
  key: string;
  label: string;
  keywords: string[];
}

/**
 * The effective event-type list: the stored rows in list order, or
 * the built-in defaults when the table has never been seeded. The
 * "__emptied__" marker row (user deleted every type) reads as an
 * empty list, NOT as "not seeded". The 「その他」 row (key "other")
 * is always surfaced FIRST, whatever its stored sort_order: it is
 * locked to the top of the list (see saveEventTypes). The pin is
 * display-only — the row never carries keywords, so classification
 * (a keyword walk in list order on the client) is unaffected.
 */
async function loadEventTypes(ctx: Ctx): Promise<StoredEventType[]> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.eventTypes)
    .orderBy(asc(schema.eventTypes.sortOrder), asc(schema.eventTypes.id));
  if (rows.length === 0) {
    return DEFAULT_EVENT_TYPES.map((t) => ({
      key: t.key,
      label: t.label,
      keywords: parseKeywords(t.keywords),
    }));
  }
  const list = rows
    .filter((r) => r.key !== EVENT_TYPES_EMPTIED_KEY)
    .map((r) => ({ key: r.key, label: r.label, keywords: parseKeywords(r.keywords) }));
  const otherIdx = list.findIndex((t) => t.key === "other");
  if (otherIdx >= 0) {
    const [other] = list.splice(otherIdx, 1);
    // Keywords are cleared here too (not just on save): a list
    // stored before the lock existed could carry keywords on
    // 「その他」, and at the front of the list they would outrank
    // every other type in the classification walk.
    if (other) list.unshift({ ...other, keywords: [] });
  }
  return list;
}

/** Validates a manual event-type value against the stored list. */
async function resolveManualType(ctx: Ctx, value: string): Promise<string> {
  if (value === "") return "";
  const types = await loadEventTypes(ctx);
  return types.some((t) => t.key === value) ? value : "";
}

// Per-date flags (stored in day_flags, independent of event registration).
const flagsShape = z.object({
  salesUnreliable: z.boolean(),
});

const emptyFlags: z.infer<typeof flagsShape> = {
  salesUnreliable: false,
};

const saleRowShape = z.object({
  date: dateStr,
  product: z.string().min(1).max(300),
  category: z.string().max(100),
  qty: z.number(),
  gross: z.number().int(),
  net: z.number().int(),
  tx: z.number().int().nonnegative(),
});

// Import rows may optionally carry the hand-recorded 完売 flag. Only
// the 手記録CSV backup-restore path sets it (its 完売 column); Square
// and 即売レジ imports never do, and for them the stored flag on a
// replaced row is preserved instead (see importSales).
const saleImportRowShape = saleRowShape.extend({
  soldOut: z.boolean().optional(),
});

/**
 * Square's CSV writes the literal 「なし」 as the category of products
 * that have no category set. That placeholder is never a real
 * category: anywhere a category enters storage (the initial seed, a
 * CSV import) it is normalized to "" here as well as in the browser
 * parser, so category fields, datalists and filters only ever see
 * actual category names or unset. (The browser parser already strips
 * it; this is the server-side guarantee for any caller.)
 */
const normalizeCategory = (category: string): string =>
  category.trim() === "なし" ? "" : category;

const daySummaryShape = z.object({
  date: z.string(),
  qty: z.number(),
  net: z.number(),
  tx: z.number(),
  productCount: z.number(),
  // False for days that exist only because an event is registered for
  // them (no Square sales rows yet — e.g. an upcoming event registered
  // ahead of time). Their qty/net/tx are 0; the UI labels them 売上なし
  // instead of ¥0, and sales-day counts (販売日数・年別日数) skip them.
  hasSales: z.boolean(),
  eventName: z.string().nullable(),
  venue: z.string().nullable(),
  prefecture: z.string().nullable(),
  city: z.string().nullable(),
  note: z.string().nullable(),
  // Manual event-type override (an EventTypeId) or null when the day
  // has no manual setting — consumers resolve the effective type as
  // manual-first, automatic classification second (resolveEventType
  // in client/src/eventType.ts). Null for unregistered days too.
  eventType: z.string().nullable(),
  salesUnreliable: z.boolean(),
  // イベントメモ： true when the date has a saved inventory memo (URL,
  // per-product sent counts, and/or a free memo). inventoryTotalQty
  // is the sum of the memo's per-product counts (0 when the memo has
  // no counts recorded).
  hasInventoryMemo: z.boolean(),
  inventoryTotalQty: z.number(),
  // 参加前確認のチケット形式 (event_prep.ticket_type): one of
  // "paper_arrived" / "paper_pending" / "electronic" / "none", or
  // null when no ticket format is set for the date. The ledger row
  // shows it as a badge only while the date is today or later.
  ticketType: z.string().nullable(),
  // 参加前確認のチェック状況 (event_prep): the four departure checks
  // (pop = POP/お品書き, announce = 参加告知, ticket = チケットOK,
  // packing = 荷造りOK), or null when the date has no prep record
  // at all. The ledger row shows them as one compact badge only
  // while the date is today or later.
  prepChecks: z
    .object({
      pop: z.boolean(),
      announce: z.boolean(),
      ticket: z.boolean(),
      packing: z.boolean(),
    })
    .nullable(),
});

type DaySummary = z.infer<typeof daySummaryShape>;

interface DayAgg {
  date: string;
  qty: number;
  net: number;
  tx: number;
  productCount: number;
}

async function loadDaySummaries(ctx: Ctx): Promise<DaySummary[]> {
  const db = ctx.db<typeof schema>();
  const aggs = await db
    .select({
      date: schema.sales.date,
      qty: sql<number>`coalesce(sum(${schema.sales.qty}), 0)`,
      net: sql<number>`coalesce(sum(${schema.sales.net}), 0)`,
      tx: sql<number>`coalesce(sum(${schema.sales.tx}), 0)`,
      // 『任意の金額』 lump-sum rows are not products, so they do not
      // count toward the day's product count (qty/net/tx still include
      // them — the sales themselves are real).
      productCount: sql<number>`coalesce(sum(case when ${schema.sales.product} = ${LUMP_SUM_PRODUCT} then 0 else 1 end), 0)`,
    })
    .from(schema.sales)
    .groupBy(schema.sales.date);
  const evts = await db.select().from(schema.events);
  const byDate = new Map(evts.map((e) => [e.date, e]));
  const flagRows = await db.select().from(schema.dayFlags);
  const flagsByDate = new Map(flagRows.map((f) => [f.date, f]));
  // Inventory memos: a date with a memo counts as having one, and its
  // per-product counts are summed for the row's 合計表示. Memo dates
  // join the ledger union below so a memo is never orphaned (e.g.
  // its event registration was deleted) — the day still shows.
  const memoRows = await db.select().from(schema.inventoryMemos);
  const memoDates = new Set(memoRows.map((m) => m.date));
  // 参加前確認 (event_prep): only the ticket format rides along on
  // the day summary (for the ledger row's badge); prep dates join
  // the ledger union like memo dates so a prep is never orphaned.
  const prepRows = await db.select().from(schema.eventPrep);
  const prepByDate = new Map(prepRows.map((p) => [p.date, p]));
  const itemRows = await db.select().from(schema.inventoryItems);
  const inventoryTotalByDate = new Map<string, number>();
  for (const r of itemRows) {
    inventoryTotalByDate.set(
      r.date,
      (inventoryTotalByDate.get(r.date) ?? 0) + r.qty,
    );
  }
  // The ledger lists the union of sales days and event-registered
  // days: an event can be registered for a date that has no sales yet
  // (e.g. an upcoming event), and it must still show up as that date's
  // row — with hasSales=false and zeroed totals — so 登録件数・最終
  // 登録日・県別の参加回数 all count it.
  const aggByDate = new Map((aggs as DayAgg[]).map((a) => [a.date, a]));
  const dates = [
    ...new Set([
      ...aggByDate.keys(),
      ...byDate.keys(),
      ...memoDates,
      ...prepByDate.keys(),
    ]),
  ].sort((a, b) => b.localeCompare(a));
  return dates.map((date) => {
    const a = aggByDate.get(date);
    const e = byDate.get(date);
    const f = flagsByDate.get(date);
    return {
      date,
      qty: a?.qty ?? 0,
      net: a?.net ?? 0,
      tx: a?.tx ?? 0,
      productCount: a?.productCount ?? 0,
      hasSales: a !== undefined,
      eventName: e ? e.eventName : null,
      venue: e ? e.venue : null,
      prefecture: e ? e.prefecture : null,
      city: e ? e.city : null,
      note: e ? e.note : null,
      eventType: e && e.eventType ? e.eventType : null,
      salesUnreliable: f ? f.salesUnreliable !== 0 : false,
      hasInventoryMemo: memoDates.has(date),
      inventoryTotalQty: inventoryTotalByDate.get(date) ?? 0,
      ticketType: prepByDate.get(date)?.ticketType || null,
      prepChecks: (() => {
        const p = prepByDate.get(date);
        if (!p) return null;
        return {
          pop: p.checkPop !== 0,
          announce: p.checkAnnounce !== 0,
          ticket: p.checkTicket !== 0,
          packing: p.checkPacking !== 0,
        };
      })(),
    };
  });
}

// ---------------------------------------------------------------------------
// Inventory memos （イベントメモ）: per date — one URL, a free memo, and a
// count of copies sent / to bring per product. Stored in their own
// tables (inventory_memos / inventory_items), independent of the
// event registration and of sales, so a future event date with no
// sales can carry a memo. The memo row is deleted when it has no
// content at all, so "has a memo" is simply "a row exists".
// ---------------------------------------------------------------------------

const inventoryMemoShape = z.object({
  url: z.string(),
  memo: z.string(),
  items: z.array(z.object({ product: z.string(), qty: z.number() })),
  totalQty: z.number(),
});

type InventoryMemo = z.infer<typeof inventoryMemoShape>;

async function loadInventoryMemo(
  ctx: Ctx,
  date: string,
): Promise<InventoryMemo | null> {
  const db = ctx.db<typeof schema>();
  const memoRows = await db
    .select()
    .from(schema.inventoryMemos)
    .where(eq(schema.inventoryMemos.date, date));
  const m = memoRows[0];
  if (!m) return null;
  const itemRows = await db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.date, date))
    .orderBy(asc(schema.inventoryItems.product));
  const items = itemRows
    .filter((r) => r.qty > 0)
    .map((r) => ({ product: r.product, qty: r.qty }));
  // Display order follows the app-wide product ordering: effective
  // release date (stored date, or the 2000-01-01 placeholder when
  // unset), newest first; same-date ties fall back to the name.
  const releaseMap = await loadReleaseMap(ctx);
  const effectiveDate = (product: string) =>
    releaseMap.get(product)?.releaseDate || PLACEHOLDER_RELEASE_DATE;
  items.sort(
    (a, b) =>
      effectiveDate(b.product).localeCompare(effectiveDate(a.product)) ||
      a.product.localeCompare(b.product, "ja"),
  );
  return {
    url: m.url,
    memo: m.memo,
    items,
    totalQty: items.reduce((s, r) => s + r.qty, 0),
  };
}

// ---------------------------------------------------------------------------
// 参加前確認 (event_prep): per date — the departure checks （POP/
// お品書き・参加告知・チケットOK・荷造りOK), the event's opening
// hours, the circle's space number, the prep-side venue override,
// the ticket format, and one guide URL (with a by-email flag).
// User data on par with the inventory memos; never part of the
// standard event master list. A row exists only while it has
// content (saveEventPrep deletes an all-empty payload).
// ---------------------------------------------------------------------------

const prepShape = z.object({
  checkPop: z.boolean(),
  checkAnnounce: z.boolean(),
  checkTicket: z.boolean(),
  checkPacking: z.boolean(),
  entryTime: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  space: z.string(),
  venue: z.string(),
  ticketType: z.string(),
  guideUrl: z.string(),
  guideByMail: z.boolean(),
});

type EventPrep = z.infer<typeof prepShape>;

async function loadEventPrep(ctx: Ctx, date: string): Promise<EventPrep | null> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.eventPrep)
    .where(eq(schema.eventPrep.date, date));
  const p = rows[0];
  if (!p) return null;
  return {
    checkPop: p.checkPop !== 0,
    checkAnnounce: p.checkAnnounce !== 0,
    checkTicket: p.checkTicket !== 0,
    checkPacking: p.checkPacking !== 0,
    entryTime: p.entryTime,
    startTime: p.startTime,
    endTime: p.endTime,
    space: p.space,
    venue: p.venue,
    ticketType: p.ticketType,
    guideUrl: p.guideUrl,
    guideByMail: p.guideByMail !== 0,
  };
}

async function loadFlags(
  ctx: Ctx,
  date: string,
): Promise<z.infer<typeof flagsShape>> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.dayFlags)
    .where(eq(schema.dayFlags.date, date));
  const f = rows[0];
  if (!f) return { ...emptyFlags };
  return {
    salesUnreliable: f.salesUnreliable !== 0,
  };
}

// ---------------------------------------------------------------------------
// Product release dates + per-sale appearance info.
//
// The appearance count (持ち込み回数) is judged per (product ×
// prefecture): within one prefecture, the distinct sales dates on or
// after the product's release date on which it actually sold
// (qty > 0), oldest first. Days on which it was only refunded / sold
// 0 copies do not count as appearances, and neither do days before
// the release date (the effective release date is the stored date, or
// the 2000-01-01 placeholder when unset, so unset products count
// every sale).
//
// 「初持ち込み」 is narrower than "first sale in the prefecture"
// (user's definition, 2026-11-16): a sale at an event E in prefecture
// P is a 初持ち込み only when it is the product's first sale in P
// AND its release date is after the most recent participation date
// in P before E — a book that already existed at the previous P
// event could have been brought then, so its first P sale later is
// not a "first bring". At the very first P participation ever, the
// first P sale counts as 初持ち込み regardless of release date.
// Judging by the release-date window (not by whether a P sale is on
// record) also makes old books robust to missing prefecture data:
// a book released before the previous P visit is excluded by its
// release date alone. Days whose prefecture is unregistered cannot
// be judged per prefecture, so they fall back to the product's
// overall appearance order (all prefectures combined).
// ---------------------------------------------------------------------------

const releaseInfoShape = z.object({
  releaseDate: z.string().nullable(), // stored YYYY-MM-DD, null when unset
  releaseBasis: z.string(),
  discontinued: z.boolean(),
  // Product-level 「売り上げは参考情報」: this product's recorded
  // figures may be unreliable (price-named entries, lump sums).
  salesUnreliable: z.boolean(),
});

type ReleaseInfo = z.infer<typeof releaseInfoShape>;

interface ReleaseRow {
  releaseDate: string;
  releaseBasis: string;
  discontinued: number;
  salesUnreliable: number;
  // Registered category — the fallback store used while the product
  // has no sales rows (sales rows carry the category otherwise).
  category: string;
}

async function loadReleaseMap(ctx: Ctx): Promise<Map<string, ReleaseRow>> {
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.productReleases);
  return new Map(rows.map((r) => [r.product, r]));
}

function releaseInfoOf(map: Map<string, ReleaseRow>, product: string): ReleaseInfo {
  const r = map.get(product);
  if (!r)
    return {
      releaseDate: null,
      releaseBasis: "",
      discontinued: false,
      salesUnreliable: false,
    };
  return {
    releaseDate: r.releaseDate ? r.releaseDate : null,
    releaseBasis: r.releaseBasis,
    discontinued: r.discontinued !== 0,
    salesUnreliable: r.salesUnreliable !== 0,
  };
}

/** Whole days from releaseDate to date (negative when sold before release). */
function daysSinceRelease(releaseDate: string | null, date: string): number | null {
  if (!releaseDate) return null;
  const a = Date.parse(`${releaseDate}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

interface AppearanceInfo {
  /**
   * 1-based appearance number for (product, date) within the date's
   * prefecture (falling back to the overall order when the date's
   * prefecture is unregistered); null when the product did not sell
   * that day or the day is before its release date.
   */
  appearanceNo: number | null;
  isFirstAppearance: boolean;
  /** Overall number of days the product sold on (qty > 0), all prefectures. */
  totalAppearances: number;
}

/** Placeholder release date for products whose release date is unset. */
const PLACEHOLDER_RELEASE_DATE = "2000-01-01";

/**
 * Builds, for every product, the ordered lists of dates it sold on
 * (qty > 0, ascending) — overall and per prefecture (the latter only
 * counting dates on or after the effective release date) — and answers
 * appearance lookups per (product, date) using the date's prefecture.
 */
async function loadAppearances(ctx: Ctx): Promise<{
  info: (product: string, date: string) => AppearanceInfo;
  firstSoldDate: Map<string, string>;
}> {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select({ date: schema.sales.date, product: schema.sales.product, qty: schema.sales.qty })
    .from(schema.sales)
    .orderBy(asc(schema.sales.date));
  const evts = await db
    .select({ date: schema.events.date, prefecture: schema.events.prefecture })
    .from(schema.events);
  const prefByDate = new Map(
    evts.map((e) => [e.date, e.prefecture ? e.prefecture : null]),
  );
  const releaseMap = await loadReleaseMap(ctx);
  const effectiveRelease = (product: string): string => {
    const r = releaseMap.get(product);
    return r && r.releaseDate ? r.releaseDate : PLACEHOLDER_RELEASE_DATE;
  };
  const soldDates = new Map<string, string[]>();
  const soldDatesByPref = new Map<string, Map<string, string[]>>();
  const firstSoldDate = new Map<string, string>();
  // Participation dates per prefecture: every date that has any sales
  // and a registered event in that prefecture, ascending, deduplicated
  // (rows are date-ordered). Used for the 初持ち込み window rule.
  const prefEventDates = new Map<string, string[]>();
  for (const r of rows) {
    const pref = prefByDate.get(r.date) ?? null;
    if (pref) {
      const dates = prefEventDates.get(pref) ?? [];
      if (dates[dates.length - 1] !== r.date) dates.push(r.date);
      prefEventDates.set(pref, dates);
    }
    if (!firstSoldDate.has(r.product)) firstSoldDate.set(r.product, r.date);
    if (r.qty > 0) {
      const list = soldDates.get(r.product) ?? [];
      list.push(r.date);
      soldDates.set(r.product, list);
      if (pref && r.date >= effectiveRelease(r.product)) {
        const byPref = soldDatesByPref.get(r.product) ?? new Map<string, string[]>();
        const prefList = byPref.get(pref) ?? [];
        prefList.push(r.date);
        byPref.set(pref, prefList);
        soldDatesByPref.set(r.product, byPref);
      }
    }
  }
  /** Most recent participation date in `pref` strictly before `date`. */
  const prevPrefDate = (pref: string, date: string): string | null => {
    let prev: string | null = null;
    for (const d of prefEventDates.get(pref) ?? []) {
      if (d >= date) break;
      prev = d;
    }
    return prev;
  };
  const info = (product: string, date: string): AppearanceInfo => {
    const overall = soldDates.get(product) ?? [];
    const pref = prefByDate.get(date) ?? null;
    if (pref) {
      // Per-prefecture judgement: only sales on or after the release
      // date count, so a pre-release sale gets no number at all.
      const list = soldDatesByPref.get(product)?.get(pref) ?? [];
      const idx = list.indexOf(date);
      // 初持ち込み: the product's first sale in this prefecture, and
      // released after the previous participation here (or there was
      // no previous participation here at all).
      let isFirst = false;
      if (idx === 0) {
        const prev = prevPrefDate(pref, date);
        isFirst = prev === null || effectiveRelease(product) > prev;
      }
      return {
        appearanceNo: idx >= 0 ? idx + 1 : null,
        isFirstAppearance: isFirst,
        totalAppearances: overall.length,
      };
    }
    // Prefecture unregistered: fall back to the overall appearance order.
    const idx = overall.indexOf(date);
    return {
      appearanceNo: idx >= 0 ? idx + 1 : null,
      isFirstAppearance: idx === 0,
      totalAppearances: overall.length,
    };
  };
  return { info, firstSoldDate };
}

// ---------------------------------------------------------------------------
// Product aliases + merges.
//
// An alias maps an old product name to the canonical product chosen in a
// merge. Resolution follows the chain (an alias may point at a name that
// was itself merged later) with a hop cap so a bad cycle cannot loop.
// ---------------------------------------------------------------------------

async function loadAliasMap(ctx: Ctx): Promise<Map<string, string>> {
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.productAliases);
  return new Map(rows.map((r) => [r.alias, r.canonical]));
}

function resolveAlias(map: Map<string, string>, product: string): string {
  let cur = product;
  for (let i = 0; i < 10; i++) {
    const next = map.get(cur);
    if (!next || next === cur) return cur;
    cur = next;
  }
  return cur;
}

/**
 * Base name normalization for duplicate detection, mirroring the
 * client search's base normalization (search.ts): NFKC width/case
 * folding, katakana -> hiragana, and whitespace stripped. Two product
 * names that differ only in those respects are the same book for
 * registration purposes — a hand-registered name must not create a
 * look-alike twin of an existing product.
 */
function normalizeProductName(name: string): string {
  const t = name.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  return t.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );
}

/**
 * Every name that currently identifies a product: products with sales
 * rows plus products that exist only as a registration (a
 * product_releases row — the 新規登録 path). 『任意の金額』 is not a
 * product and is never included.
 */
async function loadKnownProductNames(ctx: Ctx): Promise<Set<string>> {
  const db = ctx.db<typeof schema>();
  const salesRows = await db
    .select({ product: schema.sales.product })
    .from(schema.sales);
  const releaseRows = await db
    .select({ product: schema.productReleases.product })
    .from(schema.productReleases);
  const names = new Set<string>();
  for (const r of salesRows) names.add(r.product);
  for (const r of releaseRows) names.add(r.product);
  names.delete(LUMP_SUM_PRODUCT);
  return names;
}

interface MergeSnapshot {
  sales: {
    date: string;
    product: string;
    category: string;
    qty: number;
    gross: number;
    net: number;
    tx: number;
    // 完売 flag. Optional because snapshots written before the
    // sold_out column existed do not carry it (read as 0).
    soldOut?: number;
  }[];
  releases: {
    product: string;
    releaseDate: string;
    releaseBasis: string;
    discontinued: number;
    salesUnreliable: number;
    // Registered category. Optional because snapshots written before
    // the category column existed do not carry it (restored as "").
    category?: string;
  }[];
  /** Aliases that pointed at a merged-away name and were re-pointed. */
  aliases: { alias: string; canonical: string }[];
  /**
   * Inventory-memo item rows （イベントメモの冊数） of the involved
   * products, so an undo restores them exactly. Optional because
   * snapshots written before inventory memos existed do not carry it.
   */
  inventory?: { date: string; product: string; qty: number }[];
}

const okResponse = z.object({ ok: z.literal(true) });

export const Actions = {
  seedInitialData: defineAction({
    description:
      "One-time seed: inserts the user's Square sales (already aggregated to date x product, privacy-stripped) only when the sales table is empty.",
    request: z.object({}),
    response: z.object({ seeded: z.boolean(), rows: z.number() }),
    handler: async (ctx): Promise<{ seeded: boolean; rows: number }> => {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.sales);
      if ((existing[0]?.n ?? 0) > 0) return { seeded: false, rows: 0 };
      const statements: BatchItem<"sqlite">[] = SEED_SALES.map((r) =>
        db
          .insert(schema.sales)
          .values({ ...r, category: normalizeCategory(r.category) }),
      );
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      return { seeded: true, rows: SEED_SALES.length };
    },
  }),

  seedInitialFlags: defineAction({
    description:
      "One-time seed: inserts the prepared per-date flags (salesUnreliable for days with <= 5 copies sold) only when the day_flags table is empty.",
    request: z.object({}),
    response: z.object({ seeded: z.boolean(), rows: z.number() }),
    handler: async (ctx): Promise<{ seeded: boolean; rows: number }> => {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.dayFlags);
      if ((existing[0]?.n ?? 0) > 0) return { seeded: false, rows: 0 };
      const statements: BatchItem<"sqlite">[] = SEED_FLAGS.map((r) =>
        db.insert(schema.dayFlags).values(r),
      );
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      return { seeded: true, rows: SEED_FLAGS.length };
    },
  }),

  applyAnyAmountRefFlags: defineAction({
    description:
      "Follow-up seed: sets salesUnreliable on the days whose Square sales consist entirely of 『任意の金額』 lump-sum entries with no per-product breakdown. Upserts only the salesUnreliable column; safe to run more than once.",
    request: z.object({}),
    response: z.object({ applied: z.number() }),
    handler: async (ctx): Promise<{ applied: number }> => {
      const db = ctx.db<typeof schema>();
      const statements: BatchItem<"sqlite">[] = ANY_AMOUNT_REF_DATES.map((date) =>
        db
          .insert(schema.dayFlags)
          .values({ date, salesUnreliable: 1 })
          .onConflictDoUpdate({
            target: schema.dayFlags.date,
            set: { salesUnreliable: 1 },
          }),
      );
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { applied: ANY_AMOUNT_REF_DATES.length };
    },
  }),

  seedProductReleaseDates: defineAction({
    description:
      "One-time seed: inserts the prepared product release dates (17 products cross-checked against the user's blog new-release posts). Release dates use insert-or-ignore per product, so values the user has already set or edited are never overwritten; safe to run more than once.",
    request: z.object({}),
    response: z.object({ inserted: z.number() }),
    handler: async (ctx): Promise<{ inserted: number }> => {
      const db = ctx.db<typeof schema>();
      const statements: BatchItem<"sqlite">[] = [];
      const existing = await db.select().from(schema.productReleases);
      const have = new Set(existing.map((r) => r.product));
      const missing = SEED_PRODUCT_RELEASES.filter((r) => !have.has(r.product));
      for (const r of missing) {
        statements.push(db.insert(schema.productReleases).values(r));
      }

      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      if (missing.length > 0) ctx.invalidateQueries();
      return { inserted: missing.length };
    },
  }),

  saveProductRelease: defineAction({
    description:
      "Creates or updates one product's release info: release date, its basis note, the 廃盤 (discontinued) flag, and the product-level 「売り上げは参考情報」 flag (salesUnreliable — the product's recorded figures may be unreliable). An empty releaseDate clears the stored date; the basis note is kept so the user can record where a date would come from.",
    request: z.object({
      product: z.string().min(1).max(300),
      releaseDate: z.string().max(10),
      releaseBasis: z.string().max(1000),
      discontinued: z.boolean(),
      salesUnreliable: z.boolean(),
    }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      if (args.releaseDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(args.releaseDate)) {
        throw new Error("発行日はYYYY-MM-DD形式で入力してください");
      }
      const db = ctx.db<typeof schema>();
      await db
        .insert(schema.productReleases)
        .values({
          product: args.product,
          releaseDate: args.releaseDate,
          releaseBasis: args.releaseBasis,
          discontinued: args.discontinued ? 1 : 0,
          salesUnreliable: args.salesUnreliable ? 1 : 0,
        })
        .onConflictDoUpdate({
          target: schema.productReleases.product,
          set: {
            releaseDate: args.releaseDate,
            releaseBasis: args.releaseBasis,
            discontinued: args.discontinued ? 1 : 0,
            salesUnreliable: args.salesUnreliable ? 1 : 0,
          },
        });
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  createProduct: defineAction({
    description:
      "Registers a brand-new product （頒布物） by hand, before it has any sales: name (required, trimmed), category, release date, 廃盤 and 除外 flags are stored on its product_releases row — that row is the registration record, and its category column holds the category until sales rows exist to carry it. Refused when the name is already taken: an exact (trimmed) match with any existing product (with or without sales), a match that differs only in width / case / kana spelling, a name registered as a merge/rename alias (the error names the product it belongs to — old names are never resurrected as separate products), or the 『任意の金額』 lump-sum entry, which is not a product.",
    request: z.object({
      product: z.string().min(1).max(300),
      category: z.string().max(100),
      releaseDate: z.string().max(10),
      discontinued: z.boolean(),
      salesUnreliable: z.boolean(),
    }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const name = args.product.trim();
      if (!name) throw new Error("頒布物名を入力してください");
      if (name === LUMP_SUM_PRODUCT) {
        throw new Error(
          "『任意の金額』は頒布物ではないため、登録できません",
        );
      }
      if (args.releaseDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(args.releaseDate)) {
        throw new Error("発行日はYYYY-MM-DD形式で入力してください");
      }
      const db = ctx.db<typeof schema>();
      const known = await loadKnownProductNames(ctx);
      if (known.has(name)) {
        throw new Error(`「${name}」は既に登録されています`);
      }
      // A merged-away / renamed-away old name belongs to its canonical
      // product's history — never resurrect it as a separate product.
      const aliasMap = await loadAliasMap(ctx);
      if (aliasMap.has(name)) {
        throw new Error(
          `「${name}」は「${resolveAlias(aliasMap, name)}」の旧名として登録されているため、新しい頒布物としては登録できません`,
        );
      }
      // Notation variants （全角/半角・大文字小文字・かな表記） of an
      // existing product or alias would read as a different book in
      // lists while being the same book in fact — refuse them too.
      const norm = normalizeProductName(name);
      for (const existing of known) {
        if (normalizeProductName(existing) === norm) {
          throw new Error(
            `「${existing}」と表記が揺れるだけの名前は登録できません（同じ頒布物として扱われます）`,
          );
        }
      }
      for (const alias of aliasMap.keys()) {
        if (normalizeProductName(alias) === norm) {
          throw new Error(
            `「${alias}」は「${resolveAlias(aliasMap, alias)}」の旧名として登録されているため、新しい頒布物としては登録できません`,
          );
        }
      }
      await db.insert(schema.productReleases).values({
        product: name,
        releaseDate: args.releaseDate,
        releaseBasis: "",
        discontinued: args.discontinued ? 1 : 0,
        salesUnreliable: args.salesUnreliable ? 1 : 0,
        category: normalizeCategory(args.category.trim()),
      });
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteProduct: defineAction({
    description:
      "Deletes a product's registration — only for products with NO sales rows at all (a hand-registered book that was never sold, or whose sales were never recorded). The product_releases row (release date / category / 廃盤 / 除外） is removed, together with aliases pointing at the product and merge records whose canonical product it is, so no dangling references remain. Refused when the product has any sales rows (use 統合 / 廃盤 for those) or when inventory-memo counts are recorded for it on any date (clear those counts first, so no memo is left pointing at a product that no longer exists).",
    request: z.object({ product: z.string().min(1).max(300) }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      const name = args.product;
      const salesRows = await db
        .select({ id: schema.sales.id })
        .from(schema.sales)
        .where(eq(schema.sales.product, name));
      if (salesRows.length > 0) {
        throw new Error(
          "売上がある頒布物は削除できません（不要になった本は「廃盤」で扱ってください）",
        );
      }
      const releaseRows = await db
        .select()
        .from(schema.productReleases)
        .where(eq(schema.productReleases.product, name));
      if (releaseRows.length === 0) {
        throw new Error("その頒布物は登録されていません");
      }
      const invRows = await db
        .select({ date: schema.inventoryItems.date, qty: schema.inventoryItems.qty })
        .from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.product, name));
      const invWithCounts = invRows.filter((r) => r.qty > 0);
      if (invWithCounts.length > 0) {
        throw new Error(
          `イベントメモに冊数が記録されているため削除できません（${invWithCounts
            .map((r) => r.date)
            .join("、")}）。先にイベントメモの冊数を空にしてください`,
        );
      }
      const statements: BatchItem<"sqlite">[] = [
        db
          .delete(schema.productReleases)
          .where(eq(schema.productReleases.product, name)),
        db
          .delete(schema.productAliases)
          .where(eq(schema.productAliases.canonical, name)),
        db
          .delete(schema.productMerges)
          .where(eq(schema.productMerges.canonical, name)),
      ];
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  setDiscontinuedFlags: defineAction({
    description:
      "Bulk-sets the 廃盤 (discontinued) flag on many products at once (from the 廃盤を一括で設定 section): upserts only the discontinued column of each product's release-info row, preserving any release date / basis / 参考情報 flag already stored; safe to run more than once.",
    request: z.object({
      updates: z
        .array(
          z.object({
            product: z.string().min(1).max(300),
            discontinued: z.boolean(),
          }),
        )
        .min(1)
        .max(500),
    }),
    response: z.object({ updated: z.number() }),
    handler: async (ctx, args): Promise<{ updated: number }> => {
      const db = ctx.db<typeof schema>();
      const statements: BatchItem<"sqlite">[] = args.updates.map((u) =>
        db
          .insert(schema.productReleases)
          .values({
            product: u.product,
            releaseDate: "",
            releaseBasis: "",
            discontinued: u.discontinued ? 1 : 0,
            salesUnreliable: 0,
          })
          .onConflictDoUpdate({
            target: schema.productReleases.product,
            set: { discontinued: u.discontinued ? 1 : 0 },
          }),
      );
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { updated: args.updates.length };
    },
  }),

  setReleaseDatesFromFirstSales: defineAction({
    description:
      "Sets each named product's release date (発行日) to its first sales date (初頒布日 — the earliest date among its sales rows), from the 「発行日を一括で設定」 section's 「初頒布日を取得する」 button. Upserts only the release-date fields of each product's release-info row — the basis note is rewritten to record that the date came from the first sales date, and the 廃盤 / 除外 flags already stored are preserved. A release date that was already set is overwritten. Products with no sales rows have no first sales date: they are skipped and reported back by name.",
    request: z.object({
      products: z.array(z.string().min(1).max(300)).min(1).max(500),
    }),
    response: z.object({ updated: z.number(), skipped: z.array(z.string()) }),
    handler: async (
      ctx,
      args,
    ): Promise<{ updated: number; skipped: string[] }> => {
      const db = ctx.db<typeof schema>();
      const names = [...new Set(args.products)].filter(
        (p) => p !== LUMP_SUM_PRODUCT,
      );
      const rows = names.length
        ? await db
            .select({
              product: schema.sales.product,
              firstDate: sql<string>`min(${schema.sales.date})`,
            })
            .from(schema.sales)
            .where(inArray(schema.sales.product, names))
            .groupBy(schema.sales.product)
        : [];
      const firstByProduct = new Map(rows.map((r) => [r.product, r.firstDate]));
      const statements: BatchItem<"sqlite">[] = [];
      const skipped: string[] = [];
      for (const name of names) {
        const firstDate = firstByProduct.get(name);
        if (!firstDate) {
          skipped.push(name);
          continue;
        }
        statements.push(
          db
            .insert(schema.productReleases)
            .values({
              product: name,
              releaseDate: firstDate,
              releaseBasis: "初頒布日（最初の販売日）",
              discontinued: 0,
              salesUnreliable: 0,
            })
            .onConflictDoUpdate({
              target: schema.productReleases.product,
              set: {
                releaseDate: firstDate,
                releaseBasis: "初頒布日（最初の販売日）",
              },
            }),
        );
      }
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { updated: statements.length, skipped };
    },
  }),

  setProductCategories: defineAction({
    description:
      "Bulk-sets the category of many products at once (from the 「カテゴリを一括で設定」 section, and for a single product from the unified 頒布物を編集 dialog). Category is an attribute of the sales data itself: every sales row of the product is updated to the given category (an empty string clears it), so all views that read sales rows — product list, day detail, charts — show the same category. The same value is also written to the product's registration row (product_releases.category), which is where the category lives for products with no sales rows yet; the two stores are kept in step here. Products are addressed by their current (canonical) name; unknown names are ignored.",
    request: z.object({
      updates: z
        .array(
          z.object({
            product: z.string().min(1).max(300),
            category: z.string().max(100),
          }),
        )
        .min(1)
        .max(500),
    }),
    response: z.object({ updated: z.number() }),
    handler: async (ctx, args): Promise<{ updated: number }> => {
      const db = ctx.db<typeof schema>();
      const statements: BatchItem<"sqlite">[] = [];
      for (const u of args.updates) {
        const category = normalizeCategory(u.category.trim());
        statements.push(
          db
            .update(schema.sales)
            .set({ category })
            .where(eq(schema.sales.product, u.product)),
        );
        statements.push(
          db
            .insert(schema.productReleases)
            .values({
              product: u.product,
              releaseDate: "",
              releaseBasis: "",
              discontinued: 0,
              salesUnreliable: 0,
              category,
            })
            .onConflictDoUpdate({
              target: schema.productReleases.product,
              set: { category },
            }),
        );
      }
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { updated: args.updates.length };
    },
  }),

  applyProductRefFlags: defineAction({
    description:
      "Follow-up seed: sets the product-level 「売り上げは参考情報」 flag (salesUnreliable) on the products whose Square entries are price-named or lump-sum rather than book titles — 「500」, 「100」, and 『任意の金額』. Upserts only the salesUnreliable column, preserving any release date / basis / discontinued flag already stored for those products; safe to run more than once. 『任意の金額』 never appears in the product list, but its flag is stored as data so the record is complete.",
    request: z.object({}),
    response: z.object({ applied: z.number() }),
    handler: async (ctx): Promise<{ applied: number }> => {
      const db = ctx.db<typeof schema>();
      const statements: BatchItem<"sqlite">[] = REF_FLAG_PRODUCTS.map((product) =>
        db
          .insert(schema.productReleases)
          .values({
            product,
            releaseDate: "",
            releaseBasis: "",
            discontinued: 0,
            salesUnreliable: 1,
          })
          .onConflictDoUpdate({
            target: schema.productReleases.product,
            set: { salesUnreliable: 1 },
          }),
      );
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { applied: REF_FLAG_PRODUCTS.length };
    },
  }),

  cleanEventConfidenceNotes: defineAction({
    description:
      "One-time cleanup requested by the user: removes the assistant-written 「確度」 research annotations (the bulk event-candidate import format 「確度:high|medium / <調査メモ>。売上¥… / 出典:<URL>」) from event notes. Only notes that start with that exact annotation header and match the bulk-import shape are rewritten — the annotation span (including its separators) is removed and any other text in the note is kept character-for-character; a note that is annotation-only becomes empty. Notes that merely mention 確度 without matching the shape are left untouched and reported as ambiguous. Idempotent: cleaned notes no longer match, so re-running changes nothing.",
    request: z.object({}),
    response: z.object({
      changed: z.array(
        z.object({ date: z.string(), before: z.string(), after: z.string() }),
      ),
      ambiguous: z.array(z.object({ date: z.string(), note: z.string() })),
      unchanged: z.number(),
    }),
    handler: async (
      ctx,
    ): Promise<{
      changed: { date: string; before: string; after: string }[];
      ambiguous: { date: string; note: string }[];
      unchanged: number;
    }> => {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.events);
      const changed: { date: string; before: string; after: string }[] = [];
      const ambiguous: { date: string; note: string }[] = [];
      let unchanged = 0;
      const statements: BatchItem<"sqlite">[] = [];

      // The bulk-import annotation always opens the note:
      //   確度:high / <memo>。売上¥30,700 / 出典:https://…
      // One variant has no 出典 segment and ends with the 売上 figure.
      const headerRe = /^確度[:：](?:high|medium|low) \/ /;
      const sourceSep = " / 出典:";
      for (const row of rows) {
        const note = row.note;
        if (!note.includes("確度")) {
          unchanged += 1;
          continue;
        }
        const header = note.match(headerRe);
        if (!header) {
          // Mentions 確度 but not in the bulk-import annotation shape —
          // could be the user's own wording; never guess, just report.
          ambiguous.push({ date: row.date, note });
          continue;
        }
        const rest = note.slice(header[0].length);
        let cleaned: string | null = null;
        const srcIdx = rest.lastIndexOf(sourceSep);
        if (srcIdx >= 0) {
          const body = rest.slice(0, srcIdx);
          const tail = rest.slice(srcIdx + sourceSep.length);
          const tailMatch = tail.match(/^(https?:\/\/\S+)([\s\S]*)$/);
          // The header plus a closing 「出典:<URL>」 segment is the
          // bulk-import signature on its own — the memo body does not
          // always state a 売上¥ figure (e.g. a day explained by the
          // absence of Square sales), so the body is not checked.
          if (tailMatch && body.length > 0) {
            // Anything after the source URL is the user's own text:
            // keep it verbatim, dropping only the separator that tied
            // it to the annotation.
            cleaned = (tailMatch[2] ?? "").replace(/^[\s/／]+/, "").trim();
          }
        } else if (/売上¥[\d,]+$/.test(rest.trim())) {
          // No-source variant: the memo runs to the end of the note
          // and finishes with the sales figure — annotation only.
          cleaned = "";
        }
        if (cleaned === null) {
          ambiguous.push({ date: row.date, note });
          continue;
        }
        changed.push({ date: row.date, before: note, after: cleaned });
        statements.push(
          db
            .update(schema.events)
            .set({ note: cleaned })
            .where(eq(schema.events.date, row.date)),
        );
      }

      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      if (changed.length > 0) ctx.invalidateQueries();
      return { changed, ambiguous, unchanged };
    },
  }),

  clearNoneCategories: defineAction({
    description:
      "One-time cleanup requested by the user: rewrites every stored sales row whose category is the Square placeholder 「なし」 (the literal Square writes for products with no category) to an empty category, so no product carries 「なし」 as if it were a category name. New imports already normalize 「なし」 to empty at parse/import time; this clears the rows stored before that. Only the category column changes — quantities, amounts and every other field are untouched. Idempotent: converted rows no longer match, so re-running changes nothing.",
    request: z.object({}),
    response: z.object({ updated: z.number(), products: z.number() }),
    handler: async (
      ctx,
    ): Promise<{ updated: number; products: number }> => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select({ product: schema.sales.product })
        .from(schema.sales)
        .where(eq(schema.sales.category, "なし"));
      if (rows.length === 0) return { updated: 0, products: 0 };
      await db
        .update(schema.sales)
        .set({ category: "" })
        .where(eq(schema.sales.category, "なし"));
      ctx.invalidateQueries();
      return {
        updated: rows.length,
        products: new Set(rows.map((r) => r.product)).size,
      };
    },
  }),

  mergeProducts: defineAction({
    description:
      "Merges several products into one canonical product (user-selected, never automatic): all sales rows move to the canonical name, same-day rows are summed, the canonical product's release date / discontinued flag win (unset fields inherit from the merged-away products), and each old name becomes an alias so future Square imports under the old name land on the canonical product. A full snapshot is stored so the merge can be undone.",
    request: z.object({
      canonical: z.string().min(1).max(300),
      sources: z.array(z.string().min(1).max(300)).min(1).max(20),
    }),
    response: z.object({ mergeId: z.number(), movedRows: z.number() }),
    handler: async (ctx, args): Promise<{ mergeId: number; movedRows: number }> => {
      const db = ctx.db<typeof schema>();
      const aliasMap = await loadAliasMap(ctx);
      const canonical = resolveAlias(aliasMap, args.canonical);
      const sources = [...new Set(args.sources.map((s) => resolveAlias(aliasMap, s)))].filter(
        (s) => s !== canonical,
      );
      if (sources.length === 0) throw new Error("統合元が統合先と同一です");
      const involved = [canonical, ...sources];

      // Snapshot everything the merge touches, for exact undo.
      const salesRows = await db
        .select()
        .from(schema.sales)
        .where(inArray(schema.sales.product, involved));
      const releaseRows = await db
        .select()
        .from(schema.productReleases)
        .where(inArray(schema.productReleases.product, involved));
      const repointed = [...aliasMap.entries()]
        .filter(([, target]) => sources.includes(target))
        .map(([alias, target]) => ({ alias, canonical: target }));
      // Inventory-memo counts follow the merge like sales do: the
      // sources' counts move to the canonical product, summed per
      // date, and the pre-merge rows are snapshotted for undo.
      const inventoryRows = await db
        .select()
        .from(schema.inventoryItems)
        .where(inArray(schema.inventoryItems.product, involved));
      const snapshot: MergeSnapshot = {
        sales: salesRows.map((r) => ({
          date: r.date,
          product: r.product,
          category: r.category,
          qty: r.qty,
          gross: r.gross,
          net: r.net,
          tx: r.tx,
          soldOut: r.soldOut,
        })),
        releases: releaseRows.map((r) => ({ ...r })),
        aliases: repointed,
        inventory: inventoryRows.map((r) => ({
          date: r.date,
          product: r.product,
          qty: r.qty,
        })),
      };

      // Merged sales: group by date, summing the sources into the
      // canonical product. Category prefers the canonical row's.
      const byDate = new Map<
        string,
        {
          category: string;
          qty: number;
          gross: number;
          net: number;
          tx: number;
          soldOut: number;
        }
      >();
      for (const r of salesRows) {
        const cur =
          byDate.get(r.date) ??
          { category: "", qty: 0, gross: 0, net: 0, tx: 0, soldOut: 0 };
        cur.qty += r.qty;
        cur.gross += r.gross;
        cur.net += r.net;
        cur.tx += r.tx;
        // 完売 survives a merge when any of the merged rows sold out
        // that day — the merged book still ran out of stock.
        if (r.soldOut !== 0) cur.soldOut = 1;
        if (r.product === canonical && r.category) cur.category = r.category;
        else if (!cur.category && r.category) cur.category = r.category;
        byDate.set(r.date, cur);
      }

      // Merged release info: canonical wins; unset fields inherit from
      // the first source (in the order given) that has them.
      const relOf = (p: string) => releaseRows.find((r) => r.product === p);
      // A sales-less canonical has no sales rows to express its
      // category preference in the loop above; its registered category
      // wins over the sources' sales-row categories, like every other
      // field.
      const canonicalRegisteredCategory = relOf(canonical)?.category ?? "";
      if (
        canonicalRegisteredCategory &&
        !salesRows.some((r) => r.product === canonical)
      ) {
        for (const v of byDate.values()) v.category = canonicalRegisteredCategory;
      }
      const cRel = relOf(canonical);
      // Effective category of a product in this merge: its sales rows'
      // category when it has sales, otherwise the category registered
      // on its release row (the only store a sales-less product has).
      const salesCategoryOf = (p: string) =>
        salesRows.find((r) => r.product === p && r.category)?.category ?? "";
      const effectiveCategoryOf = (p: string) =>
        salesCategoryOf(p) || relOf(p)?.category || "";
      let mergedRelease: MergeSnapshot["releases"][number] | null = null;
      if (cRel || sources.some((s) => relOf(s))) {
        const dateSource = !cRel?.releaseDate
          ? sources.map(relOf).find((r) => r?.releaseDate)
          : undefined;
        mergedRelease = {
          product: canonical,
          releaseDate: cRel?.releaseDate || dateSource?.releaseDate || "",
          releaseBasis:
            cRel?.releaseBasis ||
            (dateSource ? dateSource.releaseBasis : "") ||
            sources.map(relOf).find((r) => r?.releaseBasis)?.releaseBasis ||
            "",
          discontinued:
            (cRel?.discontinued ?? 0) !== 0 ||
            sources.some((s) => (relOf(s)?.discontinued ?? 0) !== 0)
              ? 1
              : 0,
          // The 参考情報 flag follows the same rule as 廃盤: if any
          // side is flagged, the merged product stays flagged.
          salesUnreliable:
            (cRel?.salesUnreliable ?? 0) !== 0 ||
            sources.some((s) => (relOf(s)?.salesUnreliable ?? 0) !== 0)
              ? 1
              : 0,
          // Category follows the canonical-wins rule too, so a merge
          // whose canonical side is a sales-less registered product
          // keeps its registered category (and gains one from a source
          // when the canonical side has none).
          category:
            effectiveCategoryOf(canonical) ||
            sources.map(effectiveCategoryOf).find((c) => c) ||
            "",
        };
      }

      const statements: BatchItem<"sqlite">[] = [];
      statements.push(
        db.insert(schema.productMerges).values({
          createdAt: new Date().toISOString(),
          canonical,
          sources: JSON.stringify(sources),
          snapshot: JSON.stringify(snapshot),
        }),
      );
      statements.push(
        db.delete(schema.sales).where(inArray(schema.sales.product, involved)),
      );
      for (const [date, v] of byDate) {
        statements.push(
          db.insert(schema.sales).values({ date, product: canonical, ...v }),
        );
      }
      statements.push(
        db
          .delete(schema.productReleases)
          .where(inArray(schema.productReleases.product, involved)),
      );
      if (mergedRelease) {
        statements.push(db.insert(schema.productReleases).values(mergedRelease));
      }
      for (const s of sources) {
        statements.push(
          db
            .insert(schema.productAliases)
            .values({ alias: s, canonical })
            .onConflictDoUpdate({
              target: schema.productAliases.alias,
              set: { canonical },
            }),
        );
      }
      for (const a of repointed) {
        statements.push(
          db
            .update(schema.productAliases)
            .set({ canonical })
            .where(eq(schema.productAliases.alias, a.alias)),
        );
      }
      // Inventory-memo counts: delete the involved rows and re-insert
      // them under the canonical product, summed per date.
      if (inventoryRows.length > 0) {
        statements.push(
          db
            .delete(schema.inventoryItems)
            .where(inArray(schema.inventoryItems.product, involved)),
        );
        const invByDate = new Map<string, number>();
        for (const r of inventoryRows) {
          invByDate.set(r.date, (invByDate.get(r.date) ?? 0) + r.qty);
        }
        for (const [date, qty] of invByDate) {
          statements.push(
            db
              .insert(schema.inventoryItems)
              .values({ date, product: canonical, qty }),
          );
        }
      }
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);

      const mergeRows = await db
        .select({ id: schema.productMerges.id })
        .from(schema.productMerges)
        .orderBy(desc(schema.productMerges.id));
      ctx.invalidateQueries();
      return { mergeId: mergeRows[0]?.id ?? 0, movedRows: salesRows.length };
    },
  }),

  renameProduct: defineAction({
    description:
      "Renames one product (user-initiated, from the product edit UI): all sales rows and the release-date / discontinued record move to the new name, and the old name is registered as an alias so future Square imports under the old name land on the new name instead of resurrecting it as a separate product. Renaming onto a name that already belongs to another product is refused — that is a merge, handled by mergeProducts. Merge records whose canonical product is renamed are updated so their undo snapshots stay consistent.",
    request: z.object({
      oldName: z.string().min(1).max(300),
      newName: z.string().min(1).max(300),
    }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      const oldName = args.oldName;
      const newName = args.newName.trim();
      if (!newName) throw new Error("新しい頒布物名を入力してください");
      if (newName === oldName) throw new Error("新しい名前が現在の名前と同じです");

      // The old name must be an existing product.
      const oldSales = await db
        .select({ id: schema.sales.id })
        .from(schema.sales)
        .where(eq(schema.sales.product, oldName));
      const oldRelease = await db
        .select()
        .from(schema.productReleases)
        .where(eq(schema.productReleases.product, oldName));
      if (oldSales.length === 0 && oldRelease.length === 0) {
        throw new Error("変更元の頒布物が見つかりません");
      }

      // Safe side: a new name that already belongs to another product
      // (sales rows or a release record under that name) would really
      // be a merge — refuse and let the user run mergeProducts instead.
      const mergeGuidance =
        "その名前の頒布物が既にあります。名前変更ではなく統合になるため、頒布物の統合機能を使ってください";
      const newSales = await db
        .select({ id: schema.sales.id })
        .from(schema.sales)
        .where(eq(schema.sales.product, newName));
      if (newSales.length > 0) throw new Error(mergeGuidance);
      const newRelease = await db
        .select()
        .from(schema.productReleases)
        .where(eq(schema.productReleases.product, newName));
      if (newRelease.length > 0) throw new Error(mergeGuidance);

      // A new name that is an alias of a DIFFERENT product belongs to
      // that product's history — refuse. An alias of this same product
      // (renaming back to a previous name) is allowed: that alias row
      // is removed below because the name becomes canonical again.
      const aliasMap = await loadAliasMap(ctx);
      if (aliasMap.has(newName) && resolveAlias(aliasMap, newName) !== oldName) {
        throw new Error(
          "その名前は別の頒布物の旧名として対応表に登録されています。別の名前を選んでください",
        );
      }

      // Merge records for this product: keep their canonical name and
      // undo snapshots pointing at the renamed product.
      const mergeRows = await db
        .select()
        .from(schema.productMerges)
        .where(eq(schema.productMerges.canonical, oldName));

      // Inventory-memo counts recorded under the old name follow the
      // rename, summed into any row the new name already has for the
      // same date (rename-back edge).
      const invRows = await db
        .select()
        .from(schema.inventoryItems)
        .where(
          inArray(schema.inventoryItems.product, [oldName, newName]),
        );

      const statements: BatchItem<"sqlite">[] = [];
      if (invRows.length > 0) {
        statements.push(
          db
            .delete(schema.inventoryItems)
            .where(
              inArray(schema.inventoryItems.product, [oldName, newName]),
            ),
        );
        const invByDate = new Map<string, number>();
        for (const r of invRows) {
          invByDate.set(r.date, (invByDate.get(r.date) ?? 0) + r.qty);
        }
        for (const [date, qty] of invByDate) {
          statements.push(
            db.insert(schema.inventoryItems).values({ date, product: newName, qty }),
          );
        }
      }
      // 1) Drop the alias row for the new name first (rename-back case),
      //    before re-pointing would turn it into a self-loop.
      statements.push(
        db.delete(schema.productAliases).where(eq(schema.productAliases.alias, newName)),
      );
      // 2) Sales history moves to the new name (all views read sales).
      statements.push(
        db
          .update(schema.sales)
          .set({ product: newName })
          .where(eq(schema.sales.product, oldName)),
      );
      // 3) Release date / basis / discontinued flag carry over as-is.
      const rel = oldRelease[0];
      if (rel) {
        statements.push(
          db
            .delete(schema.productReleases)
            .where(eq(schema.productReleases.product, oldName)),
        );
        statements.push(
          db.insert(schema.productReleases).values({ ...rel, product: newName }),
        );
      }
      // 4) Aliases that pointed at the old name now point at the new
      //    name, and the old name itself becomes an alias of the new
      //    name so future Square imports under the old name resolve
      //    here instead of resurrecting the old product.
      statements.push(
        db
          .update(schema.productAliases)
          .set({ canonical: newName })
          .where(eq(schema.productAliases.canonical, oldName)),
      );
      statements.push(
        db
          .insert(schema.productAliases)
          .values({ alias: oldName, canonical: newName })
          .onConflictDoUpdate({
            target: schema.productAliases.alias,
            set: { canonical: newName },
          }),
      );
      // 5) Merge history follows the rename.
      for (const m of mergeRows) {
        const snapshot = JSON.parse(m.snapshot) as MergeSnapshot;
        for (const r of snapshot.sales) if (r.product === oldName) r.product = newName;
        for (const r of snapshot.releases) if (r.product === oldName) r.product = newName;
        for (const r of snapshot.inventory ?? [])
          if (r.product === oldName) r.product = newName;
        statements.push(
          db
            .update(schema.productMerges)
            .set({ canonical: newName, snapshot: JSON.stringify(snapshot) })
            .where(eq(schema.productMerges.id, m.id)),
        );
      }
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  undoProductMerge: defineAction({
    description:
      "Undoes one product merge from its stored snapshot: sales rows (including same-day sums), release info, and aliases return to exactly their pre-merge state, and the merge record is removed. Sales imported after the merge for the same products on the snapshot's dates are replaced by the restored rows.",
    request: z.object({ mergeId: z.number().int().positive() }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.productMerges)
        .where(eq(schema.productMerges.id, args.mergeId));
      const merge = rows[0];
      if (!merge) throw new Error("その統合履歴が見つかりません");
      const sources = JSON.parse(merge.sources) as string[];
      const snapshot = JSON.parse(merge.snapshot) as MergeSnapshot;
      const involved = [merge.canonical, ...sources];
      const dates = [...new Set(snapshot.sales.map((r) => r.date))];

      const statements: BatchItem<"sqlite">[] = [];
      if (dates.length > 0) {
        statements.push(
          db
            .delete(schema.sales)
            .where(
              and(
                inArray(schema.sales.product, involved),
                inArray(schema.sales.date, dates),
              ),
            ),
        );
        for (const r of snapshot.sales) {
          statements.push(
            db.insert(schema.sales).values({ ...r, soldOut: r.soldOut ?? 0 }),
          );
        }
      }
      statements.push(
        db
          .delete(schema.productReleases)
          .where(inArray(schema.productReleases.product, involved)),
      );
      for (const r of snapshot.releases) {
        statements.push(db.insert(schema.productReleases).values(r));
      }
      for (const s of sources) {
        statements.push(
          db.delete(schema.productAliases).where(eq(schema.productAliases.alias, s)),
        );
      }
      for (const a of snapshot.aliases) {
        statements.push(
          db
            .insert(schema.productAliases)
            .values(a)
            .onConflictDoUpdate({
              target: schema.productAliases.alias,
              set: { canonical: a.canonical },
            }),
        );
      }
      // Inventory-memo counts return to their pre-merge state too
      // (snapshots written before inventory memos existed skip this).
      const snapshotInventory = snapshot.inventory ?? [];
      if (snapshotInventory.length > 0) {
        const invDates = [...new Set(snapshotInventory.map((r) => r.date))];
        statements.push(
          db
            .delete(schema.inventoryItems)
            .where(
              and(
                inArray(schema.inventoryItems.product, involved),
                inArray(schema.inventoryItems.date, invDates),
              ),
            ),
        );
        for (const r of snapshotInventory) {
          statements.push(db.insert(schema.inventoryItems).values(r));
        }
      }
      statements.push(
        db.delete(schema.productMerges).where(eq(schema.productMerges.id, args.mergeId)),
      );
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  getProductMerges: defineAction({
    description:
      "Returns the current product aliases (old name -> canonical product, applied to future Square imports) and the merge history available for undo.",
    request: z.object({}),
    response: z.object({
      aliases: z.array(z.object({ alias: z.string(), canonical: z.string() })),
      merges: z.array(
        z.object({
          id: z.number(),
          createdAt: z.string(),
          canonical: z.string(),
          sources: z.array(z.string()),
        }),
      ),
    }),
    handler: async (ctx) => {
      const db = ctx.db<typeof schema>();
      const aliasRows = await db
        .select()
        .from(schema.productAliases)
        .orderBy(asc(schema.productAliases.alias));
      const mergeRows = await db
        .select()
        .from(schema.productMerges)
        .orderBy(desc(schema.productMerges.id));
      return {
        aliases: aliasRows,
        merges: mergeRows.map((m) => ({
          id: m.id,
          createdAt: m.createdAt,
          canonical: m.canonical,
          sources: JSON.parse(m.sources) as string[],
        })),
      };
    },
  }),

  getOverview: defineAction({
    description:
      "Returns grand totals, per-year totals, the newest date with sales, and the per-day ledger (the union of sales days and event-registered days, joined with registered event info; event-only days carry hasSales=false), newest first.",
    request: z.object({}),
    response: z.object({
      totalNet: z.number(),
      totalQty: z.number(),
      totalTx: z.number(),
      dayCount: z.number(),
      registeredCount: z.number(),
      // Newest date that has sales rows, from any source (any CSV
      // import or manual entry). Event-only registrations without
      // sales do not count. Null when no sales are recorded yet.
      lastRegisteredDate: z.string().nullable(),
      productCount: z.number(),
      years: z.array(
        z.object({
          year: z.string(),
          net: z.number(),
          qty: z.number(),
          days: z.number(),
        }),
      ),
      days: z.array(daySummaryShape),
    }),
    handler: async (ctx) => {
      const db = ctx.db<typeof schema>();
      const days = await loadDaySummaries(ctx);
      const prod = await db
        .select({
          n: sql<number>`count(distinct case when ${schema.sales.product} <> ${LUMP_SUM_PRODUCT} then ${schema.sales.product} end)`,
        })
        .from(schema.sales);
      const yearMap = new Map<string, { net: number; qty: number; days: number }>();
      let totalNet = 0;
      let totalQty = 0;
      let totalTx = 0;
      for (const d of days) {
        totalNet += d.net;
        totalQty += d.qty;
        totalTx += d.tx;
        // Per-year day counts are 販売日数: event-only days (registered
        // ahead of time, no sales yet) do not count as sales days.
        if (!d.hasSales) continue;
        const y = d.date.slice(0, 4);
        const cur = yearMap.get(y) ?? { net: 0, qty: 0, days: 0 };
        cur.net += d.net;
        cur.qty += d.qty;
        cur.days += 1;
        yearMap.set(y, cur);
      }
      return {
        totalNet,
        totalQty,
        totalTx,
        // 販売日数 counts only days that actually have sales rows;
        // event-only registrations appear in the ledger and in
        // registeredCount but are not sales days.
        dayCount: days.filter((d) => d.hasSales).length,
        registeredCount: days.filter((d) => d.eventName !== null).length,
        // Days come back newest-first, so the first day with sales is
        // the newest sales date （最終登録日 as shown at the top).
        lastRegisteredDate: days.find((d) => d.hasSales)?.date ?? null,
        productCount: prod[0]?.n ?? 0,
        years: [...yearMap.entries()]
          .map(([year, v]) => ({ year, ...v }))
          .sort((a, b) => a.year.localeCompare(b.year)),
        days,
      };
    },
  }),

  getDayDetail: defineAction({
    description:
      "Returns the per-product sales breakdown for one date, plus its registered event info if any.",
    request: z.object({ date: dateStr }),
    response: z.object({
      date: z.string(),
      rows: z.array(
        z.object({
          product: z.string(),
          category: z.string(),
          qty: z.number(),
          gross: z.number(),
          net: z.number(),
          tx: z.number(),
          // 完売： that day this product sold out (stock brought ran
          // short). Hand-recorded in the sales editor; imports never
          // set it.
          soldOut: z.boolean(),
          appearanceNo: z.number().nullable(),
          isFirstAppearance: z.boolean(),
          daysSinceRelease: z.number().nullable(),
          releaseDate: z.string().nullable(),
          // Product-level 「売り上げは参考情報」 flag for this row's
          // product (also true for the 『任意の金額』 lump-sum row,
          // whose flag is stored as data even though it is not a book).
          productSalesUnreliable: z.boolean(),
          // 廃盤 (discontinued) flag for this row's product, so the
          // client can hide discontinued rows in the day breakdown
          // when the user turns that display setting on. Display
          // only — totals always include every row.
          discontinued: z.boolean(),
        }),
      ),
      event: eventShape.extend({ eventType: z.string() }).nullable(),
      flags: flagsShape,
      // イベントメモ for this date (URL / per-product sent counts / free
      // memo), or null when none is saved.
      inventoryMemo: inventoryMemoShape.nullable(),
      // 参加前確認 for this date (departure checks / hours / space /
      // ticket format / guide URL), or null when nothing is recorded.
      prep: prepShape.nullable(),
    }),
    handler: async (ctx, args) => {
      const db = ctx.db<typeof schema>();
      const rawRows = (
        await db
          .select({
            product: schema.sales.product,
            category: schema.sales.category,
            qty: schema.sales.qty,
            gross: schema.sales.gross,
            net: schema.sales.net,
            tx: schema.sales.tx,
            soldOut: schema.sales.soldOut,
          })
          .from(schema.sales)
          .where(eq(schema.sales.date, args.date))
          .orderBy(desc(schema.sales.qty), asc(schema.sales.product))
      ).map((r) => ({ ...r, soldOut: r.soldOut !== 0 }));
      const appearances = await loadAppearances(ctx);
      const releaseMap = await loadReleaseMap(ctx);
      const rows = rawRows.map((r) => {
        const rel = releaseInfoOf(releaseMap, r.product);
        // The lump-sum row stays in the day breakdown (its money is
        // real) but it is not a book: no appearance / release info.
        if (r.product === LUMP_SUM_PRODUCT) {
          return {
            ...r,
            appearanceNo: null,
            isFirstAppearance: false,
            daysSinceRelease: null,
            releaseDate: null,
            productSalesUnreliable: rel.salesUnreliable,
            discontinued: false,
          };
        }
        const app = appearances.info(r.product, args.date);
        return {
          ...r,
          appearanceNo: app.appearanceNo,
          isFirstAppearance: app.isFirstAppearance,
          daysSinceRelease: daysSinceRelease(rel.releaseDate, args.date),
          releaseDate: rel.releaseDate,
          productSalesUnreliable: rel.salesUnreliable,
          discontinued: rel.discontinued,
        };
      });
      const ev = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.date, args.date));
      const e = ev[0];
      return {
        date: args.date,
        rows,
        event: e
          ? {
              date: e.date,
              eventName: e.eventName,
              venue: e.venue,
              prefecture: e.prefecture,
              city: e.city,
              note: e.note,
              eventType: e.eventType,
            }
          : null,
        flags: await loadFlags(ctx, args.date),
        inventoryMemo: await loadInventoryMemo(ctx, args.date),
        prep: await loadEventPrep(ctx, args.date),
      };
    },
  }),

  saveEventPrep: defineAction({
    description:
      "Creates or updates the 参加前確認 (pre-event checklist) for one date: four departure checks (POP/お品書き, 参加告知, チケットOK, 荷造りOK), the entry start time (入場開始時間, HH:MM, optional), the event's start/end times (HH:MM, either may be empty), the circle's space number (free text), a prep-side venue override (the event registration's own venue is never changed; empty means the registration's venue is shown), the ticket format (paper_arrived / paper_pending / electronic / none, or \"\" for unset), one guide URL (empty or http/https only), and a flag for the guide having arrived by email. When every field is empty the record is deleted instead, so a stored prep always has content. Works on any date — in particular a future event date with an event registration but no sales. This is per-date user data only; the standard event master list is never touched.",
    request: z.object({
      date: dateStr,
      checkPop: z.boolean(),
      checkAnnounce: z.boolean(),
      checkTicket: z.boolean(),
      checkPacking: z.boolean(),
      entryTime: z
        .string()
        .max(5)
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻は HH:MM の形で入力してください")
        .or(z.literal("")),
      startTime: z
        .string()
        .max(5)
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻は HH:MM の形で入力してください")
        .or(z.literal("")),
      endTime: z
        .string()
        .max(5)
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻は HH:MM の形で入力してください")
        .or(z.literal("")),
      space: z.string().max(50),
      venue: z.string().max(200),
      ticketType: z.enum(["", "paper_arrived", "paper_pending", "electronic", "none"]),
      guideUrl: z.string().max(2000),
      guideByMail: z.boolean(),
    }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      const guideUrl = args.guideUrl.trim();
      if (guideUrl !== "") {
        let parsed: URL | null = null;
        try {
          parsed = new URL(guideUrl);
        } catch {
          parsed = null;
        }
        if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
          throw new Error("URLは http:// または https:// で始まる形で入力してください");
        }
      }
      const space = args.space.trim();
      const venue = args.venue.trim();
      const empty =
        !args.checkPop &&
        !args.checkAnnounce &&
        !args.checkTicket &&
        !args.checkPacking &&
        args.entryTime === "" &&
        args.startTime === "" &&
        args.endTime === "" &&
        space === "" &&
        venue === "" &&
        args.ticketType === "" &&
        guideUrl === "" &&
        !args.guideByMail;
      if (empty) {
        await db
          .delete(schema.eventPrep)
          .where(eq(schema.eventPrep.date, args.date));
        ctx.invalidateQueries();
        return { ok: true as const };
      }
      const row = {
        date: args.date,
        checkPop: args.checkPop ? 1 : 0,
        checkAnnounce: args.checkAnnounce ? 1 : 0,
        checkTicket: args.checkTicket ? 1 : 0,
        checkPacking: args.checkPacking ? 1 : 0,
        entryTime: args.entryTime,
        startTime: args.startTime,
        endTime: args.endTime,
        space,
        venue,
        ticketType: args.ticketType,
        guideUrl,
        guideByMail: args.guideByMail ? 1 : 0,
      };
      await db
        .insert(schema.eventPrep)
        .values(row)
        .onConflictDoUpdate({
          target: schema.eventPrep.date,
          set: {
            checkPop: row.checkPop,
            checkAnnounce: row.checkAnnounce,
            checkTicket: row.checkTicket,
            checkPacking: row.checkPacking,
            entryTime: row.entryTime,
            startTime: row.startTime,
            endTime: row.endTime,
            space: row.space,
            venue: row.venue,
            ticketType: row.ticketType,
            guideUrl: row.guideUrl,
            guideByMail: row.guideByMail,
          },
        });
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  saveInventoryMemo: defineAction({
    description:
      "Creates or updates the inventory memo （イベントメモ） for one date: one URL (official site etc.; empty or http/https only), a free-text memo, and per-product counts of copies sent / to bring. Items with qty <= 0 are dropped and duplicate product entries are summed; product names are resolved through the merge alias table like sales imports, and 『任意の金額』 is refused (not a product). The item rows for the date are replaced wholesale. When URL, memo, and items are all empty, the memo is deleted instead, so a stored memo always has content. Works on any date — including a future event date with an event registration but no sales.",
    request: z.object({
      date: dateStr,
      url: z.string().max(2000),
      memo: z.string().max(5000),
      items: z
        .array(
          z.object({
            product: z.string().min(1).max(300),
            qty: z.number().int().min(0).max(100000),
          }),
        )
        .max(500),
    }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      const url = args.url.trim();
      if (url !== "") {
        let parsed: URL | null = null;
        try {
          parsed = new URL(url);
        } catch {
          parsed = null;
        }
        if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
          throw new Error("URLは http:// または https:// で始まる形で入力してください");
        }
      }
      const memo = args.memo;
      // Resolve merged-away names to their canonical product (same
      // rule as importSales), drop zero counts, and sum duplicates.
      const aliasMap = await loadAliasMap(ctx);
      const byProduct = new Map<string, number>();
      for (const item of args.items) {
        if (item.qty <= 0) continue;
        const product = resolveAlias(aliasMap, item.product);
        if (product === LUMP_SUM_PRODUCT) {
          throw new Error("『任意の金額』は頒布物ではないため、イベントメモには記録できません");
        }
        byProduct.set(product, (byProduct.get(product) ?? 0) + item.qty);
      }
      const items = [...byProduct.entries()].map(([product, qty]) => ({
        date: args.date,
        product,
        qty,
      }));

      if (url === "" && memo.trim() === "" && items.length === 0) {
        // No content at all: the memo ceases to exist.
        await db.batch([
          db
            .delete(schema.inventoryItems)
            .where(eq(schema.inventoryItems.date, args.date)),
          db
            .delete(schema.inventoryMemos)
            .where(eq(schema.inventoryMemos.date, args.date)),
        ]);
        ctx.invalidateQueries();
        return { ok: true as const };
      }

      const statements: BatchItem<"sqlite">[] = [
        db
          .insert(schema.inventoryMemos)
          .values({ date: args.date, url, memo })
          .onConflictDoUpdate({
            target: schema.inventoryMemos.date,
            set: { url, memo },
          }),
        db
          .delete(schema.inventoryItems)
          .where(eq(schema.inventoryItems.date, args.date)),
        ...items.map((r) => db.insert(schema.inventoryItems).values(r)),
      ];
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  saveEvent: defineAction({
    description:
      "Creates or updates the event registration (name, venue, prefecture, city, note) for one date, together with its per-date flag (salesUnreliable) and its manual event-type override (eventType: the key of a stored event type, or \"\" for automatic classification from the event name; an unknown key is stored as \"\"). Flags live in their own table so they can also be set on dates with no event registration.",
    request: eventShape.extend({
      eventType: eventTypeValue,
      salesUnreliable: z.boolean(),
    }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      const { salesUnreliable, ...rest } = args;
      const event = { ...rest, eventType: await resolveManualType(ctx, rest.eventType) };
      await db.batch([
        db
          .insert(schema.events)
          .values(event)
          .onConflictDoUpdate({
            target: schema.events.date,
            set: {
              eventName: event.eventName,
              venue: event.venue,
              prefecture: event.prefecture,
              city: event.city,
              note: event.note,
              eventType: event.eventType,
            },
          }),
        db
          .insert(schema.dayFlags)
          .values({
            date: args.date,
            salesUnreliable: salesUnreliable ? 1 : 0,
          })
          .onConflictDoUpdate({
            target: schema.dayFlags.date,
            set: {
              salesUnreliable: salesUnreliable ? 1 : 0,
            },
          }),
      ]);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  saveDayFlags: defineAction({
    description:
      "Creates or updates only the per-date flag (salesUnreliable) for one date, without touching its event registration — usable on dates that have sales but no event registered.",
    request: z.object({
      date: dateStr,
      salesUnreliable: z.boolean(),
    }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      await db
        .insert(schema.dayFlags)
        .values({
          date: args.date,
          salesUnreliable: args.salesUnreliable ? 1 : 0,
        })
        .onConflictDoUpdate({
          target: schema.dayFlags.date,
          set: {
            salesUnreliable: args.salesUnreliable ? 1 : 0,
          },
        });
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  setEventTypes: defineAction({
    description:
      "Bulk-sets the manual event-type override on many registered events at once (from the 「イベント種別を一括で設定」 section in イベント管理）: each update writes only the event_type column of that date's event registration — \"\" clears the manual setting so the type falls back to the automatic classification from the event name. Dates with no event registration are ignored; safe to run more than once.",
    request: z.object({
      updates: z
        .array(
          z.object({
            date: dateStr,
            eventType: eventTypeValue,
          }),
        )
        .min(1)
        .max(1000),
    }),
    response: z.object({ updated: z.number() }),
    handler: async (ctx, args): Promise<{ updated: number }> => {
      const db = ctx.db<typeof schema>();
      const validKeys = new Set((await loadEventTypes(ctx)).map((t) => t.key));
      const statements: BatchItem<"sqlite">[] = args.updates.map((u) =>
        db
          .update(schema.events)
          .set({ eventType: validKeys.has(u.eventType) ? u.eventType : "" })
          .where(eq(schema.events.date, u.date)),
      );
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { updated: args.updates.length };
    },
  }),

  getEventTypes: defineAction({
    description:
      "Returns the user-editable event-type list in order (key, label, automatic-classification keywords). 「その他」(key \"other\") always comes first — it is the locked, keyword-less fallback type. Until the one-time seed has run, the eleven built-in types are returned so classification and labels behave exactly as seeded.",
    request: z.object({}),
    response: z.object({ types: z.array(eventTypeDefShape) }),
    handler: async (ctx): Promise<{ types: StoredEventType[] }> => {
      return { types: await loadEventTypes(ctx) };
    },
  }),

  seedEventTypes: defineAction({
    description:
      "One-time seed: inserts the eleven built-in event types (その他 — pinned first as the keyword-less fallback — plus コミックマーケット／コミティア系／デザインフェスタ／文学フリマ系／ZINEフェス／COMIC CITY系／サンシャインクリエイション／おもバザ／例大祭・東方系／技術書典， with their classification keywords) only when the event_types table is completely empty. Never overwrites a list the user has edited; safe to run more than once.",
    request: z.object({}),
    response: z.object({ seeded: z.boolean() }),
    handler: async (ctx): Promise<{ seeded: boolean }> => {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.eventTypes);
      if ((existing[0]?.n ?? 0) > 0) return { seeded: false };
      const statements: BatchItem<"sqlite">[] = DEFAULT_EVENT_TYPES.map((t, i) =>
        db.insert(schema.eventTypes).values({
          key: t.key,
          label: t.label,
          keywords: t.keywords,
          sortOrder: i,
        }),
      );
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { seeded: true };
    },
  }),

  saveEventTypes: defineAction({
    description:
      "Replaces the whole event-type list with the submitted one (from 「イベント種別の管理」 in イベント管理）: order in the array becomes the classification priority / display order. Items whose key names an existing type keep that key (label and keywords are updated); items with a null or unknown key are new types and get a generated key. Types missing from the submission are deleted, and events whose manual type named a deleted type are reset to \"\" (automatic classification). Saving an empty list stores a marker row so the built-in defaults are not resurrected. Exception: 「その他」(key \"other\") is locked — it is forced to the front of the saved list with its keywords cleared (and restored from the stored list when the submission omits it), so it can never be deleted, moved down, or gain classification priority over the other types' keywords.",
    request: z.object({
      types: z
        .array(
          z.object({
            key: z.string().max(100).nullable(),
            label: z.string().min(1).max(100),
            keywords: z.array(z.string().min(1).max(100)).max(50),
          }),
        )
        .max(100),
    }),
    response: z.object({ types: z.array(eventTypeDefShape) }),
    handler: async (ctx, args): Promise<{ types: StoredEventType[] }> => {
      const db = ctx.db<typeof schema>();
      // The keys the user could legitimately be keeping: the stored
      // ones, or the built-in defaults when the seed has not run yet
      // (the client edited the fallback list it was shown).
      const existingTypes = await loadEventTypes(ctx);
      const existingKeys = new Set(existingTypes.map((t) => t.key));
      const usedKeys = new Set<string>();
      let counter = 0;
      const final: StoredEventType[] = args.types.map((t) => {
        let key =
          t.key !== null && existingKeys.has(t.key) && !usedKeys.has(t.key)
            ? t.key
            : null;
        if (key === null) {
          do {
            counter += 1;
            key = `custom-${Date.now().toString(36)}-${counter}`;
          } while (usedKeys.has(key) || existingKeys.has(key));
        }
        usedKeys.add(key);
        // Dedupe keywords, preserving first occurrence.
        const keywords = [...new Set(t.keywords.map((k) => k.trim()).filter(Boolean))];
        return { key, label: t.label, keywords };
      });
      // 「その他」 (key "other") is locked: it always exists, always
      // sits at the front of the saved list, and never carries
      // keywords — whatever the submission did with it (moved it,
      // gave it keywords, or omitted it entirely). That keeps it
      // the keyword-less fallback: its top position is display-only
      // and gives it no priority in the classification walk. When
      // the submission omits it, the stored row (or the built-in
      // default label) is restored.
      const otherIdx = final.findIndex((t) => t.key === "other");
      if (otherIdx >= 0) {
        const [found] = final.splice(otherIdx, 1);
        final.unshift({
          key: "other",
          label: found?.label ?? "その他",
          keywords: [],
        });
      } else {
        const prev = existingTypes.find((t) => t.key === "other");
        final.unshift({
          key: "other",
          label: prev?.label ?? "その他",
          keywords: [],
        });
        usedKeys.add("other");
      }
      const removedKeys = [...existingKeys].filter((k) => !usedKeys.has(k));

      const statements: BatchItem<"sqlite">[] = [];
      // Events manually set to a deleted type fall back to automatic.
      for (const key of removedKeys) {
        statements.push(
          db
            .update(schema.events)
            .set({ eventType: "" })
            .where(eq(schema.events.eventType, key)),
        );
      }
      statements.push(db.delete(schema.eventTypes));
      if (final.length === 0) {
        statements.push(
          db.insert(schema.eventTypes).values({
            key: EVENT_TYPES_EMPTIED_KEY,
            label: "",
            keywords: "",
            sortOrder: 0,
          }),
        );
      } else {
        final.forEach((t, i) => {
          statements.push(
            db.insert(schema.eventTypes).values({
              key: t.key,
              label: t.label,
              keywords: t.keywords.join(","),
              sortOrder: i,
            }),
          );
        });
      }
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { types: final };
    },
  }),

  deleteEvent: defineAction({
    description: "Removes the event registration for one date (sales rows are kept).",
    request: z.object({ date: dateStr }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.events).where(eq(schema.events.date, args.date));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteSalesDay: defineAction({
    description:
      "Deletes one sales day entirely: all of its sales rows, plus its event registration, per-date flags, inventory memo, and 参加前確認 (event_prep), so the date disappears from the ledger. Used to remove stray ¥0 days left over from Square exports.",
    request: z.object({ date: dateStr }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      await db.batch([
        db.delete(schema.sales).where(eq(schema.sales.date, args.date)),
        db.delete(schema.events).where(eq(schema.events.date, args.date)),
        db.delete(schema.dayFlags).where(eq(schema.dayFlags.date, args.date)),
        db
          .delete(schema.inventoryItems)
          .where(eq(schema.inventoryItems.date, args.date)),
        db
          .delete(schema.inventoryMemos)
          .where(eq(schema.inventoryMemos.date, args.date)),
        db
          .delete(schema.eventPrep)
          .where(eq(schema.eventPrep.date, args.date)),
      ]);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  saveSalesRow: defineAction({
    description:
      "Adds or updates one manual sales row (date x product) from the in-app sales editor: the product must already be a registered product — one that has sales rows somewhere, one registered by hand via createProduct (no sales yet), or a merged-away alias of either; qty and net are stored as entered, gross mirrors net (no discount split is known for manual entries), and tx is preserved on update / 0 on insert. A first manual row for a sales-less registered product takes the category registered for it. The row's 完売 (soldOut) flag — that day the copies brought ran out — is stored as given; Square CSV re-imports never overwrite it. Works on dates with no sales and no event registration too. The 『任意の金額』 lump-sum entry is not a product and cannot be added this way (its existing rows can still be edited or deleted).",
    request: z.object({
      date: dateStr,
      product: z.string().min(1).max(300),
      qty: z.number().finite().min(-100000).max(100000),
      net: z.number().int().min(-100000000).max(100000000),
      soldOut: z.boolean(),
    }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      // A merged-away old name lands on its canonical product, the
      // same rule importSales applies, so a manual row can never
      // resurrect an old name either.
      const aliasMap = await loadAliasMap(ctx);
      const product = resolveAlias(aliasMap, args.product);
      const existing = await db
        .select()
        .from(schema.sales)
        .where(
          and(eq(schema.sales.date, args.date), eq(schema.sales.product, product)),
        );
      const cur = existing[0];
      if (!cur) {
        // New row: only already-registered products may be added —
        // registered means sales rows somewhere OR a hand registration
        // (a product_releases row from createProduct). Brand-new
        // products are created through the 新規登録 form, not here,
        // and the lump-sum entry is not a product at all.
        if (product === LUMP_SUM_PRODUCT) {
          throw new Error(
            "『任意の金額』は頒布物ではないため、ここからは追加できません",
          );
        }
        const known = await db
          .select({ category: schema.sales.category })
          .from(schema.sales)
          .where(eq(schema.sales.product, product));
        const registered = await db
          .select({ category: schema.productReleases.category })
          .from(schema.productReleases)
          .where(eq(schema.productReleases.product, product));
        if (known.length === 0 && registered.length === 0) {
          throw new Error("登録済みの頒布物から選んでください");
        }
        const category =
          known.find((k) => k.category !== "")?.category ??
          registered[0]?.category ??
          "";
        await db.insert(schema.sales).values({
          date: args.date,
          product,
          category,
          qty: args.qty,
          gross: args.net,
          net: args.net,
          tx: 0,
          soldOut: args.soldOut ? 1 : 0,
        });
      } else {
        await db
          .update(schema.sales)
          .set({
            qty: args.qty,
            gross: args.net,
            net: args.net,
            soldOut: args.soldOut ? 1 : 0,
          })
          .where(eq(schema.sales.id, cur.id));
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteSalesRow: defineAction({
    description:
      "Deletes one sales row (date x product) from the in-app sales editor. Only that row is removed; the day's event registration and flags are kept.",
    request: z.object({ date: dateStr, product: z.string().min(1).max(300) }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.sales)
        .where(
          and(
            eq(schema.sales.date, args.date),
            eq(schema.sales.product, args.product),
          ),
        );
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  importEvents: defineAction({
    description:
      "Bulk upserts event registrations parsed from an event CSV (date,event_name,venue,prefecture,city,note). Rows may additionally carry the two backup columns this app's own data export writes — eventType (manual event-type override key) and salesUnreliable (per-date 「売り上げは参考情報」 flag): when a row carries one of them it is restored too (the type key is validated against the stored type list, unknown keys fall back to automatic); when a row omits them, the stored type / flag for that date is left untouched.",
    request: z.object({
      events: z
        .array(
          eventShape.extend({
            eventType: eventTypeValue.optional(),
            salesUnreliable: z.boolean().optional(),
          }),
        )
        .max(2000),
    }),
    response: z.object({ imported: z.number() }),
    handler: async (ctx, args) => {
      const db = ctx.db<typeof schema>();
      if (args.events.length === 0) return { imported: 0 };
      // Validate the distinct manual type keys once.
      const typeCache = new Map<string, string>();
      for (const e of args.events) {
        if (e.eventType !== undefined && !typeCache.has(e.eventType)) {
          typeCache.set(e.eventType, await resolveManualType(ctx, e.eventType));
        }
      }
      const statements: BatchItem<"sqlite">[] = [];
      for (const e of args.events) {
        const base = {
          date: e.date,
          eventName: e.eventName,
          venue: e.venue,
          prefecture: e.prefecture,
          city: e.city,
          note: e.note,
        };
        const set: {
          eventName: string;
          venue: string;
          prefecture: string;
          city: string;
          note: string;
          eventType?: string;
        } = {
          eventName: e.eventName,
          venue: e.venue,
          prefecture: e.prefecture,
          city: e.city,
          note: e.note,
        };
        const values: typeof base & { eventType: string } = {
          ...base,
          eventType: "",
        };
        if (e.eventType !== undefined) {
          const resolvedType = typeCache.get(e.eventType) ?? "";
          values.eventType = resolvedType;
          set.eventType = resolvedType;
        }
        statements.push(
          db
            .insert(schema.events)
            .values(values)
            .onConflictDoUpdate({ target: schema.events.date, set }),
        );
        if (e.salesUnreliable !== undefined) {
          statements.push(
            db
              .insert(schema.dayFlags)
              .values({
                date: e.date,
                salesUnreliable: e.salesUnreliable ? 1 : 0,
              })
              .onConflictDoUpdate({
                target: schema.dayFlags.date,
                set: { salesUnreliable: e.salesUnreliable ? 1 : 0 },
              }),
          );
        }
      }
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { imported: args.events.length };
    },
  }),

  importProductSettings: defineAction({
    description:
      "Restores product settings from this app's own 頒布物設定 CSV export (product, category, release_date, release_basis, discontinued, sales_unreliable): each row upserts the product's registration row wholesale and rewrites its sales rows' category to the row's category, so a backup restores both sales-less registrations and the settings of products with sales. Names are resolved through the merge alias table like sales imports, so a row written under an old name lands on its canonical product. The 『任意の金額』 lump-sum entry is not a product and its rows are skipped (reported in `skipped`), as are rows with an invalid release date. No sales rows are ever created by this action.",
    request: z.object({
      products: z
        .array(
          z.object({
            product: z.string().min(1).max(300),
            category: z.string().max(100),
            releaseDate: z.string().max(10),
            releaseBasis: z.string().max(1000),
            discontinued: z.boolean(),
            salesUnreliable: z.boolean(),
          }),
        )
        .max(2000),
    }),
    response: z.object({ imported: z.number(), skipped: z.array(z.string()) }),
    handler: async (
      ctx,
      args,
    ): Promise<{ imported: number; skipped: string[] }> => {
      const db = ctx.db<typeof schema>();
      const aliasMap = await loadAliasMap(ctx);
      const statements: BatchItem<"sqlite">[] = [];
      const skipped: string[] = [];
      let imported = 0;
      for (const row of args.products) {
        const rawName = row.product.trim();
        if (!rawName || rawName === LUMP_SUM_PRODUCT) {
          if (rawName) skipped.push(rawName);
          continue;
        }
        if (row.releaseDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(row.releaseDate)) {
          skipped.push(rawName);
          continue;
        }
        const product = resolveAlias(aliasMap, rawName);
        const category = normalizeCategory(row.category.trim());
        statements.push(
          db
            .insert(schema.productReleases)
            .values({
              product,
              releaseDate: row.releaseDate,
              releaseBasis: row.releaseBasis,
              discontinued: row.discontinued ? 1 : 0,
              salesUnreliable: row.salesUnreliable ? 1 : 0,
              category,
            })
            .onConflictDoUpdate({
              target: schema.productReleases.product,
              set: {
                releaseDate: row.releaseDate,
                releaseBasis: row.releaseBasis,
                discontinued: row.discontinued ? 1 : 0,
                salesUnreliable: row.salesUnreliable ? 1 : 0,
                category,
              },
            }),
        );
        statements.push(
          db
            .update(schema.sales)
            .set({ category })
            .where(eq(schema.sales.product, product)),
        );
        imported += 1;
      }
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { imported, skipped };
    },
  }),

  listEvents: defineAction({
    description: "Returns all registered events, by date ascending (used for CSV export).",
    request: z.object({}),
    response: z.object({ events: z.array(eventShape) }),
    handler: async (ctx) => {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.events).orderBy(asc(schema.events.date));
      return { events: rows };
    },
  }),

  getExportData: defineAction({
    description:
      "Returns everything the user entered, for the データのエクスポート CSV downloads (backup / migration): all sales rows (date x product, net amount and the hand-recorded 完売 flag), all event registrations with their manual event-type override and per-date 「売り上げは参考情報」 flag, all inventory memos with their per-product sent counts, and every product's settings (effective category, release date / basis, 廃盤 and 除外 flags) — including hand-registered products with no sales, whose settings exist nowhere else. The 『任意の金額』 lump-sum entry is not a product and is left out of the product settings. Read-only. No personal data exists in this ledger, so none is returned.",
    request: z.object({}),
    response: z.object({
      sales: z.array(
        z.object({
          date: z.string(),
          product: z.string(),
          category: z.string(),
          qty: z.number(),
          net: z.number(),
          soldOut: z.boolean(),
        }),
      ),
      products: z.array(
        z.object({
          product: z.string(),
          category: z.string(),
          releaseDate: z.string(),
          releaseBasis: z.string(),
          discontinued: z.boolean(),
          salesUnreliable: z.boolean(),
        }),
      ),
      events: z.array(
        eventShape.extend({
          eventType: z.string(),
          salesUnreliable: z.boolean(),
        }),
      ),
      inventoryMemos: z.array(
        z.object({
          date: z.string(),
          url: z.string(),
          memo: z.string(),
          items: z.array(z.object({ product: z.string(), qty: z.number() })),
        }),
      ),
    }),
    handler: async (ctx) => {
      const db = ctx.db<typeof schema>();
      const salesRows = await db
        .select({
          date: schema.sales.date,
          product: schema.sales.product,
          category: schema.sales.category,
          qty: schema.sales.qty,
          net: schema.sales.net,
          soldOut: schema.sales.soldOut,
        })
        .from(schema.sales)
        .orderBy(asc(schema.sales.date), asc(schema.sales.product));
      const eventRows = await db
        .select()
        .from(schema.events)
        .orderBy(asc(schema.events.date));
      const flagRows = await db.select().from(schema.dayFlags);
      const flagsByDate = new Map(
        flagRows.map((f) => [f.date, f.salesUnreliable !== 0]),
      );
      const memoRows = await db
        .select()
        .from(schema.inventoryMemos)
        .orderBy(asc(schema.inventoryMemos.date));
      const itemRows = await db
        .select()
        .from(schema.inventoryItems)
        .orderBy(asc(schema.inventoryItems.product));
      const itemsByDate = new Map<string, { product: string; qty: number }[]>();
      for (const r of itemRows) {
        if (r.qty <= 0) continue;
        const list = itemsByDate.get(r.date) ?? [];
        list.push({ product: r.product, qty: r.qty });
        itemsByDate.set(r.date, list);
      }
      // Product settings for every product: the union of products
      // with sales rows and hand-registered products. The category is
      // the effective one (sales rows first, registration row as
      // fallback), matching getProducts.
      const releaseMap = await loadReleaseMap(ctx);
      const salesCategoryByProduct = new Map<string, string>();
      for (const r of salesRows) {
        if (r.category && !salesCategoryByProduct.has(r.product)) {
          salesCategoryByProduct.set(r.product, r.category);
        }
      }
      const productNames = new Set<string>([
        ...salesRows.map((r) => r.product),
        ...releaseMap.keys(),
      ]);
      productNames.delete(LUMP_SUM_PRODUCT);
      const productSettings = [...productNames]
        .sort((a, b) => a.localeCompare(b, "ja"))
        .map((product) => {
          const rel = releaseInfoOf(releaseMap, product);
          return {
            product,
            category:
              salesCategoryByProduct.get(product) ??
              releaseMap.get(product)?.category ??
              "",
            releaseDate: rel.releaseDate ?? "",
            releaseBasis: rel.releaseBasis,
            discontinued: rel.discontinued,
            salesUnreliable: rel.salesUnreliable,
          };
        });
      return {
        products: productSettings,
        sales: salesRows.map((r) => ({ ...r, soldOut: r.soldOut !== 0 })),
        events: eventRows.map((e) => ({
          date: e.date,
          eventName: e.eventName,
          venue: e.venue,
          prefecture: e.prefecture,
          city: e.city,
          note: e.note,
          eventType: e.eventType,
          salesUnreliable: flagsByDate.get(e.date) ?? false,
        })),
        inventoryMemos: memoRows.map((m) => ({
          date: m.date,
          url: m.url,
          memo: m.memo,
          items: itemsByDate.get(m.date) ?? [],
        })),
      };
    },
  }),

  resetAllData: defineAction({
    description:
      "Deletes ALL user-entered data and returns the ledger to its initial state: sales, event registrations, per-date flags, product release info (release dates / 廃盤 / product-level reference flags — this table also holds hand-registered products and their categories, so sales-less registrations are wiped too), product aliases, product merge history, inventory memos (headers + items), and 参加前確認 (event_prep). The standard event master list (master_events, reference-only candidates) and the event-type definitions are NOT user-entered records and are kept. Requires confirm: true — the client gates this behind a two-step confirmation dialog.",
    request: z.object({ confirm: z.literal(true) }),
    response: z.object({
      sales: z.number(),
      events: z.number(),
      inventoryMemos: z.number(),
    }),
    handler: async (ctx) => {
      const db = ctx.db<typeof schema>();
      const salesCount = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.sales);
      const eventsCount = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.events);
      const memosCount = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.inventoryMemos);
      const counts = {
        sales: salesCount[0]?.n ?? 0,
        events: eventsCount[0]?.n ?? 0,
        inventoryMemos: memosCount[0]?.n ?? 0,
      };
      await db.batch([
        db.delete(schema.sales),
        db.delete(schema.events),
        db.delete(schema.dayFlags),
        db.delete(schema.productReleases),
        db.delete(schema.productAliases),
        db.delete(schema.productMerges),
        db.delete(schema.inventoryItems),
        db.delete(schema.inventoryMemos),
        db.delete(schema.eventPrep),
      ]);
      ctx.invalidateQueries();
      return counts;
    },
  }),

  insertDummyData: defineAction({
    description:
      "Inserts the test dummy dataset: 4 days of sales for 3 clearly-labelled 【ダミー】 products (varied quantities and amounts, one 完売 row) with matching 【ダミー】 event registrations in 4 different prefectures, plus release info for the dummy products. Dates come from a fixed candidate list, skipping any date that already has sales or an event registration, so dummy rows land on their own days. Does nothing (inserted: false, alreadyPresent: true) when dummy sales are already in the ledger. All dummy rows are ordinary user data — resetAllData wipes them.",
    request: z.object({}),
    response: z.object({
      inserted: z.boolean(),
      alreadyPresent: z.boolean(),
      days: z.number(),
      rows: z.number(),
    }),
    handler: async (ctx) => {
      const db = ctx.db<typeof schema>();
      const existingDummy = await db
        .select({ product: schema.sales.product })
        .from(schema.sales)
        .where(sql`${schema.sales.product} like ${DUMMY_PRODUCT_PREFIX + "%"}`);
      if (existingDummy.length > 0) {
        return { inserted: false, alreadyPresent: true, days: 0, rows: 0 };
      }
      const salesDates = await db
        .select({ date: schema.sales.date })
        .from(schema.sales);
      const eventDates = await db
        .select({ date: schema.events.date })
        .from(schema.events);
      const occupied = new Set([
        ...salesDates.map((r) => r.date),
        ...eventDates.map((r) => r.date),
      ]);
      const days = DUMMY_CANDIDATE_DATES.filter((d) => !occupied.has(d)).slice(
        0,
        DUMMY_QTY.length,
      );
      if (days.length < 3) {
        // Too few free candidate days left to make a useful dataset.
        return { inserted: false, alreadyPresent: false, days: 0, rows: 0 };
      }
      const statements: BatchItem<"sqlite">[] = [];
      let rowCount = 0;
      days.forEach((date, i) => {
        const place = DUMMY_PLACES[i % DUMMY_PLACES.length] ?? DUMMY_PLACES[0];
        statements.push(
          db.insert(schema.events).values({
            date,
            eventName: `【ダミー】テストイベント${i + 1}`,
            venue: "ダミー会場",
            prefecture: place?.prefecture ?? "",
            city: place?.city ?? "",
            note: "表示確認用のダミーデータです",
            eventType: "",
          }),
        );
        DUMMY_PRODUCTS.forEach((p, j) => {
          const qty = DUMMY_QTY[i]?.[j] ?? 0;
          if (qty <= 0) return;
          const amount = qty * p.price;
          rowCount++;
          statements.push(
            db.insert(schema.sales).values({
              date,
              product: p.product,
              category: p.category,
              qty,
              gross: amount,
              net: amount,
              tx: qty,
              // One sold-out row (first day, first product) so the
              // 完売 display can be checked too.
              soldOut: i === 0 && j === 0 ? 1 : 0,
            }),
          );
        });
      });
      const firstDate = days[0];
      if (firstDate) {
        for (const p of DUMMY_PRODUCTS) {
          statements.push(
            db
              .insert(schema.productReleases)
              .values({
                product: p.product,
                releaseDate: firstDate,
                releaseBasis: "ダミーデータ（表示確認用）",
                discontinued: 0,
                salesUnreliable: 0,
              })
              .onConflictDoNothing(),
          );
        }
      }
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return {
        inserted: true,
        alreadyPresent: false,
        days: days.length,
        rows: rowCount,
      };
    },
  }),

  seedMasterEvents: defineAction({
    description:
      "One-time seed: inserts the standard event master list (1,306 rows prepared from events-master.csv) into the reference-only master_events table, only when that table is empty. Master rows are candidates for the event form — they are never written into the events (participation) table and never overwrite a user registration; safe to run more than once.",
    request: z.object({}),
    response: z.object({ seeded: z.boolean(), rows: z.number() }),
    handler: async (ctx): Promise<{ seeded: boolean; rows: number }> => {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.masterEvents);
      if ((existing[0]?.n ?? 0) > 0) return { seeded: false, rows: 0 };
      const statements: BatchItem<"sqlite">[] = SEED_MASTER_EVENTS.map((r) =>
        db.insert(schema.masterEvents).values(r),
      );
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      return { seeded: true, rows: SEED_MASTER_EVENTS.length };
    },
  }),

  getMasterEvents: defineAction({
    description:
      "Returns the whole standard event master list (reference-only candidates), by date then id ascending. Several rows may share one date; the client groups them per date and lets the user pick — nothing is auto-selected. Master data never affects participation counts or registrations.",
    request: z.object({}),
    response: z.object({ events: z.array(eventShape) }),
    handler: async (ctx) => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select({
          date: schema.masterEvents.date,
          eventName: schema.masterEvents.eventName,
          venue: schema.masterEvents.venue,
          prefecture: schema.masterEvents.prefecture,
          city: schema.masterEvents.city,
          note: schema.masterEvents.note,
        })
        .from(schema.masterEvents)
        .orderBy(asc(schema.masterEvents.date), asc(schema.masterEvents.id));
      return { events: rows };
    },
  }),

  replaceMasterEvents: defineAction({
    description:
      "Replaces the standard event master list wholesale with the rows parsed from an updated master CSV (date,event_name,venue,prefecture,city,note) — delete-all then insert, in one batch. Reference-only: the events (participation) table and every count derived from it are untouched.",
    request: z.object({ events: z.array(eventShape).max(5000) }),
    response: z.object({ replaced: z.number() }),
    handler: async (ctx, args) => {
      const db = ctx.db<typeof schema>();
      const statements: BatchItem<"sqlite">[] = [
        db.delete(schema.masterEvents),
        ...args.events.map((e) => db.insert(schema.masterEvents).values(e)),
      ];
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { replaced: args.events.length };
    },
  }),

  replaceMasterEventsFromSeed: defineAction({
    description:
      "Replaces the standard event master list wholesale with the bundled seed (1,306 rows from the GitHub-published events-master.csv v1.1.1, including the 【中止】 cancelled editions, the 【延期】 postponed ZINEフェス沖縄， デザインフェスタ vol.65, and the completed ZINEフェス block) — delete-all then insert, in one batch. Used when a revised master CSV has been folded into the seed. Reference-only: the events (participation) table and every count derived from it are untouched.",
    request: z.object({}),
    response: z.object({ replaced: z.number() }),
    handler: async (ctx): Promise<{ replaced: number }> => {
      const db = ctx.db<typeof schema>();
      const statements: BatchItem<"sqlite">[] = [
        db.delete(schema.masterEvents),
        ...SEED_MASTER_EVENTS.map((r) => db.insert(schema.masterEvents).values(r)),
      ];
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { replaced: SEED_MASTER_EVENTS.length };
    },
  }),

  importSales: defineAction({
    description:
      "Merges sales aggregates (date x product, parsed and privacy-stripped in the browser) into the ledger, replacing rows for the same date+product. The hand-recorded 完売 (soldOut) flag on a replaced row is preserved when the import rows carry no sold-out information (Square / 即売レジ imports); rows that do carry it — only a 手記録CSV written by this app's data export, via its 完売 column — restore the flag. A category of 「なし」 (Square's placeholder for no category) is stored as an empty category.",
    request: z.object({ rows: z.array(saleImportRowShape).max(5000) }),
    response: z.object({ imported: z.number(), dates: z.number() }),
    handler: async (ctx, args) => {
      const db = ctx.db<typeof schema>();
      if (args.rows.length === 0) return { imported: 0, dates: 0 };
      // Names merged away in a product merge land on the canonical
      // product, so re-importing an old Square export cannot resurrect
      // the old name. Rows that collide after resolution are summed by
      // the caller-side aggregation key, so resolve first, then merge
      // any (date, product) duplicates created by the mapping.
      const aliasMap = await loadAliasMap(ctx);
      const resolved = new Map<string, z.infer<typeof saleImportRowShape>>();
      for (const r of args.rows) {
        const mapped = {
          ...r,
          product: resolveAlias(aliasMap, r.product),
          category: normalizeCategory(r.category),
        };
        const key = `${mapped.date}|${mapped.product}`;
        const cur = resolved.get(key);
        if (cur) {
          cur.qty += mapped.qty;
          cur.gross += mapped.gross;
          cur.net += mapped.net;
          cur.tx += mapped.tx;
          if (!cur.category && mapped.category) cur.category = mapped.category;
          // A merged duplicate counts as sold out when any of its
          // source rows says so; rows without the information leave
          // the merged value alone.
          if (cur.soldOut === undefined) cur.soldOut = mapped.soldOut;
          else if (mapped.soldOut) cur.soldOut = true;
        } else {
          resolved.set(key, mapped);
        }
      }
      const rows = [...resolved.values()];
      const statements: BatchItem<"sqlite">[] = rows.map((r) => {
        const set: {
          category: string;
          qty: number;
          gross: number;
          net: number;
          tx: number;
          soldOut?: number;
        } = {
          category: r.category,
          qty: r.qty,
          gross: r.gross,
          net: r.net,
          tx: r.tx,
        };
        const values: {
          date: string;
          product: string;
          category: string;
          qty: number;
          gross: number;
          net: number;
          tx: number;
          soldOut?: number;
        } = {
          date: r.date,
          product: r.product,
          category: r.category,
          qty: r.qty,
          gross: r.gross,
          net: r.net,
          tx: r.tx,
        };
        // Only rows that carry sold-out information (a restored
        // 手記録CSV backup) write the flag; every other import
        // leaves the stored value untouched on replace.
        if (r.soldOut !== undefined) {
          values.soldOut = r.soldOut ? 1 : 0;
          set.soldOut = r.soldOut ? 1 : 0;
        }
        return db
          .insert(schema.sales)
          .values(values)
          .onConflictDoUpdate({
            target: [schema.sales.date, schema.sales.product],
            set,
          });
      });
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return {
        imported: rows.length,
        dates: new Set(rows.map((r) => r.date)).size,
      };
    },
  }),

  getCities: defineAction({
    description:
      "Aggregates sales by registered prefecture + city (unregistered dates grouped separately), with per-city event days.",
    request: z.object({}),
    response: z.object({
      cities: z.array(
        z.object({
          key: z.string(),
          prefecture: z.string(),
          city: z.string(),
          net: z.number(),
          qty: z.number(),
          days: z.array(daySummaryShape),
        }),
      ),
      unregistered: z.object({
        net: z.number(),
        qty: z.number(),
        days: z.array(daySummaryShape),
      }),
    }),
    handler: async (ctx) => {
      const days = await loadDaySummaries(ctx);
      const groups = new Map<
        string,
        { prefecture: string; city: string; net: number; qty: number; days: DaySummary[] }
      >();
      const unreg: DaySummary[] = [];
      let unregNet = 0;
      let unregQty = 0;
      for (const d of days) {
        if (d.eventName === null || (!d.prefecture && !d.city)) {
          unreg.push(d);
          unregNet += d.net;
          unregQty += d.qty;
          continue;
        }
        const pref = d.prefecture ?? "";
        const city = d.city ?? "";
        const key = `${pref} ${city}`;
        const g = groups.get(key) ?? { prefecture: pref, city, net: 0, qty: 0, days: [] };
        g.net += d.net;
        g.qty += d.qty;
        g.days.push(d);
        groups.set(key, g);
      }
      return {
        cities: [...groups.entries()]
          .map(([key, g]) => ({ key, ...g }))
          .sort((a, b) => b.net - a.net),
        unregistered: { net: unregNet, qty: unregQty, days: unreg },
      };
    },
  }),

  getTypeBreakdownDays: defineAction({
    description:
      "Returns every sales day joined with its event info and flags (day-level totals only) — the raw material for the dashboard's イベント種別別 breakdown, which classifies each day by event type and aggregates its net / qty / day counts.",
    request: z.object({}),
    response: z.object({
      days: z.array(daySummaryShape),
    }),
    handler: async (ctx) => {
      const days = await loadDaySummaries(ctx);
      return { days };
    },
  }),

  getProducts: defineAction({
    description:
      "Lists every product with lifetime totals and a per-date breakdown joined with event/city info. Products registered by hand that have no sales yet are included too, with zero totals, an empty breakdown, and empty firstDate / lastDate; their category comes from the registration row (for products with sales, the sales rows' category wins, with the registration row as fallback). The 『任意の金額』 lump-sum entry is not a product and is excluded.",
    request: z.object({}),
    response: z.object({
      products: z.array(
        z.object({
          product: z.string(),
          category: z.string(),
          qty: z.number(),
          net: z.number(),
          dayCount: z.number(),
          firstDate: z.string(),
          lastDate: z.string(),
          releaseDate: z.string().nullable(),
          releaseBasis: z.string(),
          discontinued: z.boolean(),
          salesUnreliable: z.boolean(),
          totalAppearances: z.number(),
          byDate: z.array(
            z.object({
              date: z.string(),
              qty: z.number(),
              net: z.number(),
              eventName: z.string().nullable(),
              // Manual event-type override for that date's event, or
              // null when unset (type markers resolve manual-first).
              eventType: z.string().nullable(),
              venue: z.string().nullable(),
              prefecture: z.string().nullable(),
              city: z.string().nullable(),
              appearanceNo: z.number().nullable(),
              isFirstAppearance: z.boolean(),
              daysSinceRelease: z.number().nullable(),
              salesUnreliable: z.boolean(),
              // 完売： the copies brought sold out that day.
              soldOut: z.boolean(),
            }),
          ),
        }),
      ),
    }),
    handler: async (ctx) => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.sales)
        .orderBy(asc(schema.sales.date));
      const evts = await db.select().from(schema.events);
      const evByDate = new Map(evts.map((e) => [e.date, e]));
      const flagRows = await db.select().from(schema.dayFlags);
      const flagsByDate = new Map(flagRows.map((f) => [f.date, f]));
      const appearances = await loadAppearances(ctx);
      const releaseMap = await loadReleaseMap(ctx);
      interface Acc {
        product: string;
        category: string;
        qty: number;
        net: number;
        dates: Set<string>;
        firstDate: string;
        lastDate: string;
        byDate: {
          date: string;
          qty: number;
          net: number;
          eventName: string | null;
          eventType: string | null;
          venue: string | null;
          prefecture: string | null;
          city: string | null;
          appearanceNo: number | null;
          isFirstAppearance: boolean;
          daysSinceRelease: number | null;
          salesUnreliable: boolean;
          soldOut: boolean;
        }[];
      }
      const map = new Map<string, Acc>();
      for (const r of rows) {
        // 『任意の金額』 is a lump-sum entry, not a book — it never
        // appears in the product list (its sales still count in the
        // day / grand totals served by the other actions).
        if (r.product === LUMP_SUM_PRODUCT) continue;
        let acc = map.get(r.product);
        if (!acc) {
          acc = {
            product: r.product,
            category: r.category,
            qty: 0,
            net: 0,
            dates: new Set<string>(),
            firstDate: r.date,
            lastDate: r.date,
            byDate: [],
          };
          map.set(r.product, acc);
        }
        if (r.category && acc.category === "") acc.category = r.category;
        acc.qty += r.qty;
        acc.net += r.net;
        acc.dates.add(r.date);
        if (r.date < acc.firstDate) acc.firstDate = r.date;
        if (r.date > acc.lastDate) acc.lastDate = r.date;
        const e = evByDate.get(r.date);
        const rel = releaseInfoOf(releaseMap, r.product);
        const app = appearances.info(r.product, r.date);
        acc.byDate.push({
          date: r.date,
          qty: r.qty,
          net: r.net,
          eventName: e ? e.eventName : null,
          eventType: e && e.eventType ? e.eventType : null,
          venue: e ? e.venue : null,
          prefecture: e ? e.prefecture : null,
          city: e ? e.city : null,
          appearanceNo: app.appearanceNo,
          isFirstAppearance: app.isFirstAppearance,
          daysSinceRelease: daysSinceRelease(rel.releaseDate, r.date),
          salesUnreliable: (flagsByDate.get(r.date)?.salesUnreliable ?? 0) !== 0,
          soldOut: r.soldOut !== 0,
        });
      }
      // Hand-registered products with no sales rows yet: they exist
      // only as a product_releases row, and join the list with zero
      // totals and no sales history.
      for (const [product, rel] of releaseMap) {
        if (product === LUMP_SUM_PRODUCT || map.has(product)) continue;
        map.set(product, {
          product,
          category: rel.category,
          qty: 0,
          net: 0,
          dates: new Set<string>(),
          firstDate: "",
          lastDate: "",
          byDate: [],
        });
      }
      return {
        products: [...map.values()]
          .map((a) => {
            const rel = releaseInfoOf(releaseMap, a.product);
            return {
              product: a.product,
              // Sales rows carry the category; the registration row is
              // the fallback (and the only store before any sale).
              category: a.category || releaseMap.get(a.product)?.category || "",
              qty: a.qty,
              net: a.net,
              dayCount: a.dates.size,
              firstDate: a.firstDate,
              lastDate: a.lastDate,
              releaseDate: rel.releaseDate,
              releaseBasis: rel.releaseBasis,
              discontinued: rel.discontinued,
              salesUnreliable: rel.salesUnreliable,
              totalAppearances:
                a.firstDate === ""
                  ? 0
                  : appearances.info(a.product, a.firstDate).totalAppearances,
              byDate: a.byDate.sort((x, y) => y.date.localeCompare(x.date)),
            };
          })
          .sort((a, b) => b.qty - a.qty),
      };
    },
  }),
} satisfies ActionsModule;
