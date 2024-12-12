const redisClientInstance = require('../utils/redisClient'); // 이름을 바꿔서 중복 피하기
const crypto = require('crypto');

class SessionService {
  static SESSION_TTL = 24 * 60 * 60; // 24 hours
  static SESSION_PREFIX = 'session:';
  static SESSION_ID_PREFIX = 'sessionId:';
  static USER_SESSIONS_PREFIX = 'user_sessions:';
  static ACTIVE_SESSION_PREFIX = 'active_session:';

  // 안전한 JSON 직렬화
  static safeStringify(data) {
    try {
      if (typeof data === 'string') return data;
      return JSON.stringify(data);
    } catch (error) {
      console.error('JSON stringify error:', error);
      return '';
    }
  }

  // 안전한 JSON 파싱
  static safeParse(data) {
    try {
      if (!data) return null;
      if (typeof data === 'object') return data;
      if (typeof data !== 'string') return null;

      // 이미 객체인 경우 즉시 반환
      if (data === '[object Object]') return null;

      return JSON.parse(data);
    } catch (error) {
      console.error('JSON parse error:', error);
      return null;
    }
  }

  // Redis에 데이터 저장 전 JSON 문자열로 변환
  static async setJson(key, value, ttl) {
    try {
      const jsonString = this.safeStringify(value);
      if (!jsonString) {
        console.error('Failed to stringify value:', value);
        return false;
      }
      // 세션 데이터를 Redis에 저장하는 로직
      if (ttl) {
        await redisClientInstance.set(key, jsonString, 'EX', ttl);
      } else {
        await redisClientInstance.set(key, jsonString);
      }

      return true;
    } catch (error) {
      console.error('Redis setJson error:', error);
      return false;
    }
  }

  // Redis에서 데이터를 가져와서 JSON으로 파싱
  static async getJson(key) {
    try {
      const value = await redisClientInstance.get(key);
      return this.safeParse(value);
    } catch (error) {
      console.error('Redis getJson error:', error);
      return null;
    }
  }

  static async createSession(userId, metadata = {}) {
    try {
      // 기존 세션들 모두 제거
      await this.removeAllUserSessions(userId);

      const sessionId = this.generateSessionId();
      const sessionData = {
        userId,
        sessionId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        metadata: {
          userAgent: metadata.userAgent || '',
          ipAddress: metadata.ipAddress || '',
          deviceInfo: metadata.deviceInfo || '',
          ...metadata,
        },
      };

      const sessionKey = this.getSessionKey(userId);
      const sessionIdKey = this.getSessionIdKey(sessionId);
      const userSessionsKey = this.getUserSessionsKey(userId);
      const activeSessionKey = this.getActiveSessionKey(userId);

      // 세션 데이터 저장
      const saved = await this.setJson(
        sessionKey,
        sessionData,
        this.SESSION_TTL
      );
      console.log('Session saved:', sessionKey, sessionData);
      if (!saved) {
        throw new Error('세션 데이터 저장에 실패했습니다.');
      }

      // 세션 ID 매핑 저장 - 문자열 값은 직접 저장
      await redisClientInstance.set(
        sessionIdKey,
        this.SESSION_TTL,
        userId.toString()
      );
      await redisClientInstance.set(
        userSessionsKey,
        this.SESSION_TTL,
        sessionId
      );
      await redisClientInstance.set(
        activeSessionKey,
        sessionId, // 세션 ID 저장
        'EX', // TTL 옵션
        this.SESSION_TTL // TTL 값
      );

      return {
        sessionId,
        expiresIn: this.SESSION_TTL,
        sessionData,
      };
    } catch (error) {
      console.error('Session creation error:', error);
      throw new Error('세션 생성 중 오류가 발생했습니다.');
    }
  }

  static async validateSession(userId, sessionId) {
    try {
      if (!userId || !sessionId) {
        return {
          isValid: false,
          error: 'INVALID_PARAMETERS',
          message: '유효하지 않은 세션 파라미터',
        };
      }

      // 활성 세션 확인
      const activeSessionKey = this.getActiveSessionKey(userId);
      const activeSessionId = await redisClientInstance.get(activeSessionKey);

      if (!activeSessionId || activeSessionId !== sessionId) {
        console.log('Session validation failed:', {
          userId,
          sessionId,
          activeSessionId,
        });
        return {
          isValid: false,
          error: 'INVALID_SESSION',
          message: '다른 기기에서 로그인되어 현재 세션이 만료되었습니다.',
        };
      }

      // 세션 데이터 검증
      const sessionKey = this.getSessionKey(userId);
      const sessionData = await this.getJson(sessionKey);

      if (!sessionData) {
        return {
          isValid: false,
          error: 'SESSION_NOT_FOUND',
          message: '세션을 찾을 수 없습니다.',
        };
      }

      // 세션 만료 시간 검증
      const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24시간
      if (Date.now() - sessionData.lastActivity > SESSION_TIMEOUT) {
        await this.removeSession(userId);
        return {
          isValid: false,
          error: 'SESSION_EXPIRED',
          message: '세션이 만료되었습니다.',
        };
      }

      // 세션 데이터 갱신
      sessionData.lastActivity = Date.now();

      // 갱신된 세션 데이터 저장
      const updated = await this.setJson(
        sessionKey,
        sessionData,
        this.SESSION_TTL
      );
      console.error('updateLastActivity: Failed to update session data');
      if (!updated) {
        return {
          isValid: false,
          error: 'UPDATE_FAILED',
          message: '세션 갱신에 실패했습니다.',
        };
      }

      // 관련 키들의 만료 시간 갱신
      await Promise.all([
        redisClientInstance.expire(activeSessionKey, this.SESSION_TTL),
        redisClientInstance.expire(
          this.getUserSessionsKey(userId),
          this.SESSION_TTL
        ),
        redisClientInstance.expire(
          this.getSessionIdKey(sessionId),
          this.SESSION_TTL
        ),
      ]);

      return {
        isValid: true,
        session: sessionData,
      };
    } catch (error) {
      console.error('Session validation error:', error);
      return {
        isValid: false,
        error: 'VALIDATION_ERROR',
        message: '세션 검증 중 오류가 발생했습니다.',
      };
    }
  }

