import { DEFAULT_UNO_PORT } from './uno/lan';
import { RoomServer } from './uno/roomServer';
import {
  generateRoomToken,
  isValidBindHost,
  isValidPublicHost,
} from './uno/urlAuth';

async function main(): Promise<void> {
  const portRaw = process.env.PORT?.trim();
  const port = portRaw ? Number(portRaw) : DEFAULT_UNO_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid PORT: ${portRaw}`);
    process.exit(1);
  }

  const bindRaw = (process.env.BIND_HOST ?? '0.0.0.0').trim();
  if (!isValidBindHost(bindRaw)) {
    console.error(`Invalid BIND_HOST: ${bindRaw}`);
    process.exit(1);
  }
  const bindHost = bindRaw;

  const publicRaw = (process.env.PUBLIC_HOST ?? process.env.JOIN_HOST ?? '').trim();
  let publicHost: string | undefined;
  if (publicRaw) {
    if (!isValidPublicHost(publicRaw)) {
      console.error(`Invalid PUBLIC_HOST: ${publicRaw}`);
      process.exit(1);
    }
    publicHost = publicRaw;
  }

  const tokenEnv = process.env.ROOM_TOKEN?.trim();
  const roomToken = tokenEnv && tokenEnv.length > 0 ? tokenEnv : generateRoomToken();
  const tokenFromEnv = Boolean(tokenEnv && tokenEnv.length > 0);

  const server = await RoomServer.start({
    port,
    bindHost,
    persistent: true,
    publicHost,
    roomToken,
  });

  console.log(`Anshin UNO room listening on ${bindHost}:${server.getPort()}`);
  console.log(`Join URL: ${server.getJoinUrl()}`);
  if (publicHost) {
    console.log(`PUBLIC_HOST: ${publicHost}`);
  }
  if (!tokenFromEnv) {
    console.log(`ROOM_TOKEN (generated): ${server.getRoomToken()}`);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down…`);
    try {
      await server.dispose();
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
