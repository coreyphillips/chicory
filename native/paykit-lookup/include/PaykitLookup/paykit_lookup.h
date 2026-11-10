#ifndef CHICORY_PAYKIT_LOOKUP_H
#define CHICORY_PAYKIT_LOOKUP_H

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Look up the public Payment List of a Pubky (NUL-terminated UTF-8).
 * Blocks until the lookup settles, so call it off the main thread.
 *
 * Returns a NUL-terminated JSON envelope, or NULL if it could not be allocated:
 *   {"ok":[{"appId":"...","identifier":"...","payload":"..."}]}
 *   {"error":{"code":"INVALID_PUBKY"|"LOOKUP_FAILED","message":"..."}}
 * Release it with chicory_paykit_free, never with free().
 */
char *chicory_paykit_get_payment_list(const char *pubky);

/* Release an envelope returned by chicory_paykit_get_payment_list. NULL is ignored. */
void chicory_paykit_free(char *envelope);

#ifdef __cplusplus
}
#endif

#endif
