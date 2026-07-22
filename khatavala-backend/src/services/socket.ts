import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';

let io: SocketIOServer | null = null;

export function initSocket(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    socket.on('join-company', (companyId: string) => {
      if (companyId) {
        socket.join(`company:${companyId}`);
      }
    });
  });

  return io;
}

export function emitTenantEvent(companyId: string | object, event: string, payload: any) {
  if (!io) return;
  const cId = typeof companyId === 'object' ? String(companyId) : companyId;
  io.to(`company:${cId}`).emit(event, payload);
}
