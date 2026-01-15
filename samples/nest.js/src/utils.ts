import { FastifyRequest } from 'fastify';

export function isAdmin(req: FastifyRequest) {
  const adminHeader = req.headers['x-admin'];
  return adminHeader === '1' || adminHeader === 'true';
}
