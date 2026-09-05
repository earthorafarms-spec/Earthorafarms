// Type-only host bridge for sibling transport packages. Keeping framework type
// resolution inside this service avoids duplicate dependency installations.
export type { FastifyInstance, FastifyRequest } from 'fastify';
