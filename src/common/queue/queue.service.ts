import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';

export interface AiJobPayload {
  jobType: 'ANALYZE_AND_DRAFT_REPLY' | 'SCORE_LEAD' | 'EXTRACT_INFO' | 'CLASSIFY_INTENT';
  leadId: string;
  conversationId: string;
  messageId: string;
  language: string;
  contextWindow?: number;
  promptVersion?: string;
}

export interface FollowupJobPayload {
  followupId: string;
  leadId: string;
  conversationId: string;
  attemptNumber: number;
  followupType: string;
}

export interface ChannelSendPayload {
  channel: 'whatsapp' | 'telegram' | 'web';
  channelUserId: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  delay?: number; // milliseconds to wait before sending (for human-like message splitting)
  metadata?: {
    messageType?: 'kvkk_consent' | 'flow_selection' | 'standard';
    kvkkLinkUrl?: string;
    formUrl?: string;
    language?: string;
  };
}

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private connection: IORedis;
  
  private aiQueue: Queue<AiJobPayload>;
  private followupQueue: Queue<FollowupJobPayload>;
  private channelQueue: Queue<ChannelSendPayload>;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    // Support both REDIS_URL (Railway) and individual host/port/password config
    const redisUrl = this.configService.get<string>('REDIS_URL');
    
    if (redisUrl) {
      // Railway Redis URL format: redis://default:password@host:port
      this.connection = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: (times) => {
          if (times > 3) {
            this.logger.error('Redis connection failed after 3 retries');
            return null;
          }
          return Math.min(times * 200, 2000);
        },
      });
    } else {
      // Fallback to individual config
      const redisHost = this.configService.get<string>('REDIS_HOST', 'localhost');
      const redisPort = this.configService.get<number>('REDIS_PORT', 6379);
      const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

      this.connection = new IORedis({
        host: redisHost,
        port: redisPort,
        password: redisPassword || undefined,
        maxRetriesPerRequest: null,
      });
    }
    
    this.connection.on('connect', () => {
      this.logger.log('Connected to Redis');
    });
    
    this.connection.on('error', (err) => {
      this.logger.error('Redis connection error:', err);
    });

    // Initialize queues
    this.aiQueue = new Queue<AiJobPayload>('ai-processing', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });

    this.followupQueue = new Queue<FollowupJobPayload>('followup-processing', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });

    this.channelQueue = new Queue<ChannelSendPayload>('channel-send', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });

    this.logger.log('Queue service initialized');
  }

  async onModuleDestroy() {
    await this.aiQueue?.close();
    await this.followupQueue?.close();
    await this.channelQueue?.close();
    await this.connection?.quit();
  }

  // ==================== AI QUEUE ====================

  async addAiJob(payload: AiJobPayload): Promise<Job<AiJobPayload>> {
    const job = await this.aiQueue.add('process', payload, {
      priority: payload.jobType === 'ANALYZE_AND_DRAFT_REPLY' ? 1 : 2,
    });
    this.logger.debug(`AI job added: ${job.id} - ${payload.jobType}`);
    return job;
  }

  getAiQueue(): Queue<AiJobPayload> {
    return this.aiQueue;
  }

  // ==================== FOLLOWUP QUEUE ====================

  async addFollowupJob(payload: FollowupJobPayload, delay?: number): Promise<Job<FollowupJobPayload>> {
    const job = await this.followupQueue.add('send-followup', payload, {
      delay: delay || 0,
    });
    this.logger.debug(`Followup job added: ${job.id} - attempt ${payload.attemptNumber}`);
    return job;
  }

  getFollowupQueue(): Queue<FollowupJobPayload> {
    return this.followupQueue;
  }

  // ==================== CHANNEL SEND QUEUE ====================

  async addChannelSendJob(payload: ChannelSendPayload): Promise<Job<ChannelSendPayload>> {
    const job = await this.channelQueue.add('send', payload, {
      delay: payload.delay || 0, // Support delayed sending for human-like message splitting
    });
    this.logger.debug(`Channel send job added: ${job.id} - ${payload.channel}${payload.delay ? ` (delayed ${payload.delay}ms)` : ''}`);
    return job;
  }

  getChannelQueue(): Queue<ChannelSendPayload> {
    return this.channelQueue;
  }
}

