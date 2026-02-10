import { Injectable, Logger } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from "@nestjs/websockets";
import type {
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import {
  GatewayEvents,
  type RoutedMessage,
  type SendErrorResponse,
  type PingPayload,
  type PongResponse,
  type DeviceInfo,
  type DeviceType,
} from "@multica/sdk";
import type { VirtualDeviceHandler } from "./types.js";

@Injectable()
@WebSocketGateway({
  path: "/ws",
  cors: {
    origin: "*",
  },
  // Heartbeat detection configuration
  pingInterval: 25000, // Send PING every 25 seconds
  pingTimeout: 20000, // Must respond within 20 seconds, otherwise disconnect
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  // deviceId -> socketId mapping
  private deviceToSocket = new Map<string, string>();
  // socketId -> deviceInfo mapping
  private socketToDevice = new Map<string, DeviceInfo>();
  // Virtual devices (non-socket based, e.g., Telegram)
  private virtualDevices = new Map<string, VirtualDeviceHandler>();

  afterInit(_server: Server): void {
    this.logger.log("WebSocket Gateway initialized");
  }

  handleConnection(client: Socket): void {
    const query = client.handshake.query;
    const deviceId = query["deviceId"] as string | undefined;
    const deviceType = query["deviceType"] as DeviceType | undefined;

    this.logger.debug(`Incoming connection: socketId=${client.id}, deviceId=${deviceId}, deviceType=${deviceType}`);

    if (!deviceId || !deviceType) {
      this.logger.warn(`Missing deviceId or deviceType in query, disconnecting (socketId=${client.id})`);
      client.disconnect(true);
      return;
    }

    // Check if deviceId is already in use by another socket
    const existingSocketId = this.deviceToSocket.get(deviceId);
    if (existingSocketId && existingSocketId !== client.id) {
      this.logger.warn(`Device already registered by another socket, disconnecting (deviceId=${deviceId}, existingSocketId=${existingSocketId})`);
      client.emit(GatewayEvents.REGISTERED, {
        success: false,
        deviceId,
        error: "Device ID already in use",
      });
      client.disconnect(true);
      return;
    }

    // Register device
    const deviceInfo: DeviceInfo = { deviceId, deviceType };
    this.deviceToSocket.set(deviceId, client.id);
    this.socketToDevice.set(client.id, deviceInfo);

    this.logger.log(`Device connected and registered: deviceId=${deviceId}, deviceType=${deviceType}`);
    client.emit(GatewayEvents.REGISTERED, { success: true, deviceId });
  }

  handleDisconnect(client: Socket): void {
    const deviceInfo = this.socketToDevice.get(client.id);
    if (deviceInfo) {
      this.logger.debug(`Device disconnecting: socketId=${client.id}, deviceId=${deviceInfo.deviceId}, deviceType=${deviceInfo.deviceType}`);
      this.logger.log(`Device disconnected: deviceId=${deviceInfo.deviceId}, deviceType=${deviceInfo.deviceType}`);
      this.deviceToSocket.delete(deviceInfo.deviceId);
      this.socketToDevice.delete(client.id);
    } else {
      this.logger.log(`Socket disconnected: socketId=${client.id}`);
    }
  }

  @SubscribeMessage(GatewayEvents.SEND)
  handleSend(
    @MessageBody() message: RoutedMessage,
    @ConnectedSocket() client: Socket
  ): void {
    this.logger.debug(`Received send event: socketId=${client.id}, messageId=${message.id}`);

    const senderDevice = this.socketToDevice.get(client.id);

    // Check if sender is registered
    if (!senderDevice) {
      const error: SendErrorResponse = {
        messageId: message.id,
        error: "Sender not registered",
        code: "NOT_REGISTERED",
      };
      client.emit(GatewayEvents.SEND_ERROR, error);
      return;
    }

    // Check if message 'from' matches
    if (message.from !== senderDevice.deviceId) {
      const error: SendErrorResponse = {
        messageId: message.id,
        error: "Invalid sender ID",
        code: "INVALID_MESSAGE",
      };
      client.emit(GatewayEvents.SEND_ERROR, error);
      return;
    }

    // Find target device — check socket-based first, then virtual
    const targetSocketId = this.deviceToSocket.get(message.to);
    if (targetSocketId) {
      this.logger.debug(`Routing message: id=${message.id}, from=${message.from}, to=${message.to}, action=${message.action}`);
      this.server.to(targetSocketId).emit(GatewayEvents.RECEIVE, message);
      return;
    }

    const virtualHandler = this.virtualDevices.get(message.to);
    if (virtualHandler) {
      this.logger.debug(`Routing message to virtual device: id=${message.id}, from=${message.from}, to=${message.to}, action=${message.action}`);
      virtualHandler.sendCallback(GatewayEvents.RECEIVE, message);
      return;
    }

    const error: SendErrorResponse = {
      messageId: message.id,
      error: `Device ${message.to} not found`,
      code: "DEVICE_NOT_FOUND",
    };
    client.emit(GatewayEvents.SEND_ERROR, error);
  }

  @SubscribeMessage(GatewayEvents.LIST_DEVICES)
  handleListDevices(
    @ConnectedSocket() client: Socket
  ): { devices: DeviceInfo[] } {
    const senderDevice = this.socketToDevice.get(client.id);
    if (!senderDevice) {
      return { devices: [] };
    }
    return { devices: this.getOnlineDevices() };
  }

  @SubscribeMessage(GatewayEvents.PING)
  handlePing(
    @MessageBody() data: PingPayload,
    @ConnectedSocket() client: Socket
  ): PongResponse {
    this.logger.debug(`Received ping: socketId=${client.id}`);
    return { event: GatewayEvents.PONG, data: "Hello from Gateway!" };
  }

  /** Get all online devices (for HTTP API use) */
  getOnlineDevices(): DeviceInfo[] {
    return Array.from(this.socketToDevice.values());
  }

  /** Get online devices of specified type */
  getOnlineDevicesByType(type: DeviceType): DeviceInfo[] {
    return this.getOnlineDevices().filter((d) => d.deviceType === type);
  }

  /** Send message to specified device (for HTTP API use) */
  sendToDevice(deviceId: string, event: string, data: unknown): boolean {
    // Check virtual devices first
    const virtualHandler = this.virtualDevices.get(deviceId);
    if (virtualHandler) {
      this.logger.debug(`Routing to virtual device: deviceId=${deviceId}, event=${event}`);
      virtualHandler.sendCallback(event, data);
      return true;
    }

    // Fall back to socket-based devices
    const socketId = this.deviceToSocket.get(deviceId);
    if (!socketId) return false;
    this.server.to(socketId).emit(event, data);
    return true;
  }

  /** Register a virtual device (non-socket based) */
  registerVirtualDevice(deviceId: string, handler: VirtualDeviceHandler): void {
    this.virtualDevices.set(deviceId, handler);
    this.logger.log(`Virtual device registered: deviceId=${deviceId}`);
  }

  /** Unregister a virtual device */
  unregisterVirtualDevice(deviceId: string): void {
    this.virtualDevices.delete(deviceId);
    this.logger.log(`Virtual device unregistered: deviceId=${deviceId}`);
  }

  /** Check if a device (socket or virtual) is registered */
  isDeviceRegistered(deviceId: string): boolean {
    return this.deviceToSocket.has(deviceId) || this.virtualDevices.has(deviceId);
  }

  /** Route a message originating from a virtual device to its target */
  routeFromVirtualDevice(message: RoutedMessage): boolean {
    // Validate sender is a registered virtual device
    if (!this.virtualDevices.has(message.from)) {
      this.logger.warn(`routeFromVirtualDevice: sender not a virtual device (from=${message.from})`);
      return false;
    }

    // Try socket-based target first
    const targetSocketId = this.deviceToSocket.get(message.to);
    if (targetSocketId) {
      this.logger.debug(`Virtual device routing: id=${message.id}, from=${message.from}, to=${message.to}, action=${message.action}`);
      this.server.to(targetSocketId).emit(GatewayEvents.RECEIVE, message);
      return true;
    }

    // Try virtual device target
    const virtualHandler = this.virtualDevices.get(message.to);
    if (virtualHandler) {
      this.logger.debug(`Virtual device routing (v2v): id=${message.id}, from=${message.from}, to=${message.to}, action=${message.action}`);
      virtualHandler.sendCallback(GatewayEvents.RECEIVE, message);
      return true;
    }

    this.logger.warn(`routeFromVirtualDevice: target not found (to=${message.to})`);
    return false;
  }
}
