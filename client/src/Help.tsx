/**
* 使い方 view, reached from the top-right 「使い方」 button. The
* wording is the owner's approved manuscript, reproduced verbatim —
* only the heading / bullet layout is added. Do not paraphrase,
* extend, or trim the text here without the owner's instruction:
* every screen and button name in it was checked against the app.
*/
export function HelpView() {
return (
<div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
<h2 className="font-ledger text-lg font-bold">使い方</h2>
<p className="mt-3 text-sm leading-relaxed">
このアプリは、売上データとイベント情報を日付で結び付けて、「どこのイベントで、どの本が何冊出たか」を見るための台帳です。
</p>

<h3 className="font-ledger mt-6 text-base font-bold">【1. 売上を取り込む】</h3>
<p className="mt-2 text-sm leading-relaxed">
まず売上データを入れます。右上の「売上を取り込む」から、使っている形式のCSVを選んでください。
</p>
<ul className="mt-2 grid gap-1.5 text-sm leading-relaxed">
<li>
・Square売上CSV：Squareのダッシュボード（レポート＞商品別売上）から書き出した「詳細CSV」を取り込みます。注文IDや顧客情報は読み取らず、保存もしません。
</li>
<li>
・即売レジ：「即売レジ」の販売記録CSVを取り込みます。ZIPファイルでまとめて取り込むこともできます。
</li>
<li>
・手記録CSV：「日付,頒布物名,冊数,金額,カテゴリ」の形式で自分で作ったCSVを取り込みます。テンプレートも用意してあります。
</li>
</ul>
<h3 className="font-ledger mt-6 text-base font-bold">【2. イベント情報を登録する】</h3>
<p className="mt-2 text-sm leading-relaxed">
売上だけでは「その日どこのイベントに参加したか」が分かりません。データ管理＞イベント管理からイベントを登録すると、日付で売上と結び付きます。
</p>
<ul className="mt-2 grid gap-1.5 text-sm leading-relaxed">
<li>
・1件ずつ登録：「イベントを新規登録」でイベント名（必須）・施設・都道府県・市町村を入れます。主要イベントであればその日に開かれたイベントの候補が表示されるので、選ぶとそのまま転記されます。
</li>
<li>・まとめて登録：イベント登録CSVを取り込みます。書き出しもできます。</li>
<li>
・未登録の確認：「イベント未登録チェック」に、売上はあるのにイベント未登録の日が並びます。その場で登録もできます。
</li>
</ul>
<p className="mt-2 text-sm leading-relaxed">
イベントの種別（コミティア系、文学フリマ系など）は名前から自動で判定されます。違う場合は手動で直せます。種別そのものの追加や並び替えも「イベント種別の管理」でできます。
</p>

<h3 className="font-ledger mt-6 text-base font-bold">【3. 日々の使い方】</h3>
<ul className="mt-2 grid gap-1.5 text-sm leading-relaxed">
<li>
・イベント一覧：日ごとの売上と頒布物の内訳が見られます。行を開くと、その日の詳細が出ます。
</li>
<li>
・当日の記録：このアプリはレジアプリではないためレジ機能を持っていません。リアルタイムで売上を記録するには、Squareや即売レジなどの専門のアプリをご利用ください。このアプリにレジアプリのCSVや、自前で売上を登録することで記録がつけられます。完売した本には印を付けられます。
</li>
<li>
・頒布物一覧：本ごとの発行日・カテゴリ・廃盤・除外を設定できます。名前の表記が分かれた本は統合できます。売上がない新刊も「新しい頒布物を登録」から先に登録しておけます。
</li>
</ul>

<h3 className="font-ledger mt-6 text-base font-bold">【4. 次のイベントに備える】</h3>
<p className="mt-2 text-sm leading-relaxed">
ここからがこのアプリの真価です。データを見ながら次のイベントに備えましょう。
</p>
<ul className="mt-2 grid gap-1.5 text-sm leading-relaxed">
<li>
・ダッシュボード：年別・月別の売上推移、都市別、種別別、頒布物ごとのグラフで全体を見ます。
</li>
<li>
・過去の頒布数を比較：複数のイベントの頒布冊数を並べて比べられます。「前のイベントではこのくらい出たから、次はこのくらい持っていくかな」という予測が出来ます。
</li>
<li>
・イベントメモ：イベントの参加前に公式サイトのURLや、イベントに事前送付した冊数、もしくは持ち込む予定の冊数などを付けておけます。書いた内容は自動で保存されます。
</li>
</ul>

<h3 className="font-ledger mt-6 text-base font-bold">【5. バックアップ】</h3>
<p className="mt-2 text-sm leading-relaxed">
データ管理＞総合管理の「データのエクスポート」から、売上・イベント登録・イベントメモ・頒布物設定をCSVで書き出せます。売上とイベント登録は、そのまま取り込み直して復元できます。
</p>
</div>
);
}
