#!/usr/bin/env -S deno run --allow-run --allow-read --allow-net

/**
 * MCPサーバーをラップしたHTTPサーバー
 */

interface MCPToolInputSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  $schema?: string;
  items?: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  description?: string;
  default?: unknown;
}

interface MCPToolAnnotations {
  category?: string;
  readOnlyHint?: boolean;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
  annotations?: MCPToolAnnotations;
}

interface MCPToolsListResult {
  tools: MCPTool[];
}

interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

interface MCPMessage<Res = unknown, Req = Record<string, unknown>> {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: Req;
  result?: Res;
  error?: MCPError;
}

class MCPClient {
  private process: Deno.ChildProcess;
  private requestId = 1;
  private isInitialized = false;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(command: string, args: string[]) {
    this.process = new Deno.Command(command, {
      args,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  }

  async sendMessage(message: MCPMessage): Promise<void> {
    const jsonString = JSON.stringify(message) + "\n";
    const encoder = new TextEncoder();

    if (!this.writer) {
      this.writer = this.process.stdin.getWriter();
    }

    console.log("送信:", jsonString.trim());
    await this.writer.write(encoder.encode(jsonString));
  }

  async readMessage(): Promise<MCPMessage | undefined> {
    const decoder = new TextDecoder();

    if (!this.reader) {
      this.reader = this.process.stdout.getReader();
    }

    try {
      const { value, done } = await this.reader.read();
      if (done || !value) return undefined;

      const text = decoder.decode(value).trim();
      console.log("受信:", text);

      if (text) {
        return JSON.parse(text);
      }
      return undefined;
    } catch (error) {
      console.error("メッセージ読み取りエラー:", error);
      return undefined;
    }
  }

  async notifyMessage(message: MCPMessage): Promise<void> {
    await this.sendMessage(message);
  }

  async requestMessage(message: MCPMessage): Promise<MCPMessage | undefined> {
    await this.sendMessage(message);
    return await this.readMessage();
  }

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    // MCPプロトコルの初期化
    const initMessage: MCPMessage = {
      jsonrpc: "2.0",
      id: this.requestId++,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {
          roots: { listChanged: true },
          sampling: {},
          tools: { listChanged: true },
        },
        clientInfo: {
          name: "mcp-http-server",
          version: "1.0.0",
        },
      },
    };

    // 応答を待つ
    const response = await this.requestMessage(initMessage);
    if (response?.result) {
      console.log("初期化成功:", response.result);

      // initialized通知を送信
      await this.sendMessage({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      this.isInitialized = true;
      return true;
    }

    console.error("初期化失敗:", response);
    return false;
  }

  async callMethod(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<MCPMessage | undefined> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const message: MCPMessage = {
      jsonrpc: "2.0",
      id: this.requestId++,
      method: method,
      params: params,
    };

    return await this.requestMessage(message);
  }

  async listTools(): Promise<MCPToolsListResult | undefined> {
    const response = await this.callMethod("tools/list");
    if (response?.result && this.isToolsListResult(response.result)) {
      return response.result;
    }
    return undefined;
  }

  // 型ガード関数
  private isToolsListResult(result: unknown): result is MCPToolsListResult {
    return (
      typeof result === "object" &&
      result !== null &&
      "tools" in result &&
      Array.isArray((result as { tools: unknown }).tools)
    );
  }

  async close(): Promise<void> {
    if (this.writer) {
      await this.writer.close();
      this.writer = null;
    }
    if (this.reader) {
      this.reader.releaseLock();
      this.reader = null;
    }
    const status = await this.process.status;
    console.log("プロセス終了:", status);
  }
}

// コマンドライン引数のパース
function parseArgs(): { port: number; mcpCommand: string; mcpArgs: string[] } {
  const args = Deno.args;
  let port = 6000; // デフォルトポート
  let mcpCommand = ""; // MCPサーバーコマンド
  let mcpArgs: string[] = []; // MCPサーバー引数

  // -- の位置を探す
  const doubleDashIndex = args.indexOf("--");
  
  if (doubleDashIndex !== -1) {
    // -- 以降がMCPサーバーのコマンドと引数
    const mcpCommandArgs = args.slice(doubleDashIndex + 1);
    if (mcpCommandArgs.length > 0) {
      mcpCommand = mcpCommandArgs[0];
      mcpArgs = mcpCommandArgs.slice(1);
    }
    
    // -- より前の引数を処理（ポートなど）
    const ownArgs = args.slice(0, doubleDashIndex);
    for (let i = 0; i < ownArgs.length; i++) {
      if (ownArgs[i] === "--port" && i + 1 < ownArgs.length) {
        const portArg = parseInt(ownArgs[i + 1]);
        if (!isNaN(portArg) && portArg > 0 && portArg < 65536) {
          port = portArg;
          i++; // 次の引数をスキップ
        } else {
          console.error(`無効なポート番号: ${ownArgs[i + 1]}`);
          Deno.exit(1);
        }
      }
    }
  } else {
    // -- がない場合は従来形式もサポート（後方互換性）
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--port" && i + 1 < args.length) {
        const portArg = parseInt(args[i + 1]);
        if (!isNaN(portArg) && portArg > 0 && portArg < 65536) {
          port = portArg;
          i++; // 次の引数をスキップ
        } else {
          console.error(`無効なポート番号: ${args[i + 1]}`);
          Deno.exit(1);
        }
      }
    }
  }
  
