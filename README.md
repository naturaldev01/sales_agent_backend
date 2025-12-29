# AI Sales Agent Backend

NestJS tabanlı AI Sales Agent orkestrasyon sistemi.

## 🚀 Kurulum

```bash
# Bağımlılıkları yükle
npm install

# Environment dosyasını oluştur
cp .env.example .env
# .env dosyasını düzenle

# Development modunda çalıştır
npm run start:dev

# Production build
npm run build
npm run start:prod
```

## 📁 Proje Yapısı

```
src/
├── common/                    # Paylaşılan modüller
│   ├── supabase/             # Supabase client
│   └── queue/                # BullMQ queue service
├── modules/
│   ├── webhooks/             # Channel webhook handlers
│   │   ├── adapters/         # WhatsApp, Telegram adapters
│   │   └── interfaces/       # Normalized message types
│   ├── orchestrator/         # Main orchestration logic
│   ├── leads/                # Lead management
│   ├── conversations/        # Conversation management
│   ├── messages/             # Message handling
│   ├── followups/            # Follow-up scheduler
│   └── ai-client/            # AI Worker client
├── app.module.ts
└── main.ts
```

## 🔗 API Endpoints

### Webhooks
- `GET /webhooks/whatsapp` - WhatsApp webhook verification
- `POST /webhooks/whatsapp` - WhatsApp incoming messages
- `POST /webhooks/telegram` - Telegram incoming messages

### Leads
- `GET /leads` - List leads (filterable)
- `GET /leads/:id` - Get lead details
- `GET /leads/:id/photos` - Get lead photos
- `GET /leads/:id/photo-progress` - Get photo checklist progress
- `PATCH /leads/:id/status` - Update lead status
- `GET /leads/statistics` - Get lead statistics

### Conversations
- `GET /conversations/lead/:leadId` - Get conversations by lead
- `GET /conversations/:id/messages` - Get conversation messages
- `POST /conversations/:id/close` - Close conversation

### Orchestrator
- `POST /orchestrator/ai-response` - Process AI response
- `GET /orchestrator/state-graph` - Get state machine graph

## 📚 API Documentation

Swagger UI: http://localhost:3000/api/docs

## 🔧 Environment Variables

```env
# Application
NODE_ENV=development
PORT=3000

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# WhatsApp
WHATSAPP_API_URL=https://graph.facebook.com/v18.0
WHATSAPP_PHONE_NUMBER_ID=your-phone-id
WHATSAPP_ACCESS_TOKEN=your-token
WHATSAPP_VERIFY_TOKEN=your-verify-token

# Telegram
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_WEBHOOK_SECRET=your-secret

# AI Worker
AI_WORKER_URL=http://localhost:8000
AI_WORKER_API_KEY=your-api-key

# Feature Flags
ENABLE_WHATSAPP=true
ENABLE_TELEGRAM=true
```

## 🔄 State Machine

Lead durumları (FSM):
- `NEW` → İlk temas
- `QUALIFYING` → Bilgi toplama
- `PHOTO_REQUESTED` → Fotoğraf istendi
- `PHOTO_COLLECTING` → Fotoğraf toplanıyor
- `READY_FOR_DOCTOR` → Doktor değerlendirmesine hazır
- `WAITING_FOR_USER` → Kullanıcı cevabı bekleniyor
- `DORMANT` → Uykuda
- `HANDOFF_HUMAN` → İnsan devri
- `CONVERTED` → Dönüşüm
- `CLOSED` → Kapatıldı

## 📝 License

Private - Natural Clinic

