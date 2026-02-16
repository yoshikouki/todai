# Extended Status Spec

## Problem

`open/done` の2状態では、作業中・ブロック・取り下げを表現できない。
エージェントの heartbeat 判断（何を拾う/何をスキップ）に状態が足りない。

## Default Statuses

| Status | Terminal? | Meaning |
|---|---|---|
| `backlog` | no | 積まれたが未着手。すぐやる必要なし |
| `open` | no | 着手可能。heartbeat で拾う対象 |
| `in-progress` | no | 作業中。同一オーナーが継続する |
| `blocked` | no | 外部依存で停止中。スキップ対象 |
| `done` | yes | 完了 |
| `cancelled` | yes | 取り下げ |

Terminal = `task list --status open` で除外される状態。

## task add のデフォルト

`task add` で作成されたタスクの初期 status は `open`（現行互換）。

`--status backlog` を指定すれば backlog に入る。

## 遷移ルール

**遷移制約なし。** 任意の状態から任意の状態へ移動できる。

制約はプロトコル層（`protocol-spec.md`）で表現する。todai 本体は自由遷移。

理由：エージェントごとにワークフローが異なる。ツール層で制約すると例外処理が増える。

## CLI 変更

### task update

```
todai task update --id <id> --status <status>
```

`<status>` はデフォルト6種 + config.toml で定義されたカスタムステータス。
未定義の値はエラー。

### task done（維持）

```
todai task done --id <id>
```

`--status done` のショートカット。そのまま残す。

### task list

```
todai task list [--status <status>]
```

- `--status open` → terminal でないもの全て（backlog, open, in-progress, blocked）
- `--status done` → done のみ
- `--status cancelled` → cancelled のみ
- `--status in-progress` → in-progress のみ
- `--status backlog` → backlog のみ
- `--status blocked` → blocked のみ
- `--status all` → 全件
- フラグなし → `--status open` と同じ（現行互換）

## カスタムステータス

```toml
# ~/.todai/config/config.toml
[statuses]
custom = ["review", "waiting-approval"]
terminal = ["rejected"]  # カスタムの中で terminal 扱いにしたいもの
```

- デフォルト6種は常に存在。削除不可。
- custom に追加した値は `task update --status <value>` で使える。
- terminal に追加した値は `task list --status open` から除外される。

## イベント

ステータス変更時、既存の event ログに記録：

```
2026-02-12T14:00:00.000Z | status_changed | <task-id> | <owner> | open -> in-progress
```

## Protocol 連携

`protocol-spec.md` の Heartbeat ルールを以下に更新：

```
1. Run: todai task list --owner <own-owner> --status open
2. If in-progress tasks exist → resume the oldest in-progress one
3. Else if open tasks exist → pick highest-priority, oldest first
4. Skip blocked tasks (they appear in list but are deprioritized)
5. Backlog tasks are not picked up on heartbeat (manual promotion to open required)
6. If nothing actionable → HEARTBEAT_OK
```

ブロック時：
```
todai task update --id <id> --status blocked
```
descにブロック理由を書く（既存の blocked handling ルールと統合）。

## データ互換

- 既存タスクの `open` → そのまま `open`
- 既存タスクの `done` → そのまま `done`
- マイグレーション不要

## 実装の切り方

1. **この設計** → olga（本タスク）
2. **todai 本体の status 拡張** → engineer（backlog/open/in-progress/blocked/done/cancelled + config.toml カスタム + event 記録）
3. **protocol 定義の更新** → engineer（heartbeat の判断ロジック反映）
