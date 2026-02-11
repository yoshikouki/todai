# todai

AIエージェント前提のセルフホスト型タスク管理ツール

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- CLI UI: React Ink v6
- DB: SQLite (bun:sqlite)
- ORM: Drizzle ORM

## Commands

- `bun run start` - CLIを実行
- `bun run dev` - ウォッチモードで開発
- `bun test` - テスト実行
- `bun run db:generate` - マイグレーション生成
- `bun run db:migrate` - マイグレーション適用

## Bun Rules

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

### APIs

- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$\`ls\` instead of execa.

## Project Structure

```
src/
  index.tsx       - CLI エントリポイント
  cli/            - React Ink UI コンポーネント
  commands/       - CLI コマンド実装
  db/
    index.ts      - DB接続設定
    schema.ts     - Drizzle スキーマ定義
drizzle/          - マイグレーションファイル
drizzle.config.ts - Drizzle Kit 設定
```

## DB Schema

- `actors` - 人間・エージェントを対等に扱うアクター
- `tasks` - タスク本体（サブタスク対応）
- `task_assignments` - タスクとアクターの多対多アサイン
- `task_events` - イベント履歴（状態変更、コメント等）
- `event_triggers` - イベント駆動のコマンド実行定義
