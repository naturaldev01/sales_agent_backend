export interface NormalizedMessage {
  // Channel info
  channel: 'whatsapp' | 'telegram' | 'web' | 'instagram';
  channelMessageId: string;
  channelUserId: string;
  
  // Sender info
  senderName?: string;
  senderPhone?: string;
  senderLanguage?: string; // Language code from user's Telegram settings
  
  // Content
  content?: string;
  mediaType: 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'sticker';
  mediaUrl?: string;
  
  // Location (if applicable)
  location?: {
    latitude: number;
    longitude: number;
  };
  
  // Metadata
  timestamp: Date;
  rawPayload?: Record<string, unknown>;
}

export interface OutgoingMessage {
  channel: 'whatsapp' | 'telegram' | 'web' | 'instagram';
  channelUserId: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document';
  replyToMessageId?: string;
}

