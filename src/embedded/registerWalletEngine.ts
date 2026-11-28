import { registerCallableModule } from 'react-native';
import { walletHost } from './walletHostNative';
import { failure } from './walletHostProtocol';

// Both hosts evaluate the same signed application bundle. Only the wallet host
// loads the engine, and only the main host mounts the app.
export function registerWalletEngine(
  getHandler: () => (request: string) => Promise<string> = () =>
    require('./walletEngineServer').handleEngineMessage,
) {
  if (walletHost.isEngineRuntime) {
    registerCallableModule('ChicoryWalletEngine', () => ({
      async receive(id: string, request: string) {
        let response: string;
        try {
          response = await getHandler()(request);
        } catch (error) {
          response = failure(error);
        }
        walletHost.reply(id, response);
      },
    }));
    walletHost.ready();
  } else {
    registerCallableModule('ChicoryWalletEvents', () => ({
      receive(session: string, event: string) {
        require('./client').receiveWalletEvent(session, event);
      },
    }));
  }
}
