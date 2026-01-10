import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject, forwardRef } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { ChannelSendPayload } from './queue.service';
import { TelegramAdapter } from '../../modules/webhooks/adapters/telegram.adapter';
import { WhatsappAdapter } from '../../modules/webhooks/adapters/whatsapp.adapter';

@Injectable()
export class ChannelSendProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChannelSendProcessor.name);
  private worker!: Worker<ChannelSendPayload>;
  private connection!: IORedis;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => TelegramAdapter))
    private readonly telegramAdapter: TelegramAdapter,
    @Inject(forwardRef(() => WhatsappAdapter))
    private readonly whatsappAdapter: WhatsappAdapter,
  ) {}

  async onModuleInit() {
    // Support both REDIS_URL (Railway) and individual host/port/password config
    const redisUrl = this.configService.get<string>('REDIS_URL');
    
    if (redisUrl) {
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
      this.logger.log('Channel Send Worker connected to Redis');
    });
    
    this.connection.on('error', (err) => {
      this.logger.error('Channel Send Worker Redis connection error:', err);
    });

    this.worker = new Worker<ChannelSendPayload>(
      'channel-send',
      async (job: Job<ChannelSendPayload>) => {
        return this.processJob(job);
      },
      {
        connection: this.connection,
        concurrency: 5,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Channel send job completed: ${job.id}`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Channel send job failed: ${job?.id}`, err);
    });

    this.logger.log('Channel Send Worker processor started');
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.connection?.quit();
  }

  private async processJob(job: Job<ChannelSendPayload>): Promise<void> {
    const { channel, channelUserId, content, mediaUrl, mediaType, metadata } = job.data;

    this.logger.log(`Processing channel send job: ${job.id} for ${channel}:${channelUserId}`);

    try {
      // Handle different message types based on metadata
      const messageTypeHandler = metadata?.messageType;

      if (channel === 'telegram') {
        await this.handleTelegramMessage(channelUserId, content, mediaUrl, mediaType, metadata);
      } else if (channel === 'whatsapp') {
        await this.handleWhatsappMessage(channelUserId, content, mediaUrl, mediaType, metadata);
      } else if (channel === 'web') {
        // Web channel - typically handled differently (WebSocket, etc.)
        this.logger.warn(`Web channel send not implemented yet for ${channelUserId}`);
      } else {
        this.logger.warn(`Unknown channel: ${channel}`);
      }

      this.logger.log(`✅ Message sent via ${channel} to ${channelUserId}`);
    } catch (error: unknown) {
      this.logger.error(`Error processing channel send job ${job.id}:`, error);
      throw error; // Rethrow to trigger BullMQ retry
    }
  }

  private async handleTelegramMessage(
    channelUserId: string,
    content: string,
    mediaUrl?: string,
    mediaType?: string,
    metadata?: ChannelSendPayload['metadata'],
  ): Promise<void> {
    const messageType = metadata?.messageType;
    const language = metadata?.language || 'en';

    if (messageType === 'kvkk_consent' && metadata?.kvkkLinkUrl) {
      // Send KVKK consent with buttons
      await this.telegramAdapter.sendKvkkConsentMessage(
        channelUserId,
        language,
        metadata.kvkkLinkUrl,
      );
    } else if (messageType === 'flow_selection' && metadata?.formUrl) {
      // Send flow selection with buttons
      await this.telegramAdapter.sendFlowSelectionMessage(
        channelUserId,
        language,
        metadata.formUrl,
      );
    } else {
      // Standard message
      await this.telegramAdapter.sendMessage({
        channel: 'telegram',
        channelUserId,
        content,
        mediaUrl,
        mediaType: mediaType as 'image' | 'video' | 'audio' | 'document' | undefined,
      });
    }
  }

  private async handleWhatsappMessage(
    channelUserId: string,
    content: string,
    mediaUrl?: string,
    mediaType?: string,
    metadata?: ChannelSendPayload['metadata'],
  ): Promise<void> {
    const messageType = metadata?.messageType;
    const language = metadata?.language || 'en';

    if (messageType === 'kvkk_consent' && metadata?.kvkkLinkUrl) {
      // Send KVKK consent with buttons
      await this.whatsappAdapter.sendKvkkConsentMessage(
        channelUserId,
        language,
        metadata.kvkkLinkUrl,
      );
    } else if (messageType === 'flow_selection' && metadata?.formUrl) {
      // Send flow selection with buttons
      await this.whatsappAdapter.sendFlowSelectionMessage(
        channelUserId,
        language,
        metadata.formUrl,
      );
    } else {
      // Standard message
      await this.whatsappAdapter.sendMessage({
        channel: 'whatsapp',
        channelUserId,
        content,
        mediaUrl,
        mediaType: mediaType as 'image' | 'video' | 'audio' | 'document' | undefined,
      });
    }
  }
}
