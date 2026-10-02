export interface Channel {
  channel: string;
  updatesRepository: string;
  pubkey: string;
}
export const POINTER_TAG: string;
export const PLATFORM: string;
export function readChannel(path?: string): Channel;
export function validateChannel(channel: Partial<Channel>): Channel;
export function endpointFor(channel: Channel): string;
export function releaseTag(version: string): string;
export function installerName(version: string): string;
export function installerUrl(channel: Channel, version: string): string;
export function parseVersion(version: string): { major: number; minor: number; patch: number; dev: number | null };
export function compareVersions(a: string, b: string): -1 | 0 | 1;
export function assertNewer(version: string, current: { version: string } | null): void;
export function overlayConfig(channel: Channel, version: string): Record<string, unknown>;
export function buildManifest(input: { channel: Channel; version: string; notes?: string; signature: string; pubDate?: string }): Record<string, unknown>;
