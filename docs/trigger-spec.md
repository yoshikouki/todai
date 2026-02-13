# Event Trigger Spec

## Overview

todai のタスク操作時に、ユーザー定義スクリプトを自動実行する仕組み。
Git hooks と同じ Convention over Configuration パターンを採用する。

## ディレクトリ規約

```
~/.todai/triggers/
├── on-created                                     # 全タスク作成時
├── on-created.d/                                  # .d/ パターン（複数スクリプト）
│   ├── 00-notify.sh
│   └── 01-log.sh
├── on-done@owner=engineer                         # engineer のタスクが done になった時
├── on-done@space=todai+owner=kai                  # todai スコープの kai のタスクが done になった時
├── on-status-changed@status=open+owner=engineer   # engineer のタスクが open になった時
├── on-status-changed
├── on-status-changed.d/
├── on-done
├── on-done.d/
├── on-cancelled
├── on-cancelled.d/
├── on-updated
└── on-updated.d/
```

### 解決ルール

`TODAI_HOME` に従う: `${TODAI_HOME}/triggers/`（デフォルト `~/.todai/triggers/`）

### 実行条件

- ファイルが存在し、executable bit が立っていること（`chmod +x`）
- `.d/` ディレクトリ内のファイルは、隠しファイル（`.` prefix）とバックアップ（`~` suffix）を除外
- `.d/` 内はファイル名の辞書順で実行（`00-foo`, `01-bar` の命名を推奨）

### 単一 vs `.d/` の共存

同一イベントに対して単一スクリプトと `.d/` ディレクトリの両方が存在する場合、**両方実行する**。
実行順: 単一スクリプト → `.d/` 内のスクリプト（辞書順）。

## フィルタ規約

### 構文

ファイル名に `@` を付けてフィルタ条件を指定する。条件は `key=value` 形式で、`+` で AND 結合。

```
on-{event}@{key}={value}+{key}={value}
```

### フィルタ可能なキー

| キー | 説明 | 例 |
|---|---|---|
| `owner` | タスクオーナー | `owner=engineer` |
| `space` | スペース | `space=todai` |
| `status` | 変更後のステータス | `status=open` |
| `priority` | 優先度 | `priority=high` |

### マッチングルール

- すべての条件が AND で評価される（全条件一致で発火）
- フィルタなし（`@` なし）のトリガーは**常に発火**
- フィルタありとフィルタなしは**両方発火**する（フィルタは追加の絞り込み、排他ではない）
- `.d/` パターンとの組み合わせ: `on-done@owner=engineer.d/` も有効

### 発火の例

```
~/.todai/triggers/
├── on-done                          # (A) 常に発火
├── on-done@owner=engineer           # (B) engineer の done のみ
└── on-done@owner=kai+space=todai    # (C) kai かつ todai の done のみ
```

`todai task done --id xxx`（owner=engineer, space=default）の場合:
- (A) ✅ 発火（フィルタなし）
- (B) ✅ 発火（owner=engineer 一致）
- (C) ❌ 発火しない（owner≠kai）

## イベント一覧

| イベント | 発火タイミング | 備考 |
|---|---|---|
| `on-created` | `task add` でタスク作成時 | |
| `on-status-changed` | ステータスが変更された時 | `task update --status`, `task done` 含む |
| `on-done` | ステータスが `done` になった時 | `on-status-changed` の糖衣 |
| `on-cancelled` | ステータスが `cancelled` になった時 | `on-status-changed` の糖衣 |
| `on-updated` | タスクのフィールドが変更された時 | `task update` 全般 |

### 発火の重複ルール

糖衣イベントと汎用イベントは**両方発火する**。

例: `task done --id xxx` の場合:
1. `on-status-changed` （from → done）
2. `on-done`
3. `on-updated`

例: `task update --id xxx --status cancelled` の場合:
1. `on-status-changed` （from → cancelled）
2. `on-cancelled`
3. `on-updated`

例: `task update --id xxx --title "new"` の場合（ステータス変更なし）:
1. `on-updated`

例: `task add --owner you --title "foo"` の場合:
1. `on-created`

発火順序は上記の通り固定。同一イベント内の `.d/` は辞書順。

## コンテキストの受け渡し

### 環境変数

すべてのトリガーに共通で渡す:

| 変数 | 説明 | 例 |
|---|---|---|
| `TODAI_EVENT` | イベント名 | `created`, `status-changed`, `done`, `cancelled`, `updated` |
| `TODAI_TASK_ID` | タスクID | `m1abc2d3-x4y5z6` |
| `TODAI_TASK_TITLE` | タスクタイトル | `Fix login bug` |
| `TODAI_TASK_STATUS` | 現在のステータス | `done` |
| `TODAI_TASK_OWNER` | オーナー | `you` |
| `TODAI_TASK_SPACE` | スペース | `default` |
| `TODAI_TASK_PRIORITY` | 優先度 | `high` |
| `TODAI_TASK_CREATED_AT` | 作成日時（ISO 8601） | `2026-02-13T00:00:00.000Z` |
| `TODAI_TASK_UPDATED_AT` | 更新日時（ISO 8601） | `2026-02-13T01:00:00.000Z` |

