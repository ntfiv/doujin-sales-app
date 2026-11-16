import { Fragment, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { DayRow, missingEventFields, type DaySummary } from "./Ledger";
import { useMasterCandidates, type MasterCandidate } from "./MasterCandidates";
import { withViewTransition } from "./transitions";

/**
 * イベント未登録チェック (イベント管理 sub-tab): a plain list of the
 * days whose event info is missing or incomplete — no status cards or
 * classification headings. Each row is the ledger's DayRow, so it
 * expands in place to the registration / edit form; unregistered days
 * carry the 「イベント未登録」 stamp and partial days show their
 * 「未入力：…」 fields on the row itself.
 *
 * Fully unregistered days that have candidates in the standard
 * event master list (標準イベント一覧) get a candidate strip under
 * the row: tapping a candidate registers it on the spot (the day's
 * existing 参考情報 flag is preserved; the candidate's 出典 note is
 * not copied into the registration). Days that already have a
 * registration never get the strip — their candidates appear as
 * reference inside the edit form instead, so nothing is overwritten
 * from here.
 */
export function UnregisteredView({ days }: { days: DaySummary[] }) {
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { candidatesFor } = useMasterCandidates();

  const targets = useMemo(
    () =>
      days.filter(
        (d) => d.eventName === null || missingEventFields(d).length > 0,
      ),
    [days],
  );

  const registerCandidate = useMutation({
    mutationFn: async (v: { day: DaySummary; candidate: MasterCandidate }) =>
      await api.saveEvent({
        date: v.day.date,
        eventName: v.candidate.eventName,
        venue: v.candidate.venue,
        prefecture: v.candidate.prefecture,
        city: v.candidate.city,
        note: "",
        eventType: "",
        salesUnreliable: v.day.salesUnreliable,
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      void queryClient.invalidateQueries({ queryKey: ["cities"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["typeBreakdownDays"] });
    },
    onError: (e) => setError(`候補を登録できませんでした：${String(e)}`),
  });

  if (targets.length === 0) {
    return (
      <p className="text-sm text-[var(--dim)]">
        すべての日にイベント情報が入っています（未登録・未入力の日はありません）。
      </p>
    );
  }

  return (
    <div>
      <p className="text-sm text-[var(--dim)]">
        イベント情報が未登録・未入力の日が{targets.length}日あります。行を開くとその場で登録・編集できます。未登録の日は、標準イベント一覧の候補があれば行の下に表示され、選ぶとそのまま登録できます。
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--accent)]">
          {error}
        </p>
      )}
      <div className="mt-2 overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
        {targets.map((d) => {
          const candidates =
            d.eventName === null ? candidatesFor(d.date) : [];
          return (
            <Fragment key={d.date}>
              <DayRow
                day={d}
                open={openDay === d.date}
                onToggle={() =>
                  withViewTransition(() => setOpenDay(openDay === d.date ? null : d.date))
                }
              />
              {candidates.length > 0 && (
                <div className="border-b border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2">
                  <p className="text-xs font-bold">
                    標準イベント一覧の候補（{candidates.length}件）
                    <span className="ml-1 font-normal text-[var(--dim)]">
                      選ぶとこの内容で登録されます
                    </span>
                  </p>
                  <ul className="mt-1.5 grid gap-1.5">
                    {candidates.map((c, i) => (
                      <li
                        key={`${c.date}-${i}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius)] bg-[var(--surface)] px-2.5 py-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{c.eventName}</span>
                          <span className="block text-xs text-[var(--dim)]">
                            {[c.venue, [c.prefecture, c.city].filter(Boolean).join(" ")]
                              .filter(Boolean)
                              .join("・")}
                            {c.note ? <span className="ml-2">{c.note}</span> : null}
                          </span>
                        </span>
                        <button
                          type="button"
                          aria-label={`候補「${c.eventName}」で登録`}
                          disabled={registerCandidate.isPending}
                          onClick={() =>
                            registerCandidate.mutate({ day: d, candidate: c })
                          }
                          className="shrink-0 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                        >
                          この候補で登録
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
