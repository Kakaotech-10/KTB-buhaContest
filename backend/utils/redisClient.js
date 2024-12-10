const Redis = require('ioredis');
const { redisClusterNodes } = require('../config/keys'); // 여러 노드의 정보가 담긴 환경 변수

class RedisClient {
  constructor() {
    this.cluster = null;
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected && this.cluster) {
      return this.cluster;
    }

    try {
      console.log('Connecting to Redis Cluster...');

      // Redis 클러스터에 연결
      const nodes = redisClusterNodes.split(',').map((node) => {
        const [host, port] = node.split(':');
        return { host, port: Number(port) };
      });

      this.cluster = new Redis.Cluster(nodes, {
        redisOptions: {
          reconnectOnError: (err) => {
            console.error('Redis Cluster reconnecting due to error:', err);
            return true;
          },
          maxRetriesPerRequest: 5,
          enableReadyCheck: true,
          lazyConnect: false,
        },
        slotsRefreshTimeout: 2000,
        slotsRefreshInterval: 10000,
      });

      this.cluster.on('connect', () => {
        console.log('Redis Cluster Connected');
        this.isConnected = true;
      });

      const info = await this.cluster.info();
      console.log('Redis Cluster Info:', info);

      this.cluster.on('error', (err) => {
        console.error('Redis Cluster Error:', err);
        this.isConnected = false;
      });

      return this.cluster;
    } catch (error) {
      console.error('Redis Cluster connection error:', error);
      this.isConnected = false;
      throw error;
    }
  }

  // 데이터 저장 (set)
  async set(key, value, options = {}) {
    try {
      const client = await this.connect();
      let stringValue =
        typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (options.ttl) {
        // ttl 옵션을 설정해서 Redis에 값 저장
        await client.set(key, stringValue, 'EX', options.ttl);
      } else {
        await client.set(key, stringValue);
      }
    } catch (error) {
      console.error('Redis set error:', error);
      throw error;
    }
  }

  // 데이터 가져오기 (get)
  async get(key) {
    try {
      const client = await this.connect();
      const value = await client.get(key);
      if (!value) return null;
      try {
        return JSON.parse(value);
      } catch (e) {
        return value;
      }
    } catch (error) {
      console.error('Redis get error:', error);
      throw error;
    }
  }

  // 데이터 삭제 (del)
  async del(key) {
    try {
      const client = await this.connect();
      return await client.del(key);
    } catch (error) {
      console.error('Redis del error:', error);
      throw error;
    }
  }

  // 클러스터 연결 종료
  async quit() {
    if (this.cluster) {
      try {
        await this.cluster.quit();
        this.isConnected = false;
        this.cluster = null;
        console.log('Redis Cluster connection closed successfully');
      } catch (error) {
        console.error('Redis quit error:', error);
        throw error;
      }
    }
  }
  async expire(key, ttl) {
    try {
      const client = await this.connect();
      // expire 메소드 호출
      return await client.expire(key, ttl);
    } catch (error) {
      console.error('Redis expire error:', error);
      throw error;
    }
  }
}

const redisClient = new RedisClient();
module.exports = redisClient;
