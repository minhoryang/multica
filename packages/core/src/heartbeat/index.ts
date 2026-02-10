export {
  emitHeartbeatEvent,
  getLastHeartbeatEvent,
  onHeartbeatEvent,
  resolveIndicatorType,
  type HeartbeatEventPayload,
  type HeartbeatIndicatorType,
} from "./heartbeat-events.js";

export {
  hasHeartbeatWakeHandler,
  hasPendingHeartbeatWake,
  requestHeartbeatNow,
  setHeartbeatWakeHandler,
  type HeartbeatRunResult,
  type HeartbeatWakeHandler,
} from "./heartbeat-wake.js";

export {
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  DEFAULT_HEARTBEAT_EVERY,
  HEARTBEAT_PROMPT,
  HEARTBEAT_TOKEN,
  isHeartbeatContentEffectivelyEmpty,
  resolveHeartbeatPrompt,
  stripHeartbeatToken,
  type StripHeartbeatMode,
} from "./heartbeat-text.js";

export {
  drainSystemEvents,
  enqueueSystemEvent,
  hasSystemEvents,
  peekSystemEvents,
  resetSystemEventsForTest,
  type SystemEvent,
} from "./system-events.js";

export {
  runHeartbeatOnce,
  setHeartbeatsEnabled,
  startHeartbeatRunner,
  type HeartbeatConfig,
  type HeartbeatRunner,
} from "./runner.js";
