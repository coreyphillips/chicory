/** The shell phases: the lock, opening, closing and the ways back in. */
export const phase = {
  locked: 'Locked',
  unlock: 'Unlock',
  lockRefused: 'Chicory stays locked until this is confirmed.',
  opening: 'Opening…',
  closing: 'Closing your wallet…',
  switching: (network: string | null) =>
    `Closing this wallet and opening ${network || 'the selected network'}…`,
  erasing: 'Erasing your wallet from this phone…',
  saved: 'This wallet is still on your phone. It could not be opened just now.',
  openDevice: 'Open device wallet',
  offline: 'Balances are unavailable until the connection is restored.',
  retryConnection: 'Retry connection',
  retrySetup: 'Retry wallet setup',
  retrySetupHint: 'Asks the wallet to run its Lightning setup again.',
  chooseWallet: 'Choose another wallet',
  lockDevice: 'Lock device wallet',
  createWallet: 'Create a wallet',
  restore: 'Restore from recovery phrase',
  networkSettings: 'Network settings',
  tryAgain: 'Try again',
  openWallet: (name: string) => `Open ${name}`,
};
