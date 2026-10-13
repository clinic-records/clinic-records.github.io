import { FastifyReply } from 'fastify';

export interface ClientConnection {
  id: string;
  ip: string;
  viewingPatientId: number | null;
  reply: FastifyReply;
}

class RealtimeManager {
  private clients: Map<string, ClientConnection> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor() {
    // 25-second keep-alive heartbeat for Wi-Fi / mobile connections
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, 25000);
    this.heartbeatTimer.unref();
  }

  private sendHeartbeat(): void {
    if (this.clients.size === 0) return;
    const pingPayload = ': ping\n\n';
    for (const [clientId, client] of this.clients.entries()) {
      try {
        if (client.reply.raw.writableEnded || client.reply.raw.destroyed) {
          this.clients.delete(clientId);
        } else {
          client.reply.raw.write(pingPayload);
        }
      } catch {
        this.clients.delete(clientId);
      }
    }
  }

  public addClient(id: string, ip: string, reply: FastifyReply): void {
    this.clients.set(id, {
      id,
      ip,
      viewingPatientId: null,
      reply,
    });
    this.broadcastPresence();
  }

  public removeClient(id: string): void {
    this.clients.delete(id);
    this.broadcastPresence();
  }

  public setViewingPatient(clientId: string, patientId: number | null): void {
    const client = this.clients.get(clientId);
    if (client) {
      const prevPatientId = client.viewingPatientId;
      client.viewingPatientId = patientId;

      if (prevPatientId && prevPatientId !== patientId) {
        this.broadcastPatientViewers(prevPatientId);
      }
      if (patientId) {
        this.broadcastPatientViewers(patientId);
      }
    }
  }

  public getOnlineCount(): number {
    return this.clients.size;
  }

  public getPatientViewers(patientId: number, excludeClientId?: string): string[] {
    const viewers: string[] = [];
    for (const client of this.clients.values()) {
      if (client.viewingPatientId === patientId && client.id !== excludeClientId) {
        viewers.push(client.ip);
      }
    }
    return viewers;
  }

  public broadcastPresence(): void {
    const count = this.getOnlineCount();
    this.broadcast({
      type: 'presence',
      onlineUsers: count,
    });
  }

  public broadcastPatientViewers(patientId: number): void {
    const viewers = this.getPatientViewers(patientId);
    this.broadcast({
      type: 'patient_viewers_changed',
      patientId,
      viewersCount: viewers.length,
    });
  }

  public broadcastPatientUpdate(
    patientId: number,
    updatedByClientId?: string,
    action: 'details' | 'document' | 'video' = 'details'
  ): void {
    this.broadcast({
      type: 'patient_updated',
      patientId,
      updatedBy: updatedByClientId,
      action,
      timestamp: Date.now(),
    });
  }

  public broadcastPatientsListChanged(): void {
    this.broadcast({
      type: 'patients_list_changed',
      timestamp: Date.now(),
    });
  }

  public broadcastServerUpdating(): void {
    this.broadcast({
      type: 'server_updating',
      message: 'جارٍ تطبيق تحديث للمنظومة على الخادم وإعادة التشغيل (خلال ثوانٍ معدودة)...',
      timestamp: Date.now(),
    });
  }

  private broadcast(data: Record<string, any>): void {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const [clientId, client] of this.clients.entries()) {
      try {
        client.reply.raw.write(payload);
      } catch (err) {
        this.clients.delete(clientId);
      }
    }
  }
}

export const realtimeManager = new RealtimeManager();
