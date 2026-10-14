/**
 * Clinic Patient Records - Zero-Dependency In-App mDNS Responder
 * Implements RFC 6762 (Multicast DNS) & RFC 6763 (DNS-Based Service Discovery)
 * 
 * Enables zero-configuration access via friendly local URLs:
 * http://clinic.local:3000 across macOS, iOS, Windows 10/11, and Linux.
 */

import dgram from 'node:dgram';
import type { Socket } from 'node:dgram';

const MDNS_MULTICAST_IPV4 = '224.0.0.251';
const MDNS_PORT = 5353;

function encodeDnsName(name: string): Buffer {
  const parts = name.split('.');
  const bufs: Buffer[] = [];
  for (const part of parts) {
    if (!part) continue;
    const b = Buffer.from(part, 'utf-8');
    bufs.push(Buffer.from([b.length]));
    bufs.push(b);
  }
  bufs.push(Buffer.from([0]));
  return Buffer.concat(bufs);
}

function buildARecord(name: string, ip: string, ttl = 120): Buffer {
  const nameBuf = encodeDnsName(name);
  const data = Buffer.alloc(10);
  data.writeUInt16BE(1, 0); // Type A (IPv4)
  data.writeUInt16BE(0x8001, 2); // Class IN + Cache-Flush bit (RFC 6762 Section 10.2)
  data.writeUInt32BE(ttl, 4); // TTL
  data.writeUInt16BE(4, 8); // RDLENGTH 4 bytes
  const ipOctets = ip.split('.').map(Number);
  const ipBuf = Buffer.from(ipOctets);
  return Buffer.concat([nameBuf, data, ipBuf]);
}

function buildPtrRecord(serviceType: string, instanceName: string, ttl = 120): Buffer {
  const nameBuf = encodeDnsName(serviceType);
  const targetBuf = encodeDnsName(instanceName);
  const data = Buffer.alloc(10);
  data.writeUInt16BE(12, 0); // Type PTR
  data.writeUInt16BE(1, 2); // Class IN
  data.writeUInt32BE(ttl, 4); // TTL
  data.writeUInt16BE(targetBuf.length, 8); // RDLENGTH
  return Buffer.concat([nameBuf, data, targetBuf]);
}

function buildSrvRecord(instanceName: string, targetHost: string, port: number, ttl = 120): Buffer {
  const nameBuf = encodeDnsName(instanceName);
  const targetBuf = encodeDnsName(targetHost);
  const data = Buffer.alloc(16);
  data.writeUInt16BE(33, 0); // Type SRV
  data.writeUInt16BE(0x8001, 2); // Class IN + Flush
  data.writeUInt32BE(ttl, 4); // TTL
  data.writeUInt16BE(6 + targetBuf.length, 8); // RDLENGTH
  data.writeUInt16BE(0, 10); // Priority
  data.writeUInt16BE(0, 12); // Weight
  data.writeUInt16BE(port, 14); // Port
  return Buffer.concat([nameBuf, data, targetBuf]);
}

function buildDnsPacket(answers: Buffer[]): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0); // Transaction ID (0 in mDNS)
  header.writeUInt16BE(0x8400, 2); // Flags: Standard Response, Authoritative
  header.writeUInt16BE(0, 4); // Questions
  header.writeUInt16BE(answers.length, 6); // Answers count
  header.writeUInt16BE(0, 8); // Authority count
  header.writeUInt16BE(0, 10); // Additional count
  return Buffer.concat([header, ...answers]);
}

class MdnsService {
  private socket: Socket | null = null;
  private currentIp = '127.0.0.1';
  private currentPort = 3000;
  private domain = 'clinic.local';
  private announceTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  public start(port: number, primaryIp: string, domain = 'clinic.local'): void {
    if (this.isRunning) {
      this.update(primaryIp, port);
      return;
    }

    this.currentPort = port;
    this.currentIp = primaryIp;
    this.domain = domain.toLowerCase();

    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        // Log non-fatal warning so Fastify server continues uninterrupted
        console.warn('mDNS responder network socket notice:', err.message);
      });

      this.socket.on('message', (msg, rinfo) => {
        this.handleQuery(msg, rinfo);
      });

      this.socket.bind(MDNS_PORT, () => {
        if (!this.socket) return;
        try {
          this.socket.addMembership(MDNS_MULTICAST_IPV4);
          this.socket.setMulticastTTL(255);
          this.socket.setMulticastLoopback(true);
          this.isRunning = true;

          // Broadcast unsolicited announcements to prime LAN caches immediately
          this.announce();
          this.announceTimer = setInterval(() => {
            this.announce();
          }, 60000); // Periodic keep-alive announcement every 60s
        } catch (e: any) {
          console.warn('mDNS multicast membership notice:', e.message);
        }
      });
    } catch (err: any) {
      console.warn('Unable to bind mDNS socket (non-fatal):', err.message);
    }
  }

  public update(newIp: string, newPort?: number): void {
    this.currentIp = newIp;
    if (newPort) this.currentPort = newPort;
    this.announce();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
  }

  private announce(): void {
    if (!this.socket || !this.isRunning || this.currentIp === '127.0.0.1') return;

    try {
      const answers = [
        buildARecord(this.domain, this.currentIp),
        buildPtrRecord('_http._tcp.local', `clinic._http._tcp.local`),
        buildSrvRecord(`clinic._http._tcp.local`, this.domain, this.currentPort),
      ];

      const packet = buildDnsPacket(answers);
      this.socket.send(packet, 0, packet.length, MDNS_PORT, MDNS_MULTICAST_IPV4);
    } catch {}
  }

  private handleQuery(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    if (!this.socket || !this.isRunning || this.currentIp === '127.0.0.1') return;
    if (msg.length < 12) return;

    // Check if it's a query (QR bit = 0)
    const flags = msg.readUInt16BE(2);
    if ((flags & 0x8000) !== 0) return; // Ignore responses from other mDNS devices

    const msgLower = msg.toString('binary').toLowerCase();
    const matchesDomain =
      msgLower.includes('clinic\x05local') ||
      msgLower.includes('clinic.local') ||
      msgLower.includes('clinic\x00') ||
      msgLower.includes('_http\x04_tcp');

    if (matchesDomain) {
      try {
        const answers = [
          buildARecord(this.domain, this.currentIp),
          buildPtrRecord('_http._tcp.local', `clinic._http._tcp.local`),
          buildSrvRecord(`clinic._http._tcp.local`, this.domain, this.currentPort),
        ];

        const responsePacket = buildDnsPacket(answers);

        // Send multicast response
        this.socket.send(responsePacket, 0, responsePacket.length, MDNS_PORT, MDNS_MULTICAST_IPV4);

        // Also send direct unicast response if query originated from a non-5353 port
        if (rinfo.port !== MDNS_PORT) {
          this.socket.send(responsePacket, 0, responsePacket.length, rinfo.port, rinfo.address);
        }
      } catch {}
    }
  }
}

export const mdnsService = new MdnsService();
