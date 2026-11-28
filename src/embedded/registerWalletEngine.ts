import { registerCallableModule } from 'react-native';
import { walletHost } from './walletHostNative';

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
        } catch {
          // An uncaught exception may follow an already committed payment.
          response = JSON.stringify({ replyLost: true });
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
