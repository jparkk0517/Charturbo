/** Share links: source → deflate-raw → base64url (the `#code=` hash; no server involved). */
/** Larger than any example; stops a crafted link from inflating into gigabytes. */
const MAX_BYTES = 1 << 20;

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error('Shared code is too large');
    }
    chunks.push(chunk.value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function encodeShare(source: string): Promise<string> {
  const bytes = await pipe(new TextEncoder().encode(source), new CompressionStream('deflate-raw'));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeShare(encoded: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) throw new Error('Invalid share link');
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(await pipe(bytes, new DecompressionStream('deflate-raw')));
}
