/**
 * Settings and the setup surfaces, which may keep short text on screen
 * (REDESIGN.md rule 2): Settings itself, the recovery phrase, the new wallet
 * sheet with restore entry, first-run network setup and diagnostics. Their
 * words are here whether they are shown or spoken, trimmed to what a person
 * needs to act, with every safety line kept whole.
 *
 * Phrases the suites look controls up by are kept verbatim, and a few that
 * another area also says (the picker's) are repeated here rather than shared.
 */
export const settings = {
  /** What a screen reader calls the Settings scene, and its title. */
  title: 'Settings',
  /** Said of a test network wherever one can be chosen. */
  testNetwork: (network: string) =>
    `${network} is a test network. Its coins have no value.`,

  wallet: {
    heading: 'Wallet',
    name: 'Name',
    /** A network is chosen but not yet switched to. */
    switchNote: (target: string) =>
      `${target} keeps its own balance and history. Same recovery phrase.`,
    switchTo: (target: string) => `Switch to ${target}`,
    servers: 'Network & servers',
    serversLabel: 'Change network or Bitcoin server',
    chooseAnother: 'Choose another wallet',
    lock: 'Lock device wallet',
  },

  recovery: {
    heading: 'Recovery phrase',
    /** The heading while the phrase is still to be saved. */
    pending: 'Save your recovery phrase.',
    intro:
      'Write these words down in order and keep them somewhere private. Anyone with the phrase can take your funds.',
    reveal: 'Reveal recovery phrase',
    revealing: 'Waiting for confirmation',
    prompt: 'Confirm to reveal your recovery phrase',
    refused: 'The recovery phrase stays hidden until this is confirmed.',
    unavailable:
      'Recovery phrase is unavailable. Open your host dashboard to check backups.',
    unreadable: 'Could not read the phrase.',
    watchers:
      'Make sure nobody is looking over your shoulder or recording your screen.',
    channels:
      'Keep your wallet’s current channel state too. The recovery phrase alone does not restore active Lightning channels.',
    hide: 'Hide phrase',
    saved: 'I saved my recovery phrase',
    savedHint: 'Hold to confirm.',
    savedDone: 'Recovery phrase saved.',
    word: (position: number, word: string) => `${position}. ${word}`,
  },

  primary: {
    heading: 'Primary node',
    connected: 'Connected',
    connecting: 'Connecting',
    setup: 'Setup',
    /** No setup reported yet. */
    waiting: 'Waiting',
    /** Where the setup is, in words rather than the engine's own value. */
    setupPending: 'Setting up',
    setupReady: 'Ready',
    setupFailed: 'Failed',
    address: 'Node address',
    none: 'No primary configured',
    copy: 'Copy node address',
    copied: 'Node address copied',
    change: 'Change primary node',
    save: 'Save primary node',
    cancel: 'Cancel',
    keeps:
      'Existing channels and funds stay. The new node is trusted for instant funding.',
    retry: 'Retry connection',
    saving: 'Saving your primary node…',
    reconnecting: 'Reconnecting…',
    updated: 'Primary node updated. Existing channels remain available.',
    notReconnected:
      'Primary node saved. Your wallet has not reconnected to it yet; existing channels remain available.',
    retried: 'Connection setup requested. Your wallet will update shortly.',
  },

  phone: {
    heading: 'This phone',
    require: (name: string) => `Require ${name}`,
    requireLabel: (name: string) => `Require ${name} to open this wallet`,
    noLock: 'No biometric or passcode lock is available on this device.',
    lockFailed: 'Could not change the lock.',
    haptics: 'Haptics',
    hapticsFailed: 'Could not save the haptics setting.',
  },

  diagnostics: {
    heading: 'Diagnostics',
    hint: 'Shows what the wallet reports about itself.',
    errors: 'Recent errors',
    report: 'Wallet report',
    loading: 'Reading the wallet report',
    unreadable: 'Could not read diagnostics.',
    refresh: 'Refresh',
    copy: 'Copy',
    copied: 'Diagnostics copied',
  },

  erase: {
    link: 'Erase wallet from this phone',
    warning:
      "Deletes this wallet's keys, channel state and history from this phone, on every network. Without the recovery phrase and current channel state, funds are lost.",
    confirm: 'Erase wallet',
    prompt: 'Confirm to erase this wallet',
    unconfirmed: 'The wallet was not erased because this was not confirmed.',
    failed: 'Could not erase the wallet.',
    keep: 'Keep my wallet',
  },

  about: {
    app: (version: string) => `Chicory ${version}`,
    engine: (version: string) => `Engine ${version}`,
  },

  /** The saved wallets, for the picker. Only their names are shown. */
  picker: {
    choose: 'Choose your wallet.',
    empty: 'Create a wallet.',
    open: (name: string) => `Open ${name}`,
    openHint: 'Starts this wallet and opens it.',
    status: (network: string, status: string) => `${network}, ${status}`,
    create: 'Create a wallet',
    opening: 'Opening wallet…',
  },

  /** The new wallet sheet: create, restore, and the phrase to save. */
  create: {
    title: 'New wallet',
    restoreTitle: 'Restore a wallet',
    restoreNote:
      'A phrase restores keys and on-chain funds, not Lightning channel state.',
    phrase: 'Recovery phrase',
    phraseHint: '12 or 24 words, separated by spaces',
    words: 'Recovery phrase words',
    wordCount: (count: number) =>
      `${count} words so far. A phrase has 12 or 24.`,
    wordsReady: (count: number) => `${count} words.`,
    name: 'Wallet name',
    defaultName: 'Everyday wallet',
    network: 'Network',
    primary: 'Primary node',
    reuses: (source: string) =>
      `Uses the same recovery phrase as your ${source} wallet.`,
    mainnet:
      'This creates a real mainnet wallet. The primary node is trusted for instant funding.',
    testnet: 'Use a primary node on this test network.',
    server: 'Bitcoin server',
    deviceServer: 'Device setting',
    unreadableConfig: "Could not read this wallet's server settings.",
    create: (network: string) => `Create ${network} wallet`,
    restore: (network: string) => `Restore ${network} wallet`,
    toRestore: 'I already have a recovery phrase',
    toCreate: 'Create a new wallet instead',
    createFailed: 'Could not create the wallet.',
    restoreFailed: 'Could not restore the wallet.',
    openFailed: 'Could not open the wallet.',
    created: 'Wallet created.',
    sharedPhrase: (network: string, source: string) =>
      `Your ${network} wallet uses the same recovery phrase as your ${source} wallet. A phrase does not restore Lightning channel state.`,
    openNetwork: (network: string) => `Open ${network} wallet`,
    open: 'Open wallet',
  },

  /** The network editor, in Settings and at first run. */
  network: {
    title: 'Network settings',
    select: (network: string) => `Select ${network}`,
    reuses: (network: string, source: string) =>
      `A new ${network} wallet reuses the recovery phrase from your ${source} wallet. An existing ${network} wallet keeps its own phrase.`,
    server: 'Default Electrum server',
    serverHint: 'Server for this network',
    port: 'Default Electrum port',
    tls: 'TLS encryption',
    tlsLabel: 'Default Electrum TLS',
    primary: 'Default primary node',
    primaryHint: 'A node on this network',
    relay: 'Use a transport relay',
    relayLabel: 'Use transport relay',
    relayAddress: 'Relay address',
    relayToken: 'Relay token',
    save: 'Save network settings',
    use: (network: string) => `Use ${network}`,
    loading: 'Loading saved network settings…',
    failed: 'Could not change networks.',
  },
};