  if (!mcpCommand) {
    console.error("MCPサーバーコマンドを指定してください");
    console.error("使用例: ./mcp-client.ts --port 6000 -- chrome-devtools-mcp -e /path/to/chrome");
    Deno.exit(1);
  }

  return { port, mcpCommand, mcpArgs };
}

// HTTPレスポンスのヘルパー関数
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// HTTPサーバークラス
class MCPHttpServer {
  private client: MCPClient;
  private port: number;

  constructor(port: number, mcpCommand: string, mcpArgs: string[]) {
    this.port = port;
    this.client = new MCPClient(mcpCommand, mcpArgs);
  }

  async start(): Promise<void> {
    console.log("MCPサーバーに接続中...");

    const initialized = await this.client.initialize();
    if (!initialized) {
      console.error("MCP初期化に失敗しました");
      throw new Error("MCP initialization failed");
    }

    console.log(`HTTPサーバーをポート ${this.port} で起動中...`);

    const server = Deno.serve({
      port: this.port,
      handler: async (req) => {
        try {
          return await this.handleRequest(req);
        } catch (error) {
          console.error("リクエスト処理エラー:", error);
          return errorResponse("Internal server error", 500);
        }
      },
    });

    console.log(`HTTPサーバーが http://localhost:${this.port} で起動しました`);

    // Ctrl+Cでの終了処理
    const _signal = Deno.addSignalListener("SIGINT", async () => {
      console.log("\nサーバーを終了中...");
      await this.client.close();
      server.shutdown();
      Deno.exit(0);
    });

    // サーバーの終了を待つ
    await server.finished;
  }

  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method;

    // CORS preflight request
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // POST /:method のみ処理
    if (method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    // URLパスからメソッド名を取得（先頭の / を除去）
    const mcpMethod = url.pathname.slice(1);
    if (!mcpMethod) {
      return errorResponse("Method name is required in URL path");
    }

    let params: Record<string, unknown> | undefined;

    // リクエストボディからparamsを取得
    const contentType = req.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      try {
        const bodyText = await req.text();
        if (bodyText.trim()) {
          const body = JSON.parse(bodyText);
          if (typeof body === "object" && body !== null) {
            params = body as Record<string, unknown>;
          }
        }
        // bodyText が空文字列の場合は params は undefined のまま
      } catch (_error) {
        return errorResponse("Invalid JSON in request body");
      }
    } else if (req.body) {
      // Content-Type が application/json でない場合でも、ボディが存在する場合は試行
      try {
        const bodyText = await req.text();
        if (bodyText.trim()) {
          const body = JSON.parse(bodyText);
          if (typeof body === "object" && body !== null) {
            params = body as Record<string, unknown>;
          }
        }
      } catch (_error) {
        // JSONでない場合は単にparamsをundefinedのままにする
      }
    }

    console.log(
      `MCPメソッド呼び出し: ${mcpMethod}`,
      params ? `with params: ${JSON.stringify(params)}` : "without params",
    );

    // MCPサーバーにリクエストを転送
    const response = await this.client.callMethod(mcpMethod, params);

    if (!response) {
      return errorResponse("No response from MCP server", 502);
    }

    // MCPエラーをHTTPエラーに変換
    if (response.error) {
      return jsonResponse(
        {
          error: {
            code: response.error.code,
            message: response.error.message,
            data: response.error.data,
          },
        },
        400,
      );
    }

    // 成功レスポンス
    return jsonResponse({
      result: response.result,
    });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

async function main() {
  try {
    const { port, mcpCommand, mcpArgs } = parseArgs();
    console.log(`MCPサーバー: ${mcpCommand} ${mcpArgs.join(' ')}`);
    const server = new MCPHttpServer(port, mcpCommand, mcpArgs);
    await server.start();
  } catch (error) {
    console.error("サーバー起動エラー:", error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
