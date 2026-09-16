// Type and framework host bridge for sibling transport packages. Keeping framework
// resolution inside this service avoids duplicate dependency installations.
export type { FastifyInstance, FastifyRequest } from 'fastify';
export { default as Fastify } from 'fastify';
export { default as cors } from '@fastify/cors';
export { default as rateLimit } from '@fastify/rate-limit';
