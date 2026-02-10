# 工具系统

[English](./README.md)

工具系统为 LLM Agent 提供与外部世界交互的能力。工具是 Agent 的"手和脚"——没有工具，LLM 只能生成文本响应。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        工具定义                                  │
│  (AgentTool from @mariozechner/pi-agent-core)                  │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │    name     │  │ description │  │ parameters  │             │
│  │   label     │  │   execute   │  │  (TypeBox)  │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    3 层策略过滤器                                 │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 第 1 层: 全局 Allow/Deny                                 │  │
│  │ 通过 CLI 或配置文件进行用户自定义                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 第 2 层: Provider 特定规则                                │  │
│  │ 不同 LLM Provider 有不同的规则                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 第 3 层: Subagent 限制                                   │  │
│  │ 子 Agent 的工具访问受限                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      过滤后的工具                                │
│              (传递给 pi-agent-core)                             │
└─────────────────────────────────────────────────────────────────┘
```

## 可用工具

| 工具           | 名称             | 描述                           |
| -------------- | ---------------- | ------------------------------ |
| Read           | `read`           | 读取文件内容                   |
| Write          | `write`          | 写入文件内容                   |
| Edit           | `edit`           | 编辑现有文件                   |
| Glob           | `glob`           | 按模式查找文件                 |
| Exec           | `exec`           | 执行 Shell 命令                |
| Process        | `process`        | 管理长时间运行的进程           |
| Web Fetch      | `web_fetch`      | 从 URL 获取并提取内容          |
| Web Search     | `web_search`     | 搜索网络（需要 API Key）       |
| Memory Search  | `memory_search`  | 搜索 memory 文件（需要 Profile）|
| Sessions Spawn | `sessions_spawn` | 创建子 Agent 会话              |

> **注意**: `memory_search` 工具通过关键词搜索 `memory.md` 和 `memory/*.md` 文件。Agent 通过 `read` 和 `edit` 工具操作 memory 文件内容。

## 工具组

工具组提供了一次性允许/禁止多个工具的快捷方式：

| 组               | 工具                           |
| ---------------- | ------------------------------ |
| `group:fs`       | read, write, edit, glob        |
| `group:runtime`  | exec, process                  |
| `group:web`      | web_search, web_fetch          |
| `group:memory`   | memory_search                  |
| `group:subagent` | sessions_spawn                 |
| `group:core`     | 所有 fs、runtime 和 web 工具   |

## 使用方法

### CLI 使用

所有命令使用统一的 `multica` CLI（开发时使用 `pnpm multica`）。

```bash
# 只允许特定工具
multica run --tools-allow group:fs,group:runtime "list files"

# 禁止特定工具
multica run --tools-deny exec,process "read file.txt"

# 使用工具组
multica run --tools-allow group:fs "read config.json"
```

### 编程使用

```typescript
import { Agent } from './runner.js';

const agent = new Agent({
   tools: {
      // 第 1 层: 全局 allow/deny
      allow: ['group:fs', 'group:runtime', 'web_fetch'],
      deny: ['exec'],

      // 第 2 层: Provider 特定规则
      byProvider: {
         google: {
            deny: ['exec', 'process'], // Google 模型不能使用运行时工具
         },
      },
   },

   // 第 3 层: Subagent 模式
   isSubagent: false,
});
```

### 检查工具配置

使用 tools CLI 检查和测试配置：

```bash
# 列出所有可用工具
multica tools list

# 列出带有允许规则的工具
multica tools list --allow group:fs,group:runtime

# 列出带有禁止规则的工具
multica tools list --deny exec

# 显示所有工具组
multica tools groups
```

## 策略系统详情

### 第 1 层: 全局 Allow/Deny

用户指定的 allow/deny 列表：

- `allow`: 只有这些工具可用（支持 group:\* 语法）
- `deny`: 这些工具被阻止（优先于 allow）

如果未指定 `allow` 列表，默认所有工具都可用。

### 第 2 层: Provider 特定规则

不同的 LLM Provider 可能有不同的能力或限制：

```typescript
{
  byProvider: {
    google: { deny: ["exec"] },      // Gemini 不能执行命令
    anthropic: { allow: ["*"] },     // Claude 有完全访问权限
  }
}
```

### 第 3 层: Subagent 限制

当 `isSubagent: true` 时，会应用额外的限制，防止子 Agent 访问敏感工具（如会话管理）。

## 添加新工具

1. 在 `src/agent/tools/` 中创建新文件（例如 `my-tool.ts`）

2. 使用 TypeBox 定义工具的 Schema：

```typescript
import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';

const MyToolSchema = Type.Object({
   param1: Type.String({ description: '参数描述' }),
   param2: Type.Optional(Type.Number()),
});

export function createMyTool(): AgentTool<typeof MyToolSchema> {
   return {
      name: 'my_tool',
      label: 'My Tool',
      description: '这个工具做什么',
      parameters: MyToolSchema,
      execute: async (toolCallId, args) => {
         // 实现
         return { result: 'success' };
      },
   };
}
```

3. 在 `src/agent/tools.ts` 中注册工具：

```typescript
import { createMyTool } from './tools/my-tool.js';

export function createAllTools(cwd: string): AgentTool<any>[] {
   // ... 现有工具
   const myTool = createMyTool();

   return [
      ...baseTools,
      myTool as AgentTool<any>,
      // ...
   ];
}
```

4. 在 `groups.ts` 中将工具添加到适当的组：

```typescript
export const TOOL_GROUPS: Record<string, string[]> = {
   'group:my_category': ['my_tool', 'other_tool'],
   // ...
};
```

## 测试

运行策略系统测试：

```bash
pnpm test src/agent/tools/policy.test.ts
```

## Agent Profile 集成

工具配置可以在 Agent Profile 的 `config.json` 中定义，允许不同的 Agent 拥有不同的工具能力：

```
┌─────────────────────────────────────────────────────────────────┐
│                      Super Multica Hub                          │
│                                                                 │
│   ┌───────────┐    ┌───────────┐    ┌───────────┐              │
│   │  Agent A  │    │  Agent B  │    │  Agent C  │              │
│   │  Profile: │    │  Profile: │    │  Profile: │              │
│   │  coder    │    │  reviewer │    │  devops   │              │
│   │           │    │           │    │           │              │
│   │  tools:   │    │  tools:   │    │  tools:   │              │
│   │  allow:fs │    │  deny:*   │    │  allow:*  │              │
│   └─────┬─────┘    └─────┬─────┘    └─────┬─────┘              │
│         │                │                │                     │
└─────────┼────────────────┼────────────────┼─────────────────────┘
          │                │                │
          ▼                ▼                ▼
    ┌──────────┐     ┌──────────┐     ┌──────────┐
    │  Client  │     │  Client  │     │  Client  │
    └──────────┘     └──────────┘     └──────────┘
```

每个 Agent 的 Profile 可以在 `config.json` 中定义自己的工具配置：

```json
{
   "tools": {
      "allow": ["group:fs", "group:runtime"],
      "deny": ["exec"]
   },
   "provider": "anthropic",
   "model": "claude-sonnet-4-20250514"
}
```

详见 [Profile README](../profile/README.md)。
