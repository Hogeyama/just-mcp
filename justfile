# MCP Justfile
# MCPサーバーとの通信をCLIで行うためのjustfile
# Example usage
#   just init                                             # start server
#   just tools                                            # list tools
#   just tool new_page <<<'{"url":"https://example.com"}' # Use tool

mcp := env('MCP_JUST_COMMAND')
slug := env('MCP_JUST_SLUG')

default: help

# ヘルプメッセージを表示
help:
    @echo "MCP HTTP Server - 利用可能なコマンド:"
    @echo ""
    @echo "  just init            - HTTPサーバーをバックグラウンドで起動"
    @echo "  just stop            - バックグラウンドのサーバーを停止"
    @echo "  just status          - サーバーの状態を確認"
    @echo "  just tool TOOL_NAME  - 指定されたツールを実行 (標準入力からJSONを受け取る)"
    @echo "  just tools           - 利用可能なツール一覧を表示"
    @echo ""
    @echo "使用例:"
    @echo "  just init            # サーバー起動"
    @echo "  just tools           # ツール一覧"
    @echo "  just stop            # サーバー停止"

# 利用可能なツール一覧を表示
tools:
    #!/usr/bin/env bash
    set -e
    curl -sX POST "http://localhost:{{ port }}/tools/list" \
         -H "Content-Type: application/json" \
         -d '{}'

# 指定されたツールを実行 (標準入力からJSONを受け取る)
tool TOOL_NAME:
    #!/usr/bin/env bash
    set -e

    # サーバーが起動しているかチェック
    if ! pgrep -f "deno.*mcp-client.ts" >/dev/null; then
        echo "❌ サーバーが起動していません"
        echo "まず 'just init' でサーバーを起動してください"
        exit 1
    fi

    # 標準入力からJSONを読み取り、tools/callエンドポイントを使用
    if [ -t 0 ]; then
        ARGS='{}'
    else
        # 標準入力からパイプされている場合
        ARGS=$(cat)
    fi

    # tools/callの正しい形式でリクエストを構築
    resp=$(curl -sX POST "http://localhost:{{ port }}/tools/call" \
         -H "Content-Type: application/json" \
         -d "{\"name\": \"{{ TOOL_NAME }}\", \"arguments\": $ARGS}")
    text=$(echo "$resp" | jq -r '.result.content[0].text')
    if [[ $? -ne 0 ]] || [[ "$text" == 'null' ]] || [[ "$text" == '{}' ]]; then
      echo "$resp"
    else
      echo "$text"
    fi

# HTTPサーバーをバックグラウンドで起動
init:
    #!/usr/bin/env bash
    set -e

    # 既存のサーバーがあるかチェック
    if pgrep -f "deno.*mcp-client.ts" >/dev/null; then
        echo "サーバーは既に起動しています"
        echo "停止するには 'just stop' を実行してください"
        exit 1
    fi

    echo "HTTPサーバーをポート {{ port }} でバックグラウンド起動中..."

    # 一時ディレクトリを作成
    mkdir -p {{ tmp_dir }}

    # サーバーを起動してログファイルに出力
    CLIENT=$(dirname "$(realpath "{{ justfile() }}")")/mcp-client.ts
    echo "Using client $CLIENT"
    nohup "$CLIENT" --port {{ port }} -- {{ mcp }} > {{ tmp_dir }}/server.log 2>&1 &

    # PIDを保存
    echo $! > {{ tmp_dir }}/server.pid

    echo "サーバーが起動しました (PID: $(cat {{ tmp_dir }}/server.pid))"
    echo "ログ: tail -f {{ tmp_dir }}/server.log"
    echo "状態確認: just status"

    # 起動を少し待つ
    sleep 3

    # サーバーが正常に起動したかチェック
    if curl -s --max-time 5 "http://localhost:{{ port }}/tools/list" -X POST -H "Content-Type: application/json" -d '{}' > /dev/null; then
        echo "✅ サーバーが正常に起動しました"
    else
        echo "❌ サーバーの起動に失敗した可能性があります"
        echo "ログを確認してください: just logs"
    fi

# バックグラウンドのサーバーを停止
stop:
    #!/usr/bin/env bash
    if [ -f {{ tmp_dir }}/server.pid ]; then
        PID=$(cat {{ tmp_dir }}/server.pid)
        if kill -0 "$PID" 2>/dev/null; then
            echo "サーバーを停止中... (PID: $PID)"
            kill "$PID"
            rm -f {{ tmp_dir }}/server.pid
            echo "✅ サーバーを停止しました"
        else
            echo "PIDファイルに記録されたプロセスは既に停止しています"
            rm -f {{ tmp_dir }}/server.pid
        fi
    else
        echo "PIDファイルが見つかりません"
        # プロセスを直接検索して停止を試行
        if pgrep -f "deno.*mcp-client.ts" >/dev/null; then
            echo "実行中のサーバープロセスを発見しました。停止を試行中..."
            pkill -f "deno.*mcp-client.ts"
            echo "✅ サーバープロセスを停止しました"
        else
            echo "実行中のサーバーが見つかりませんでした"
        fi
    fi

# サーバーの状態を確認
status:
    #!/usr/bin/env bash
    if [ -f {{ tmp_dir }}/server.pid ]; then
        PID=$(cat {{ tmp_dir }}/server.pid)
        if kill -0 "$PID" 2>/dev/null; then
            echo "✅ サーバーが実行中です (PID: $PID)"

            if curl -s --max-time 5 "http://localhost:{{ port }}/tools/list" -X POST -H "Content-Type: application/json" -d '{}' > /dev/null; then
                echo "✅ サーバーは正常に応答しています"
            else
                echo "❌ サーバーが応答しません"
            fi
        else
            echo "❌ PIDファイルはあるが、プロセスが見つかりません"
            rm -f {{ tmp_dir }}/server.pid
        fi
    else
        echo "❌ サーバーは起動していません"
        if pgrep -f "deno.*mcp-client.ts" >/dev/null; then
            echo "⚠️  ただし、管理されていないサーバープロセスが実行中です"
        fi
    fi

logs:
    #!/usr/bin/env bash
    cat {{ tmp_dir }}/server.log

port := "6000"
server_url := "http://localhost:" + port
tmp_dir := '/tmp/just-mcp/' + slug
