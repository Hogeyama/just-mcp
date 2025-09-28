
## Usage

```
$ cat .envrc
export MCP_JUST_COMMAND='chrome-devtools-mcp -e /home/hogeyama/.nix-profile/bin/google-chrome-stable'
export MCP_JUST_SLUG='test'
```

```
Hogeyama: justfileを使って、http://localhost:8000/test-page.html の概要を調べて

GitHub Copilot: まず、justfileの内容を確認して、利用可能なコマンドを調べてみます。

Read [](file:///tmp/mcp-test/justfile)

justfileを確認しました。これはMCP (Model Context Protocol) サーバーとの通信を行うためのファイルですね。

まず、サーバーが起動しているか確認し、起動していなければ起動してから、http://localhost:8000/test-page.html の概要を調べてみます。

Ran terminal command: just status

サーバーが起動していないので、まず起動します：

Ran terminal command: just init

サーバーが正常に起動しました。次に利用可能なツール一覧を確認します：

Ran terminal command: just tools

多くのツールが利用可能ですね。まず指定されたURL（http://localhost:8000/test-page.html）へのページを作成し、その概要を調べましょう：

Ran terminal command: echo '{"url":"http://localhost:8000/test-page.html"}' | just tool new_page

新しいページが作成されました。次に、このページのテキストスナップショットを取得して概要を調べます：

Ran terminal command: echo '{}' | just tool take_snapshot

さらに詳細な情報を取得するため、ページの追加要素を確認してみましょう。ボタンをクリックしてみます：

Ran terminal command: echo '{"uid":"1_18"}' | just tool click

ページのコンソールメッセージもチェックしてみましょう：

Ran terminal command: echo '{}' | just tool list_console_messages
```
