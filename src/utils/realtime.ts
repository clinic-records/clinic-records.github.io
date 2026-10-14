import { FastifyReply } from 'fastify';

export interface ClientConnection {
  id: string;
  ip: string;
  viewingPatientId: number | null;
  reply: FastifyReply;
  isObserver?: boolean;
}

class RealtimeManager {
  private clients: Map<string, ClientConnection> = new Map();
  private pendingDisconnects: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor() {
    // 10-second active keep-alive heartbeat for rapid mobile sleep / disconnect detection
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, 10000);
    this.heartbeatTimer.unref();
  }

  private sendHeartbeat(): void {
    if (this.clients.size === 0) return;
    const pingPayload = ': ping\n\n';
    let pruned = false;

    for (const [clientId, client] of this.clients.entries()) {
      try {
        if (client.reply.raw.writableEnded || client.reply.raw.destroyed) {
          this.clients.delete(clientId);
          pruned = true;
        } else {
          client.reply.raw.write(pingPayload);
        }
      } catch {
        this.clients.delete(clientId);
        pruned = true;
      }
    }

    if (pruned) {
      this.broadcastPresence();
    }
  }

  public addClient(id: string, ip: string, reply: FastifyReply, isObserver = false): void {
    // If this client had a pending disconnect timer (e.g. page reload / quick navigation), cancel it!
    const pendingTimer = this.pendingDisconnects.get(id);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.pendingDisconnects.delete(id);
    }

    this.clients.set(id, {
      id,
      ip,
      viewingPatientId: null,
      reply,
      isObserver,
    });

    // Instant presence broadcast on connect!
    this.broadcastPresence();
  }

  public removeClient(id: string): void {
    const client = this.clients.get(id);
    if (!client) return;

    if (client.isObserver) {
      this.clients.delete(id);
      return;
    }

    // Cancel any previous pending timer for this id
    if (this.pendingDisconnects.has(id)) {
      clearTimeout(this.pendingDisconnects.get(id)!);
    }

    // 2-second smart grace period:
    // If the user refreshed the page or navigated, they will reconnect before this fires.
    // Zero flicker!
    const timer = setTimeout(() => {
      this.pendingDisconnects.delete(id);
      if (this.clients.has(id)) {
        this.clients.delete(id);
        this.broadcastPresence();
      }
    }, 2000);

    this.pendingDisconnects.set(id, timer);
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
    let count = 0;
    for (const client of this.clients.values()) {
      if (!client.isObserver) {
        count++;
      }
    }
    return count;
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
