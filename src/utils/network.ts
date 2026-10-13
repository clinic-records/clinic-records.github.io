import os from 'node:os';
import net from 'node:net';
import QRCode from 'qrcode';

export interface NetworkInfo {
  lanUrl: string;
  ip: string;
  port: number;
  qrCodeDataUrl: string;
  allLanIps: string[];
}

/**
 * Discovers local network IPv4 addresses (LAN)
 */
export function getLocalLanIps(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name];
    if (!ifaceList) continue;

    for (const iface of ifaceList) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }

  // Sort: prioritize 192.168.x.x, then 10.x.x.x, then 172.x.x.x
  ips.sort((a, b) => {
    if (a.startsWith('192.168.') && !b.startsWith('192.168.')) return -1;
    if (!a.startsWith('192.168.') && b.startsWith('192.168.')) return 1;
    return 0;
  });

  return ips;
}

/**
 * Finds next available port if default port is occupied
 */
export async function findAvailablePort(startPort: number, host = '0.0.0.0'): Promise<number> {
  let port = startPort;
  const maxTries = 50;

  for (let i = 0; i < maxTries; i++) {
    const isFree = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.unref();

      server.on('error', () => {
        resolve(false);
      });

      server.listen(port, host, () => {
        server.close(() => {
          resolve(true);
        });
      });
    });

    if (isFree) return port;
    port++;
  }

  return startPort;
}

/**
 * Prepares network details with LAN IP and QR Code
 */
export async function getNetworkDetails(port: number): Promise<NetworkInfo> {
  const ips = getLocalLanIps();
  const primaryIp = ips[0] || '127.0.0.1';
  const lanUrl = `http://${primaryIp}:${port}`;

  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(lanUrl, {
      width: 320,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    });
  } catch (err) {
    console.error('Failed to generate QR code:', err);
  }

  return {
    lanUrl,
    ip: primaryIp,
    port,
    qrCodeDataUrl,
    allLanIps: ips,
  };
}