ステータス変更時のみ:

| 変数 | 説明 | 例 |
|---|---|---|
| `TODAI_PREV_STATUS` | 変更前のステータス | `open` |

### stdin JSON

環境変数では表現しきれない詳細情報を stdin で渡す。

```json
{
  "event": "status-changed",
  "task": {
    "id": "m1abc2d3-x4y5z6",
    "owner": "you",
    "title": "Fix login bug",
    "desc": "Login fails on Safari",
    "status": "done",
    "space": "default",
    "priority": "high",
    "labels": ["bug", "frontend"],
    "parentId": null,
    "createdAt": "2026-02-13T00:00:00.000Z",
    "updatedAt": "2026-02-13T01:00:00.000Z"
  },
  "changes": {
    "status": { "from": "open", "to": "done" }
  }
}
```

#### `changes` フィールド

- `on-created`: `changes` は `null`
- `on-status-changed` / `on-done` / `on-cancelled`: `changes.status` のみ
- `on-updated`: 変更されたフィールドすべて。例:

```json
{
  "changes": {
    "title": { "from": "Old title", "to": "New title" },
    "priority": { "from": "medium", "to": "high" },
    "status": { "from": "open", "to": "in-progress" }
  }
}
```

## 実行モデル

### 非同期 (fire-and-forget)

トリガーは **非同期で実行** する。CLI の応答はトリガーの完了を待たない。

実装: `Bun.spawn` で子プロセスを起動し、detach しない（親プロセス終了時に orphan にならないよう）が、await しない。
ただし CLI プロセスが即座に終了するため、実質的には `Bun.spawn` + `unref()` で起動する。

### タイムアウト

デフォルト: **30秒**。超過した場合は `SIGTERM` → 5秒後に `SIGKILL`。

将来的に `config.toml` で変更可能にする:

```toml
[triggers]
timeout_seconds = 30
```

### 並列 vs 直列

同一イベントの `.d/` 内スクリプトは**直列実行**（順序保証のため）。
異なるイベント間（例: `on-status-changed` と `on-done`）は**並列実行**。

## エラーハンドリング

- トリガーの exit code が 0 以外 → **ログに記録**。タスク操作自体は成功として扱う
- トリガーが存在しない / executable でない → 無視（エラーにしない）
- stderr 出力 → ログに記録

### ログ

`${TODAI_HOME}/logs/triggers.log` に追記:

```
2026-02-13T01:00:00.000Z | on-done | m1abc2d3-x4y5z6 | exit=0 | 120ms
2026-02-13T01:00:01.000Z | on-done.d/00-notify.sh | m1abc2d3-x4y5z6 | exit=1 | 450ms | stderr: connection refused
2026-02-13T01:00:32.000Z | on-updated | m1abc2d3-x4y5z6 | exit=timeout | 30000ms
```

## CLI 変更

### `todai doctor`

トリガーディレクトリの状態を表示に追加:

```
triggers:
  dir:          ~/.todai/triggers/                    (default) ✗
  on-created:   (not found)
  on-done:      ~/.todai/triggers/on-done             ✓ (executable)
  on-done.d/:   2 scripts
```

### `todai trigger list` (新規、将来)

登録済みトリガーの一覧表示。v1 では不要。`doctor` で十分。

## 実装の切り方

1. **この spec** → olga（本タスク）
2. **トリガー発火基盤** → engineer: `fireTriggers(event, task, changes)` 関数。`addTask`, `doneTask`, `updateTask` から呼び出し
3. **ログ機能** → engineer: `triggers.log` への書き出し
4. **doctor 拡張** → engineer: トリガーディレクトリの表示追加

## 使用例

### Discord 通知（on-done）

```bash
#!/bin/bash
# ~/.todai/triggers/on-done
curl -s -X POST "$DISCORD_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "{\"content\": \"✅ Task done: ${TODAI_TASK_TITLE} (${TODAI_TASK_ID})\"}"
```

### タスク完了ログ（on-done.d/00-log.sh）

```bash
#!/bin/bash
# ~/.todai/triggers/on-done.d/00-log.sh
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) DONE ${TODAI_TASK_ID} ${TODAI_TASK_TITLE}" >> ~/task-completions.log
```

### stdin JSON を使った高度な処理（on-updated）

```bash
#!/bin/bash
# ~/.todai/triggers/on-updated
# stdin から JSON を読んで jq で処理
INPUT=$(cat)
CHANGED_FIELDS=$(echo "$INPUT" | jq -r '.changes | keys | join(", ")')
echo "Fields changed: $CHANGED_FIELDS"
```
