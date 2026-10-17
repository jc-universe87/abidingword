// Whether an address is on this computer (text sent there does not leave it).
// The same rule as the core (src-tauri/src/assistant/config.rs): the address is
// parsed as the request will be, and only "localhost" or a loopback address
// counts, so look-alikes ("127.0.0.1.example.com", "localhost@elsewhere") do not.
export function isLocalAddress(address: string): boolean {
  let host: string;
  try {
    host = new URL(address).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host === "[::1]") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}
