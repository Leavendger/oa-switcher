/** 复制为独立 ArrayBuffer，满足 Web Crypto BufferSource 的严格类型（避免 SharedArrayBuffer）。 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
