import { createSocket } from "node:dgram";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { XMLParser } from "fast-xml-parser";

const MULTICAST_ADDR = "239.255.255.250";
const MULTICAST_PORT = 3702;

export interface DiscoveredDevice {
  /** IP address (one of the XAddrs hosts) */
  address: string;
  /** ONVIF service URLs returned in XAddrs */
  xaddrs: string[];
  /** Manufacturer/model scopes parsed from device response */
  scopes: string[];
  /** Friendly identifier (best-effort) */
  name?: string;
  manufacturer?: string;
  model?: string;
  /** Raw EndpointReference UUID */
  endpoint?: string;
}

function probeMessage(): string {
  const id = randomUUID();
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" ` +
    `xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" ` +
    `xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" ` +
    `xmlns:dn="http://www.onvif.org/ver10/network/wsdl">` +
    `<s:Header>` +
    `<a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>` +
    `<a:MessageID>uuid:${id}</a:MessageID>` +
    `<a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>` +
    `</s:Header>` +
    `<s:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></s:Body>` +
    `</s:Envelope>`
  );
}

function localBroadcastInterfaces(): string[] {
  const nets = networkInterfaces();
  const addrs: string[] = [];
  for (const list of Object.values(nets)) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) {
        addrs.push(ni.address);
      }
    }
  }
  return addrs;
}

function parseScopes(scopes: string): string[] {
  return scopes
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function deriveNameFromScopes(scopes: string[]): {
  name?: string;
  manufacturer?: string;
  model?: string;
} {
  // ONVIF scope examples:
  //   onvif://www.onvif.org/name/AXIS%20M3045-V
  //   onvif://www.onvif.org/hardware/M3045-V
  //   onvif://www.onvif.org/Profile/Streaming
  //   onvif://www.onvif.org/manufacturer/AXIS
  const out: { name?: string; manufacturer?: string; model?: string } = {};
  for (const s of scopes) {
    const m = /onvif:\/\/[^/]+\/(name|hardware|manufacturer)\/(.+)$/i.exec(s);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = decodeURIComponent(m[2]!.replace(/\+/g, " "));
    if (key === "name") out.name = value;
    else if (key === "manufacturer") out.manufacturer = value;
    else if (key === "hardware") out.model = value;
  }
  return out;
}

function parseResponse(xml: string): Omit<DiscoveredDevice, "address"> | null {
  try {
    const parser = new XMLParser({
      ignoreAttributes: true,
      removeNSPrefix: true,
      parseTagValue: false,
    });
    const doc = parser.parse(xml) as Record<string, unknown>;
    const env =
      (doc.Envelope as Record<string, unknown> | undefined) ??
      (doc as Record<string, unknown>);
    const body = (env.Body ?? env.body) as Record<string, unknown> | undefined;
    if (!body) return null;
    const matches = body.ProbeMatches as Record<string, unknown> | undefined;
    if (!matches) return null;
    let match = matches.ProbeMatch as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined;
    if (!match) return null;
    if (Array.isArray(match)) match = match[0];
    if (!match) return null;

    const xaddrsRaw =
      (match.XAddrs as string | undefined) ?? (match.xaddrs as string | undefined) ?? "";
    const xaddrs = xaddrsRaw.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    const scopesRaw = (match.Scopes as string | undefined) ?? "";
    const scopes = parseScopes(scopesRaw);
    const epRef = match.EndpointReference as
      | Record<string, unknown>
      | undefined;
    const endpoint = epRef?.Address as string | undefined;

    return {
      xaddrs,
      scopes,
      ...(endpoint ? { endpoint } : {}),
      ...deriveNameFromScopes(scopes),
    };
  } catch {
    return null;
  }
}

function hostFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return null;
  }
}

/**
 * Send a WS-Discovery Probe and collect ONVIF NetworkVideoTransmitter
 * responders for `timeoutMs`. Cross-platform, no external dependency on
 * the abandoned `onvif` npm package.
 */
export async function discoverOnvifDevices(
  timeoutMs = 3000,
): Promise<DiscoveredDevice[]> {
  const ifaces = localBroadcastInterfaces();
  const found = new Map<string, DiscoveredDevice>();

  await Promise.all(
    ifaces.map(
      (ifaceAddr) =>
        new Promise<void>((resolve) => {
          const socket = createSocket({ type: "udp4", reuseAddr: true });
          let settled = false;

          const finalize = () => {
            if (settled) return;
            settled = true;
            try {
              socket.close();
            } catch {}
            resolve();
          };

          socket.on("error", () => finalize());
          socket.on("message", (msg, rinfo) => {
            const parsed = parseResponse(msg.toString("utf8"));
            if (!parsed) return;
            const host = hostFromUrl(parsed.xaddrs[0] ?? "") ?? rinfo.address;
            const existing = found.get(host);
            if (existing) {
              // Merge xaddrs from multiple interfaces
              const merged = new Set([...existing.xaddrs, ...parsed.xaddrs]);
              existing.xaddrs = [...merged];
              return;
            }
            found.set(host, { address: host, ...parsed });
          });

          socket.bind({ address: ifaceAddr, port: 0 }, () => {
            try {
              socket.setBroadcast(true);
              socket.setMulticastTTL(1);
              socket.setMulticastInterface(ifaceAddr);
            } catch {
              // some interfaces don't support multicast; just unicast probe
            }
            const probe = Buffer.from(probeMessage(), "utf8");
            socket.send(probe, 0, probe.length, MULTICAST_PORT, MULTICAST_ADDR);
          });

          setTimeout(finalize, timeoutMs);
        }),
    ),
  );

  return [...found.values()].sort((a, b) =>
    a.address.localeCompare(b.address, undefined, { numeric: true }),
  );
}
