import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
Bar,
BarChart,
Cell,
ResponsiveContainer,
Tooltip,
XAxis,
YAxis,
} from "recharts";
import { api } from "./api";
import { DayRow } from "./Ledger";
import { withViewTransition } from "./transitions";
import { PlaceFilter, orderPrefectures, prefectureCounts } from "./PlaceFilter";
import { matchesPlaceName } from "./search";
import { dateLabel, qtyMasked, yen, yenMasked } from "./format";
import { useMasked } from "./mask";

export function CitiesView() {
  const masked = useMasked();
  const cities = useQuery({ queryKey: ["cities"], queryFn: () => api.getCities({}) });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [pref, setPref] = useState("");
  const [cityQuery, setCityQuery] = useState("");

  const allCities = cities.data?.cities ?? [];
  const prefOptions = useMemo(
    () => orderPrefectures(allCities.map((c) => c.prefecture)),
    [allCities],
  );
  // Same participation counts as 台帳, from the grouped days.
  const prefCounts = useMemo(
    () => prefectureCounts(allCities.flatMap((c) => c.days)),
    [allCities],
  );
  const list = useMemo(
    () =>
      allCities.filter(
        (c) =>
          matchesPlaceName(pref, c.prefecture) &&
          matchesPlaceName(cityQuery, c.city),
      ),
    [allCities, pref, cityQuery],
  );

  const chartData = useMemo(
    () =>
      list.map((c) => ({
        name: c.city || c.prefecture,
        net: c.net,
      })),
    [list],
  );

  if (cities.isPending) return <p className="py-8 text-center text-sm text-[var(--dim)]">読み込み中…</p>;
  if (cities.error)
    return (
      <p role="alert" className="py-8 text-center text-sm text-[var(--accent)]">
        読み込めませんでした：{String(cities.error)}
      </p>
    );

  const { unregistered } = cities.data;

  return (
    <div>
      {allCities.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center">
          <p className="font-ledger text-base font-bold">まだ都市別の集計がありません</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--dim)]">
            各日にイベント（都道府県・市区町村）を登録すると、都市ごとに集計されます。
          </p>
        </div>
      ) : (
        <>
          <div>
            <PlaceFilter
              idPrefix="cities-search"
              prefectures={prefOptions}
              pref={pref}
              onPrefChange={setPref}
              city={cityQuery}
              onCityChange={setCityQuery}
              prefCounts={prefCounts}
            />
            <p className="tnum mt-1 text-xs text-[var(--dim)]">
              {list.length}都市（表記の揺れに対応。「（n回）」は参加回数）
            </p>
          </div>

          {list.length === 0 ? (
            <p className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-sm text-[var(--dim)]">
              検索条件に合う都市がありません。
            </p>
          ) : (
          <>
          <div
            className={`mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 ${
              masked ? "chart-blur" : ""
            }`}
            role="img"
            aria-label={
              masked
                ? "都市別売上の棒グラフ（スクショモードで数値は非表示）"
                : `都市別売上の棒グラフ。最大は${list[0]?.city || list[0]?.prefecture}の${yen(list[0]?.net ?? 0)}`
            }
          >
            <p className="font-ledger mb-2 text-sm font-bold">都市別 売上</p>
            <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 36)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={72}
                  tick={{ fontSize: 12, fill: "var(--text)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v) => [yen(Number(v ?? 0)), "売上"]}
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="net" radius={[0, 4, 4, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? "var(--accent)" : "var(--ai)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
            {list.map((c) => {
              const open = openKey === c.key;
              return (
                <div
                  key={c.key}
                  className={`border-b border-[var(--border)] bg-[var(--surface)] last:border-b-0 ${
                    open ? "row-selected" : ""
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={`${c.prefecture}${c.city}の内訳を${open ? "閉じる" : "開く"}`}
                    onClick={() =>
                      withViewTransition(() => setOpenKey(open ? null : c.key))
                    }
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-ledger text-base font-bold">
                        {c.prefecture} {c.city}
                      </p>
                      <p className="text-xs text-[var(--dim)]">{c.days.length}日分のイベント</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tnum text-sm font-bold">{yenMasked(c.net, masked)}</p>
                      <p className="tnum text-xs text-[var(--dim)]">{qtyMasked(c.qty, masked)}冊</p>
                    </div>
                    <span
                      aria-hidden
                      className={open ? "font-bold text-[var(--accent)]" : "text-[var(--dim)]"}
                    >
                      {open ? "▲" : "▼"}
                    </span>
                  </button>
                  {open &&
                    c.days.map((d) => (
                      <DayRow
                        key={d.date}
                        day={d}
                        open={openDay === d.date}
                        onToggle={() =>
                          withViewTransition(() =>
                            setOpenDay(openDay === d.date ? null : d.date),
                          )
                        }
                      />
                    ))}
                </div>
              );
            })}
          </div>
          </>
          )}
        </>
      )}

      {unregistered.days.length > 0 && (
        <div className="mt-4 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <p className="text-sm">
            <span className="stamp mr-2">未登録</span>
            イベント未登録の日が{unregistered.days.length}日あります（売上 {yenMasked(unregistered.net, masked)}／
            {qtyMasked(unregistered.qty, masked)}冊）。
          </p>
          <ul className="tnum mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--dim)]">
            {unregistered.days.slice(0, 12).map((d) => (
              <li key={d.date}>{dateLabel(d.date)}</li>
            ))}
            {unregistered.days.length > 12 && <li>ほか{unregistered.days.length - 12}日</li>}
          </ul>
          <p className="mt-2 text-xs text-[var(--dim)]">「データ管理」タブの「イベント管理」にある「イベント未登録チェック」でまとめて確認・登録できます。</p>
        </div>
      )}
    </div>
  );
}
