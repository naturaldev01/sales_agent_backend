import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getConfigs() {
    const { data, error } = await this.supabase.client
      .from('system_configs')
      .select('*')
      .eq('is_active', true)
      .order('config_key');

    if (error) throw error;
    return data || [];
  }
}

