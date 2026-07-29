import { EventEmitter } from "events";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { WebSocket, RawData } from "ws";

export interface CallStartEvent {
  callId: string;
  callerPhone: string;
  timestamp: string;
}

export interface AudioChunkEvent {
  callId: string;
  buffer: Buffer;
}

export interface CallEndEvent {
  callId: string;
  reason?: string;
}

type CallStartHandler = (event: CallStartEvent) => void;
type AudioChunkHandler = (event: AudioChunkEvent) => void;
type CallEndHandler = (event: CallEndEvent) => void;

class SmartFloAdapter {
  private emitter = new EventEmitter();
  private activeSockets = new Map<string, WebSocket>();

  // Event listeners
  public onCallStart(handler: CallStartHandler): void {
    this.emitter.on("callStart", handler);
  }

  public onAudioChunk(handler: AudioChunkHandler): void {
    this.emitter.on("audioChunk", handler);
  }

  public onCallEnd(handler: CallEndHandler): void {
    this.emitter.on("callEnd", handler);
  }

  // Send audio back to the caller over open WebSocket stream
  public sendAudio(callId: string, audioBuffer: Buffer): boolean {
    const socket = this.activeSockets.get(callId);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(audioBuffer);
      return true;
    }
    return false;
  }

  // Register HTTP Webhook + WebSocket Endpoints into Fastify
  public registerRoutes(server: FastifyInstance): void {
    // 1. Incoming Call Webhook (HTTP POST)
    server.post("/webhooks/smartflo/incoming-call", async (request: FastifyRequest, reply: FastifyReply) => {
      const authHeader = request.headers["x-smartflo-signature"] || request.headers["authorization"];
      const expectedSecret = process.env.SMARTFLO_WEBHOOK_SECRET;

      if (expectedSecret && authHeader !== expectedSecret) {
        server.log.warn({ authHeader }, "Unauthorized SmartFlo webhook request");
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const body = request.body as any || {};
      const callId = body.call_id || body.callId || `call_${Date.now()}`;
      const callerPhone = body.caller_phone || body.callerPhone || body.from || "unknown";

      const event: CallStartEvent = {
        callId,
        callerPhone,
        timestamp: new Date().toISOString(),
      };

      this.emitter.emit("callStart", event);

      return reply.status(200).send({
        status: "accepted",
        callId,
        streamUrl: `/ws/smartflo/stream?callId=${encodeURIComponent(callId)}`,
      });
    });

    // 2. Audio Streaming Endpoint (WebSocket)
    server.get("/ws/smartflo/stream", { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
      const query = req.query as any || {};
      const callId = query.callId || `ws_call_${Date.now()}`;

      this.activeSockets.set(callId, socket);
      server.log.info({ callId }, "SmartFlo WebSocket stream connected");

      socket.on("message", (data: RawData) => {
        let buffer: Buffer;

        if (Buffer.isBuffer(data)) {
          buffer = data;
        } else if (data instanceof ArrayBuffer) {
          buffer = Buffer.from(data);
        } else if (Array.isArray(data)) {
          buffer = Buffer.concat(data);
        } else {
          const strData = String(data);
          try {
            const parsed = JSON.parse(strData);
            if (parsed.event === "media" && parsed.media?.payload) {
              buffer = Buffer.from(parsed.media.payload, "base64");
            } else {
              buffer = Buffer.from(strData);
            }
          } catch {
            buffer = Buffer.from(strData);
          }
        }

        this.emitter.emit("audioChunk", { callId, buffer });
      });

      socket.on("close", (code: number, reason: Buffer) => {
        this.activeSockets.delete(callId);
        this.emitter.emit("callEnd", {
          callId,
          reason: reason.toString() || `Socket closed (${code})`,
        });
        server.log.info({ callId, code }, "SmartFlo WebSocket stream disconnected");
      });

      socket.on("error", (err: Error) => {
        server.log.error({ callId, err: err.message }, "SmartFlo WebSocket error");
      });
    });
  }
}

// Export a singleton instance of the adapter with clean provider-agnostic interface
export const smartFloAdapter = new SmartFloAdapter();
