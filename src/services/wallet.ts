import type { WalletClientInterface } from '@beignet/wallet-core';
import type { PaymentNoteStore } from './paymentNotes';

// Both the in-process engine and authenticated host implement this contract.
export type WalletAdapter = WalletClientInterface & {
  /** Private metadata lives in the device vault and never goes through a payment API. */
  openPaymentNotes?: () => PaymentNoteStore;
};
