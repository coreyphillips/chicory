import { TurboModuleRegistry } from 'react-native';
import type { TurboModule } from 'react-native';
import { Buffer } from 'buffer';

interface SecureRandomModule extends TurboModule {
  getRandomBase64(byteLength: number): string;
}

/** Native-only CSPRNG: unavailable modules fail closed, including remote debugging. */
export function secureRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0 || length > 65536) {
    throw new Error('Invalid secure random byte count.');
  }
  const native =
    TurboModuleRegistry.getEnforcing<SecureRandomModule>('RNGetRandomValues');
  const bytes = Buffer.from(native.getRandomBase64(length), 'base64');
  if (bytes.length !== length) {
    throw new Error('Native secure randomness returned an invalid result.');
  }
  return new Uint8Array(bytes);
}

/** Hermes does not preserve the Buffer subclass for inherited subarray views. */
export function installNativeBuffer() {
  Buffer.prototype.subarray = function (start?: number, end?: number) {
    const view = Uint8Array.prototype.subarray.call(this, start, end);
    Object.setPrototypeOf(view, Buffer.prototype);
    return view as Buffer;
  };
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

/** Install before evaluating the portable engine bundle. Never use Math.random. */
export function installNativeCrypto() {
  const target = globalThis as unknown as {
    Buffer?: typeof Buffer;
    crypto?: { getRandomValues?: (array: ArrayBufferView) => ArrayBufferView };
  };
  installNativeBuffer();
  // Beignet's invoice parser requires strict UTF-8 (fatal decoding), absent in Hermes.
  const encoding = require('text-encoding');
  Object.assign(globalThis, {
    TextEncoder: encoding.TextEncoder,
    TextDecoder: encoding.TextDecoder,
  });
  target.crypto ??= {};
  target.crypto.getRandomValues = (array: ArrayBufferView) => {
    if (
      !(
        array instanceof Int8Array ||
        array instanceof Uint8Array ||
        array instanceof Uint8ClampedArray ||
        array instanceof Int16Array ||
        array instanceof Uint16Array ||
        array instanceof Int32Array ||
        array instanceof Uint32Array
      )
    ) {
      throw new TypeError('Secure randomness requires an integer typed array.');
    }
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(
      secureRandomBytes(array.byteLength),
    );
    return array;
  };
}
