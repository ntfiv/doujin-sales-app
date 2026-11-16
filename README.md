# 同人誌売上管理（doujin-sales-app）

Muse のスペース「同人誌売上管理」のソースコードのアーカイブです。
作者: NT（ntfiv）

## これは何か

- 2026-11-17 に行った試験アップロードです。Muse / Hatch 上で作られたスペースのソースを、GitHub のプライベートリポジトリに保存できるかを試すために作成しました。
- これは **Muse / Hatch 専用ソースのアーカイブ**です。`package.json` の `@hatch/space-sdk` がローカルパス（`file:/opt/hatch/...`）依存のため、**このリポジトリを clone しても単体では動作しません**（インストール／ビルド／実行は Hatch ランタイム外ではそのままでは通りません）。

## seed データについて

- 売上・日次フラグ・頒布物の発売日の seed データは **空にしてあります**（`server/src/seed-data.ts`、`server/src/flag-seed-data.ts`、`server/src/release-seed-data.ts` はいずれも空配列）。
- 標準イベント一覧の seed（`server/src/master-seed-data.ts`、1,233件）だけは残してあります。これは公開済みのイベントマスター（ntfiv/doujin-event-master）と同系統の参照データです。

## 個人情報について

- このリポジトリには、注文ID・支払いID・顧客情報・デバイス名・カード情報・店舗名などの個人情報は **含まれません**（元のアプリでも、それらの項目は取り込まない・保存しない設計です）。
- 実データベース（app.db）、監査用スクリーンショット（audits/）なども含まれません（`.gitignore` で除外しています）。

## 構成

- `client/src/` — フロントエンド（React / TypeScript）
- `server/src/` — サーバー側アクション・スキーマ・seed
- `drizzle/` — DB マイグレーション（0001〜0014）

## スペースとして再現するには

- このソースから Muse のスペースとして再現する手順は [SPACE-REPRODUCTION-GUIDE.md](SPACE-REPRODUCTION-GUIDE.md)（「Museスペースのソース保存と再現 手順書」）にまとめています。受け取った人は、ソースを自分の Muse のワークスペースに置き、手順書のパート2の依頼文例を自分の Muse に渡してください。
