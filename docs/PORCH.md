# Porch link as a primary node

A node hosted behind a Porch relay (Beignet 0.39.0 and later, coreyphillips/beignet#1980) hands out a link of this form:

```
<node key>@wss://<relay>[:port]/v1/p/<route id>
```

The node has no address of its own in the link. It dials out to the relay and waits there, and the phone dials the relay and is joined to it. Chicory takes such a link where it takes a primary node address: pasted or scanned in Settings, and as a new wallet's primary.

## What the app does with it

- Only this one shape of WebSocket address is a link: `wss://`, the path `/v1/p/` and a route id of 32 characters. `ws://` is taken for a loopback or private network relay only. Credentials, a query, a fragment, anything after the route id and an onion relay host are refused where the link is entered.
- Native networking is required. Relay networking carries the engine's sockets to one fixed upstream, which cannot reach another relay, so a wallet with a Porch primary does not open under it and says to select Native.
- No Tor fallback is offered. That field belongs to an Iroh address.
- The dial runs through the app's own sockets, as Electrum over TLS does: the engine's WebSocket client on the native socket module, not React Native's `WebSocket`. Tests under Node and the app on a device therefore run the same client.
- The list in Settings names the node by its relay (`wss://relay.example`), without the route id. The opened row shows the whole link and copies it as it is.

## Who sees what

The form in Settings says this before a link is saved.

- The relay sees the phone's IP address, when it connects and how much it sends. The app dials the relay directly: only onion hosts go through Tor, and a Porch relay cannot be an onion host here.
- The relay does not see what is sent. The Lightning transport is encrypted between the phone and the node.
- The node does not see the phone's IP address. It sees which of its links was used.

A device whose whole connection runs through a VPN or Tor is hidden from the relay whatever the app does.

## Checked on 2026-11-12

Both native builds ran the isolated regtest fixture against a Beignet 0.39.0 node with no Lightning listener, waiting at a Porch relay on the same Mac's loopback. The link was `ws://127.0.0.1:31080/v1/p/<route id>`.

|                                                                           | Android emulator | iOS simulator |
| ------------------------------------------------------------------------- | ---------------- | ------------- |
| Wallet created with the link as its only primary, peer transport          | `ws`             | `ws`          |
| The node names the relay the phone came in by                             | yes              | yes           |
| Channel opened by the node on that connection                             | usable           | usable        |
| Payments both ways: at first, after an app restart, after a relay restart | completed        | completed     |
| Back through a restarted relay with no action on the phone                | yes              | yes           |

Not run:

- `wss://` to a relay with a publicly trusted certificate, on a device. The loopback relay speaks plain WebSocket, so the TLS half of the dial was exercised under Node only (the engine's tests, and the portable engine's test of a `wss://` dial through a recording host adapter).
- A physical device, and a cellular network.

To repeat it, use only the disposable regtest fixture, with the local `bitcoin` and `electrum` development containers. Start the helper in place of `iroh-primary.cjs` and build and launch the fixture as [IROH.md](IROH.md) describes. Success prints `PORCH_QUALIFICATION`.

```sh
BEIGNET_SOURCE_DIR=/path/to/built/beignet node native-tests/porch-primary.cjs
```

The helper starts the relay on port 31080 (`PORCH_RELAY_PORT` changes it) and its control server on 31079. An Android emulator needs the relay's port as well as the other two:

```sh
adb reverse tcp:31079 tcp:31079 && adb reverse tcp:60001 tcp:60001 && adb reverse tcp:31080 tcp:31080
```
