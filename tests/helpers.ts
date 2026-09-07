import crypto from 'crypto';
import net from 'net';

/** A TCP port nothing is listening on right now. */
export function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address() as net.AddressInfo;
			server.close(() => resolve(address.port));
		});
	});
}

export async function waitFor(
	cond: () => boolean,
	label: string,
	timeoutMs = 15_000
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!cond()) {
		if (Date.now() > deadline)
			throw new Error(`Timed out waiting for ${label}`);
		await new Promise((r) => setTimeout(r, 20));
	}
}

export function sha(...parts: Array<string | Buffer>): Buffer {
	const h = crypto.createHash('sha256');
	for (const p of parts) h.update(p);
	return h.digest();
}
