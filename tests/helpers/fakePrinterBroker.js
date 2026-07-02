import { Aedes } from 'aedes';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/**
 * In-process stand-in for a Bambu printer's MQTT endpoint: an aedes broker
 * behind TLS with a self-signed cert (the client connects with
 * rejectUnauthorized:false, exactly like against real printer firmware).
 */
export async function startFakePrinter({ serial = 'TESTSERIAL0001' } = {}) {
  const broker = await Aedes.createBroker();
  const sockets = new Set();
  const requests = [];

  const server = tls.createServer(
    {
      key: fs.readFileSync(path.join(FIXTURES, 'test-key.pem')),
      cert: fs.readFileSync(path.join(FIXTURES, 'test-cert.pem')),
    },
    (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      broker.handle(socket);
    }
  );

  broker.subscribe(`device/${serial}/request`, (packet, done) => {
    try { requests.push(JSON.parse(packet.payload.toString())); } catch { /* ignore */ }
    done();
  }, () => {});

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    port,
    serial,
    requests, // pushall etc. received from the client under test

    publishReport(payload) {
      return new Promise((resolve) =>
        broker.publish(
          { topic: `device/${serial}/report`, payload: Buffer.from(JSON.stringify(payload)), qos: 0, retain: false, cmd: 'publish', dup: false },
          resolve
        )
      );
    },

    /** Abruptly severs all live connections and stops listening — models a printer losing power. */
    async kill() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => broker.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    },

    async stop() {
      for (const socket of sockets) socket.end();
      await new Promise((resolve) => broker.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