  static async removeSession(userId, sessionId = null) {
    try {
      const userSessionsKey = this.getUserSessionsKey(userId);
      const activeSessionKey = this.getActiveSessionKey(userId);

      if (sessionId) {
        const currentSessionId = await redisClientInstance.get(userSessionsKey);
        if (currentSessionId === sessionId) {
          await Promise.all([
            redisClientInstance.del(this.getSessionKey(userId)),
            redisClientInstance.del(this.getSessionIdKey(sessionId)),
            redisClientInstance.del(userSessionsKey),
            redisClientInstance.del(activeSessionKey),
          ]);
        }
      } else {
        const storedSessionId = await redisClientInstance.get(userSessionsKey);
        if (storedSessionId) {
          await Promise.all([
            redisClientInstance.del(this.getSessionKey(userId)),
            redisClientInstance.del(this.getSessionIdKey(storedSessionId)),
            redisClientInstance.del(userSessionsKey),
            redisClientInstance.del(activeSessionKey),
          ]);
        }
      }
    } catch (error) {
      console.error('Session removal error:', error);
      throw error;
    }
  }

  static async removeAllUserSessions(userId) {
    try {
      const activeSessionKey = this.getActiveSessionKey(userId);
      const userSessionsKey = this.getUserSessionsKey(userId);
      const sessionId = await redisClientInstance.get(userSessionsKey);

      const deletePromises = [
        redisClientInstance.del(activeSessionKey),
        redisClientInstance.del(userSessionsKey),
      ];

      if (sessionId) {
        deletePromises.push(
          redisClientInstance.del(this.getSessionKey(userId)),
          redisClientInstance.del(this.getSessionIdKey(sessionId))
        );
      }

      await Promise.all(deletePromises);
      return true;
    } catch (error) {
      console.error('Remove all user sessions error:', error);
      return false;
    }
  }

  static async updateLastActivity(userId) {
    try {
      const sessionKey = this.getSessionKey(userId);
      const sessionData = await this.getJson(sessionKey);
      if (!sessionData) throw new Error(`No session found for user ${userId}`);

      // 세션 갱신
      sessionData.lastActivity = Date.now();
      const updated = await this.setJson(
        sessionKey,
        sessionData,
        this.SESSION_TTL
      );
      if (!updated) throw new Error('Failed to update session data');

      // TTL 갱신
      await Promise.all([
        redisClientInstance.expire(
          this.getActiveSessionKey(userId),
          this.SESSION_TTL
        ),
        redisClientInstance.expire(
          this.getUserSessionsKey(userId),
          this.SESSION_TTL
        ),
      ]);
      return true;
    } catch (error) {
      console.error(`Update last activity error: ${error.message}`);
      return false;
    }
  }

  static async getActiveSession(userId) {
    try {
      if (!userId) {
        console.error('getActiveSession: userId is required');
        return null;
      }

      const activeSessionKey = this.getActiveSessionKey(userId);
      const sessionId = await redisClientInstance.get(activeSessionKey);

      if (!sessionId) {
        return null;
      }

      const sessionKey = this.getSessionKey(userId);
      const sessionData = await this.getJson(sessionKey);

      if (!sessionData) {
        await redisClientInstance.del(activeSessionKey);
        return null;
      }

      return {
        ...sessionData,
        userId,
        sessionId,
      };
    } catch (error) {
      console.error('Get active session error:', error);
      return null;
    }
  }

  static getSessionKey(userId) {
    return `${this.SESSION_PREFIX}${userId}`;
  }

  static getSessionIdKey(sessionId) {
    return `${this.SESSION_ID_PREFIX}${sessionId}`;
  }

  static getUserSessionsKey(userId) {
    return `${this.USER_SESSIONS_PREFIX}${userId}`;
  }

  static getActiveSessionKey(userId) {
    return `${this.ACTIVE_SESSION_PREFIX}${userId}`;
  }

  static generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
  }
}

module.exports = SessionService;
