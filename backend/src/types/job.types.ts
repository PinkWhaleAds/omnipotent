import type { FastifyInstance } from 'fastify';

/**
 * What a handler knows about the job it runs.
 *
 * @property id - pg-boss job id
 * @property retryCount - How many attempts failed before this one (0 on the first attempt)
 */
export type JobContext = {
  id: string;
  retryCount: number;
};

/**
 * Runs one job. Throwing fails the attempt; pg-boss retries it according to the
 * queue's retry policy.
 *
 * @typeParam T - Payload of the job
 */
export type JobHandler<T> = (data: T, job: JobContext) => Promise<void>;

/**
 * Retry and expiry policy of a queue (a subset of pg-boss queue options).
 *
 * @property policy - How many jobs the queue holds (pg-boss queue policy, set when the queue is created):
 *   `standard` (default) any number, `exclusive` one queued or running at most (a second send is dropped)
 * @property retryLimit - Attempts after the first one before the job is failed
 * @property retryDelay - Seconds before the first retry
 * @property retryBackoff - Whether the delay doubles at each retry
 * @property expireInSeconds - How long one attempt may run before being considered lost
 */
export type JobQueuePolicy = {
  policy?: 'standard' | 'exclusive';
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireInSeconds?: number;
};

/**
 * Declares a job type: its queue, its policy, and how to build its handler.
 *
 * Definitions are listed in `src/jobs/index.ts`. Every process creates the
 * queues (so the API can enqueue); only `worker` processes run the handlers.
 *
 * @typeParam T - Payload of the job
 * @property name - Queue name (`[\w.\-/]`), e.g. `sync.ad-group`
 * @property policy - Retry and expiry policy of the queue
 * @property cron - When set, pg-boss enqueues a job on this schedule (UTC cron expression)
 * @property createHandler - Builds the handler from the Fastify instance (to reach decorated services)
 * @property onWorkerStart - Run once by each worker process after its handler is registered, for example to queue
 *   a first job when its data is missing; a failure is logged, never fatal
 */
export type JobDefinition<T = unknown> = {
  name: string;
  policy?: JobQueuePolicy;
  cron?: string;
  createHandler: (fastify: FastifyInstance) => JobHandler<T>;
  onWorkerStart?: (fastify: FastifyInstance) => Promise<void>;
};
