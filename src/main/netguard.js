// Folio — is an address on this computer or a private network? Used before the app fetches a remote image for an export.
import net from 'node:net';
import dns from 'node:dns';

/** true for loopback, private, link-local, unspecified and unique-local addresses (IPv4, IPv6 and IPv4-mapped IPv6) */
export function isPrivateAddress(ip) {
  let a = String(ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (mapped) a = mapped[1];
  if (net.isIPv4(a)) {
    const [p, q] = a.split('.').map(Number);
    return p === 0 || p === 10 || p === 127 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127) || p >= 224;
  }
  if (net.isIPv6(a)) return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a);
  return false;
}
/** throws unless the host is a public address; a name is resolved and every address it gives must be public */
export async function assertPublicHost(hostname, lookup = dns.promises.lookup) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || isPrivateAddress(h)) throw new Error('That address is on a private network.');
  if (net.isIP(h)) return;
  let list; try { list = await lookup(h, { all: true }); } catch { throw new Error('That address could not be found.'); }
  if (!list.length || list.some((x) => isPrivateAddress(x.address))) throw new Error('That address is on a private network.');
}
