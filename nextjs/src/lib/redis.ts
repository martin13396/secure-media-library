import { createClient } from 'redis';

const redis = createClient({
  url: `redis://${process.env.REDIS_HOST || 'redis'}:${process.env.REDIS_PORT || '6379'}`,
  password: process.env.REDIS_PASSWORD || 'redis_password',
});

redis.on('error', (err) => console.error('Redis Client Error', err));

// Connect to Redis
(async () => {
  await redis.connect();
})();

export default redis;