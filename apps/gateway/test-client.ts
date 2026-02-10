import {
  GatewayClient,
  type ConnectionState,
  type RoutedMessage,
  type SendErrorResponse,
} from "@multica/sdk";

const HelloAction = "hello";
const HelloResponseAction = "hello:response";
type HelloPayload = { greeting: string };
type HelloResponsePayload = { reply: string };

// 模拟一个 Client
const client = new GatewayClient({
  url: "http://localhost:3000",
  deviceId: "client-001",
  deviceType: "client",
});

// 模拟一个 Agent
const agent = new GatewayClient({
  url: "http://localhost:3000",
  deviceId: "agent-001",
  deviceType: "agent",
});

// Agent 监听消息
agent
  .onStateChange((state: ConnectionState) => console.log("[Agent] State:", state))
  .onRegistered((deviceId: string) => {
    console.log("[Agent] Registered as:", deviceId);
  })
  .onMessage((message: RoutedMessage) => {
    console.log("[Agent] Received message:", message);

    // 回复消息
    if (message.action === HelloAction) {
      const payload = message.payload as HelloPayload;
      console.log("[Agent] Replying to client...");
      agent.send<HelloResponsePayload>(message.from, HelloResponseAction, {
        reply: `Hello ${message.from}! I received: "${payload.greeting}"`,
      });
    }
  })
  .onSendError((error: SendErrorResponse) => console.error("[Agent] Send error:", error))
  .connect();

// Client 监听消息
client
  .onStateChange((state: ConnectionState) => console.log("[Client] State:", state))
  .onRegistered((deviceId: string) => {
    console.log("[Client] Registered as:", deviceId);

    // 注册后发送消息给 Agent
    setTimeout(() => {
      console.log("[Client] Sending message to agent-001...");
      client.send<HelloPayload>("agent-001", HelloAction, {
        greeting: "Hello Agent!",
      });
    }, 500);
  })
  .onMessage((message: RoutedMessage) => {
    console.log("[Client] Received message:", message);
  })
  .onSendError((error: SendErrorResponse) => console.error("[Client] Send error:", error))
  .connect();

// 5秒后断开
setTimeout(() => {
  console.log("\nClosing connections...");
  client.disconnect();
  agent.disconnect();
  process.exit(0);
}, 5000);
