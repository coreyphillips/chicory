import { NativeModules } from 'react-native';

/**
 * A pubky's public Payment List, read by paykit-discovery
 * (github.com/coreyphillips/paykit-discovery). The library owns the registry
 * reads, the endpoint listing, the payload fetches, their order and its
 * resource limits; this file owns only the way to it and the deadline.
 *
 * The lookup reads public data and writes nothing: no identity, session,
 * Keychain item or file is involved. It does show the payer's IP address and
 * the pubky looked up to the PKARR relays and to the payee's homeserver.
 */

/** One published endpoint, as paykit-discovery returns it. */
export interface PaymentEndpoint {
  appId: string;
  identifier: string;
  payload: string;
}

/**
 * The lookup's contract: every public endpoint in the payee's order, an
 * empty list when nothing is published, and a rejection, never a partial
 * list, when the lookup failed.
 */
export type PaymentListLookup = (pubky: string) => Promise<PaymentEndpoint[]>;

/** A lookup that failed, with a code for the diagnostic log. */
export class LookupError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LookupError';
    this.code = code;
  }
}

/**
 * How long a lookup may take. The library bounds its requests, not its
 * time, so one that has not answered by then is a failed lookup.
 */
export const LOOKUP_DEADLINE_MS = 20_000;

/** The native module's answer as records, or a refusal of anything else. */
export function endpointsOf(answer: unknown): PaymentEndpoint[] {
  let list: unknown = answer;
  if (typeof answer === 'string') {
    try {
      list = JSON.parse(answer);
    } catch {
      list = null;
    }
  }
  if (!Array.isArray(list)) {
    throw new LookupError(
      'LOOKUP_MALFORMED',
      'The lookup answer is not a list.',
    );
  }
  return list.map(item => {
    const { appId, identifier, payload } = (item ?? {}) as Record<
      string,
      unknown
    >;
    if (
      typeof appId !== 'string' ||
      typeof identifier !== 'string' ||
      typeof payload !== 'string'
    ) {
      throw new LookupError(
        'LOOKUP_MALFORMED',
        'The lookup answer holds a record that is not an endpoint.',
      );
    }
    return { appId, identifier, payload };
  });
}

/**
 * The production lookup: the upstream Rust crate's `get_payment_list`,
 * bound in native/paykit-lookup and exposed as the `PaykitDiscovery` module.
 * The TypeScript package is not used on the phone, since its Pubky client is
 * WebAssembly and Hermes has none. A build without the module fails the
 * lookup rather than the app.
 */
const native: PaymentListLookup = async pubky => {
  const module:
    | { getPaymentList?: (pubky: string) => Promise<string> }
    | undefined = NativeModules.PaykitDiscovery;
  if (typeof module?.getPaymentList !== 'function') {
    throw new LookupError(
      'LOOKUP_UNAVAILABLE',
      'This build does not include the lookup module.',
    );
  }
  return endpointsOf(await module.getPaymentList(pubky));
};

let current: PaymentListLookup = native;

/** Stands `lookup` in for the native one, or puts it back with null. */
export function setPaymentListLookup(lookup: PaymentListLookup | null) {
  current = lookup ?? native;
}

/**
 * Looks up `pubky`'s public Payment List, failing with `LOOKUP_TIMEOUT` when
 * there is no answer within `deadlineMs`. The call itself is not cancelled:
 * its late answer is dropped.
 */
export function lookupPaymentList(
  pubky: string,
  deadlineMs = LOOKUP_DEADLINE_MS,
): Promise<PaymentEndpoint[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new LookupError('LOOKUP_TIMEOUT', 'The lookup timed out.')),
      deadlineMs,
    );
    Promise.resolve()
      .then(() => current(pubky))
      .then(
        list => {
          clearTimeout(timer);
          resolve(list);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}
