import { NativeModules } from 'react-native';

interface NativeWalletHost {
  isEngineRuntime: boolean;
  dispatch(request: string): Promise<string>;
  ready(): void;
  claimTorStart(): boolean;
  reply(id: string, response: string): void;
  notify(session: string, event: string): void;
}
export const walletHost = NativeModules.ChicoryWalletHost as NativeWalletHost;
