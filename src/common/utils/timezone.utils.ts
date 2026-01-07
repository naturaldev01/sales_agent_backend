/**
 * Timezone Utilities for Smart Follow-up Scheduling
 * 
 * This module provides timezone-aware scheduling to ensure messages
 * are sent at appropriate times based on the lead's location.
 */

/**
 * Country to Timezone mapping for common lead sources
 * Uses representative timezone for each country
 */
export const COUNTRY_TIMEZONE_MAP: Record<string, string> = {
  // Europe
  'UK': 'Europe/London',
  'GB': 'Europe/London',
  'DE': 'Europe/Berlin',
  'FR': 'Europe/Paris',
  'IT': 'Europe/Rome',
  'ES': 'Europe/Madrid',
  'NL': 'Europe/Amsterdam',
  'BE': 'Europe/Brussels',
  'AT': 'Europe/Vienna',
  'CH': 'Europe/Zurich',
  'PL': 'Europe/Warsaw',
  'CZ': 'Europe/Prague',
  'SE': 'Europe/Stockholm',
  'NO': 'Europe/Oslo',
  'DK': 'Europe/Copenhagen',
  'FI': 'Europe/Helsinki',
  'IE': 'Europe/Dublin',
  'PT': 'Europe/Lisbon',
  'GR': 'Europe/Athens',
  'RO': 'Europe/Bucharest',
  'HU': 'Europe/Budapest',
  'UA': 'Europe/Kiev',
  'RU': 'Europe/Moscow',
  'TR': 'Europe/Istanbul',
  
  // Middle East
  'SA': 'Asia/Riyadh',
  'AE': 'Asia/Dubai',
  'QA': 'Asia/Qatar',
  'KW': 'Asia/Kuwait',
  'BH': 'Asia/Bahrain',
  'OM': 'Asia/Muscat',
  'JO': 'Asia/Amman',
  'LB': 'Asia/Beirut',
  'IL': 'Asia/Jerusalem',
  'IQ': 'Asia/Baghdad',
  'IR': 'Asia/Tehran',
  'EG': 'Africa/Cairo',
  
  // Americas
  'US': 'America/New_York',  // Default to Eastern
  'CA': 'America/Toronto',
  'MX': 'America/Mexico_City',
  'BR': 'America/Sao_Paulo',
  'AR': 'America/Buenos_Aires',
  'CO': 'America/Bogota',
  'CL': 'America/Santiago',
  
  // Asia Pacific
  'AU': 'Australia/Sydney',
  'NZ': 'Pacific/Auckland',
  'JP': 'Asia/Tokyo',
  'KR': 'Asia/Seoul',
  'CN': 'Asia/Shanghai',
  'HK': 'Asia/Hong_Kong',
  'SG': 'Asia/Singapore',
  'MY': 'Asia/Kuala_Lumpur',
  'TH': 'Asia/Bangkok',
  'VN': 'Asia/Ho_Chi_Minh',
  'PH': 'Asia/Manila',
  'ID': 'Asia/Jakarta',
  'IN': 'Asia/Kolkata',
  'PK': 'Asia/Karachi',
  
  // Africa
  'ZA': 'Africa/Johannesburg',
  'NG': 'Africa/Lagos',
  'KE': 'Africa/Nairobi',
  'MA': 'Africa/Casablanca',
  'DZ': 'Africa/Algiers',
  'TN': 'Africa/Tunis',
  'LY': 'Africa/Tripoli',
};

/**
 * Common country name aliases to ISO codes
 */
export const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  // Turkish names
  'turkey': 'TR',
  'türkiye': 'TR',
  'turkiye': 'TR',
  'almanya': 'DE',
  'fransa': 'FR',
  'ingiltere': 'GB',
  'hollanda': 'NL',
  'belçika': 'BE',
  'avusturya': 'AT',
  'isviçre': 'CH',
  'ispanya': 'ES',
  'italya': 'IT',
  'yunanistan': 'GR',
  'polonya': 'PL',
  'romanya': 'RO',
  'macaristan': 'HU',
  'ukrayna': 'UA',
  'rusya': 'RU',
  'suudi arabistan': 'SA',
  'birleşik arap emirlikleri': 'AE',
  'bae': 'AE',
  'katar': 'QA',
  'kuveyt': 'KW',
  'mısır': 'EG',
  'irak': 'IQ',
  'iran': 'IR',
  'ürdün': 'JO',
  'lübnan': 'LB',
  'israil': 'IL',
  'fas': 'MA',
  'cezayir': 'DZ',
  'tunus': 'TN',
  'libya': 'LY',
  'güney afrika': 'ZA',
  'nijerya': 'NG',
  'kenya': 'KE',
  'avustralya': 'AU',
  'kanada': 'CA',
  'brezilya': 'BR',
  'meksika': 'MX',
  'arjantin': 'AR',
  'japonya': 'JP',
  'güney kore': 'KR',
  'çin': 'CN',
  'hindistan': 'IN',
  'pakistan': 'PK',
  
  // English names
  'germany': 'DE',
  'deutschland': 'DE',
  'france': 'FR',
  'united kingdom': 'GB',
  'uk': 'GB',
  'england': 'GB',
  'scotland': 'GB',
  'wales': 'GB',
  'great britain': 'GB',
  'united states': 'US',
  'usa': 'US',
  'america': 'US',
  'saudi arabia': 'SA',
  'uae': 'AE',
  'emirates': 'AE',
  'united arab emirates': 'AE',
  'dubai': 'AE',
  'qatar': 'QA',
  'kuwait': 'KW',
  'egypt': 'EG',
  'russia': 'RU',
  'ukraine': 'UA',
  'netherlands': 'NL',
  'holland': 'NL',
  'belgium': 'BE',
  'austria': 'AT',
  'switzerland': 'CH',
  'sweden': 'SE',
  'norway': 'NO',
  'denmark': 'DK',
  'finland': 'FI',
  'ireland': 'IE',
  'portugal': 'PT',
  'spain': 'ES',
  'italy': 'IT',
  'greece': 'GR',
  'poland': 'PL',
  'romania': 'RO',
  'hungary': 'HU',
  'czech republic': 'CZ',
  'czechia': 'CZ',
  'australia': 'AU',
  'canada': 'CA',
  'brazil': 'BR',
  'mexico': 'MX',
  'argentina': 'AR',
  'colombia': 'CO',
  'chile': 'CL',
  'japan': 'JP',
  'south korea': 'KR',
  'korea': 'KR',
  'china': 'CN',
  'india': 'IN',
  'pakistan': 'PK',
  'iran': 'IR',
  'iraq': 'IQ',
  'jordan': 'JO',
  'lebanon': 'LB',
  'israel': 'IL',
  'morocco': 'MA',
  'algeria': 'DZ',
  'tunisia': 'TN',
  'south africa': 'ZA',
  'nigeria': 'NG',
  
  // Arabic names
  'السعودية': 'SA',
  'الإمارات': 'AE',
  'دبي': 'AE',
  'قطر': 'QA',
  'الكويت': 'KW',
  'البحرين': 'BH',
  'عمان': 'OM',
  'مصر': 'EG',
  'العراق': 'IQ',
  'الأردن': 'JO',
  'لبنان': 'LB',
  'المغرب': 'MA',
  'الجزائر': 'DZ',
  'تونس': 'TN',
  'ليبيا': 'LY',
  'تركيا': 'TR',
  'ألمانيا': 'DE',
  'فرنسا': 'FR',
  'بريطانيا': 'GB',
  
  // French names
  'allemagne': 'DE',
  'royaume-uni': 'GB',
  'angleterre': 'GB',
  'pays-bas': 'NL',
  'belgique': 'BE',
  'autriche': 'AT',
  'suisse': 'CH',
  'espagne': 'ES',
  'italie': 'IT',
  'grèce': 'GR',
  'pologne': 'PL',
  'roumanie': 'RO',
  'hongrie': 'HU',
  'turquie': 'TR',
  'arabie saoudite': 'SA',
  'émirats arabes unis': 'AE',
  'égypte': 'EG',
  'maroc': 'MA',
  'algérie': 'DZ',
  'tunisie': 'TN',
  'afrique du sud': 'ZA',
};

/**
 * Countries that observe Friday as a weekend day (Islamic countries)
 */
export const FRIDAY_WEEKEND_COUNTRIES = new Set([
  'SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'EG', 'IQ', 'JO', 'LY', 'DZ',
]);

/**
 * Get timezone from country code or name
 */
export function getTimezoneFromCountry(country: string | null): string | null {
  if (!country) return null;
  
  // Try direct ISO code match (uppercase)
  const upperCountry = country.toUpperCase().trim();
  if (COUNTRY_TIMEZONE_MAP[upperCountry]) {
    return COUNTRY_TIMEZONE_MAP[upperCountry];
  }
  
  // Try name lookup (lowercase)
  const lowerCountry = country.toLowerCase().trim();
  const isoCode = COUNTRY_NAME_TO_CODE[lowerCountry];
  if (isoCode && COUNTRY_TIMEZONE_MAP[isoCode]) {
    return COUNTRY_TIMEZONE_MAP[isoCode];
  }
  
  return null;
}

/**
 * Get ISO country code from country name
 */
export function getCountryCode(country: string | null): string | null {
  if (!country) return null;
  
  const upperCountry = country.toUpperCase().trim();
  if (COUNTRY_TIMEZONE_MAP[upperCountry]) {
    return upperCountry;
  }
  
  const lowerCountry = country.toLowerCase().trim();
  return COUNTRY_NAME_TO_CODE[lowerCountry] || null;
}

/**
 * Get the current hour in a specific timezone
 */
export function getCurrentHourInTimezone(timezone: string): number {
  try {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    return parseInt(formatter.format(now), 10);
  } catch {
    // Fallback to UTC
    return new Date().getUTCHours();
  }
}

/**
 * Get current day of week in a timezone (0 = Sunday, 6 = Saturday)
 */
export function getCurrentDayInTimezone(timezone: string): number {
  try {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      weekday: 'short',
    };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const dayStr = formatter.format(now);
    const dayMap: Record<string, number> = {
      'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6,
    };
    return dayMap[dayStr] ?? new Date().getDay();
  } catch {
    return new Date().getDay();
  }
}

/**
 * Get formatted local time string for a timezone
 */
export function getLocalTimeString(timezone: string): string {
  try {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    };
    return new Intl.DateTimeFormat('en-US', options).format(now);
  } catch {
    return 'Unknown';
  }
}

/**
 * Get formatted local day name for a timezone
 */
export function getLocalDayName(timezone: string): string {
  try {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      weekday: 'long',
    };
    return new Intl.DateTimeFormat('en-US', options).format(now);
  } catch {
    return 'Unknown';
  }
}

/**
 * Check if current day is a weekend for a specific country
 */
export function isWeekendInCountry(countryCode: string | null, timezone: string): boolean {
  const dayOfWeek = getCurrentDayInTimezone(timezone);
  
  // Islamic countries: Friday-Saturday weekend
  if (countryCode && FRIDAY_WEEKEND_COUNTRIES.has(countryCode.toUpperCase())) {
    return dayOfWeek === 5 || dayOfWeek === 6; // Friday or Saturday
  }
  
  // Western countries: Saturday-Sunday weekend
  return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
}

/**
 * Check if current time is within messaging hours for a timezone
 */
export function isWithinMessagingHours(
  timezone: string,
  startHour: number = 9,
  endHour: number = 21,
): boolean {
  const currentHour = getCurrentHourInTimezone(timezone);
  return currentHour >= startHour && currentHour < endHour;
}

/**
 * Get the messaging window status with detailed info
 */
export interface MessagingWindowStatus {
  canSend: boolean;
  currentHour: number;
  currentDay: string;
  isWeekend: boolean;
  waitHours: number;
  reason: string;
  nextWindowTime: string;
}

export function getMessagingWindowStatus(
  timezone: string,
  countryCode: string | null,
  options: {
    startHour?: number;
    endHour?: number;
    avoidWeekends?: boolean;
  } = {},
): MessagingWindowStatus {
  const { startHour = 9, endHour = 21, avoidWeekends = true } = options;
  
  const currentHour = getCurrentHourInTimezone(timezone);
  const currentDay = getLocalDayName(timezone);
  const isWeekend = isWeekendInCountry(countryCode, timezone);
  
  let canSend = true;
  let waitHours = 0;
  let reason = 'OK to send';
  
  // Check sleeping hours (22:00 - 08:00)
  if (currentHour >= 22 || currentHour < 8) {
    canSend = false;
    if (currentHour >= 22) {
      waitHours = (24 - currentHour) + startHour;
    } else {
      waitHours = startHour - currentHour;
    }
    reason = `Sleeping hours (${currentHour}:00 local) - wait until ${startHour}:00`;
  }
  // Check early morning (08:00 - 09:00)
  else if (currentHour >= 8 && currentHour < startHour) {
    canSend = false;
    waitHours = startHour - currentHour;
    reason = `Early morning (${currentHour}:00 local) - wait until ${startHour}:00`;
  }
  // Check after hours (21:00+)
  else if (currentHour >= endHour) {
    canSend = false;
    waitHours = (24 - currentHour) + startHour;
    reason = `After hours (${currentHour}:00 local) - wait until tomorrow ${startHour}:00`;
  }
  
  // Check weekend
  if (canSend && avoidWeekends && isWeekend) {
    const dayOfWeek = getCurrentDayInTimezone(timezone);
    const isIslamicWeekend = countryCode && FRIDAY_WEEKEND_COUNTRIES.has(countryCode.toUpperCase());
    
    if (isIslamicWeekend) {
      // Friday-Saturday weekend
      if (dayOfWeek === 5) { // Friday
        waitHours = Math.max(waitHours, 24 + (startHour - currentHour)); // Saturday start
      } else if (dayOfWeek === 6) { // Saturday
        waitHours = Math.max(waitHours, startHour - currentHour + (currentHour >= startHour ? 24 : 0));
      }
    } else {
      // Saturday-Sunday weekend
      if (dayOfWeek === 6) { // Saturday
        waitHours = Math.max(waitHours, 48 - currentHour + startHour); // Monday start
      } else if (dayOfWeek === 0) { // Sunday
        waitHours = Math.max(waitHours, 24 - currentHour + startHour); // Monday start
      }
    }
    
    if (waitHours > 0) {
      canSend = false;
      reason = `Weekend (${currentDay}) - postponing to next business day`;
    }
  }
  
  // Calculate next window time
  const nextWindow = new Date();
  nextWindow.setHours(nextWindow.getHours() + waitHours);
  const nextWindowTime = waitHours > 0 
    ? getLocalTimeString(timezone) 
    : 'Now';
  
  return {
    canSend,
    currentHour,
    currentDay,
    isWeekend,
    waitHours,
    reason,
    nextWindowTime,
  };
}

/**
 * Get hour in timezone at a specific time
 */
function getHourInTimezoneAtTime(date: Date, timezone: string): number {
  try {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    return parseInt(formatter.format(date), 10);
  } catch {
    return date.getUTCHours();
  }
}

/**
 * Get day of week in timezone at a specific time (0 = Sunday, 6 = Saturday)
 */
function getDayInTimezoneAtTime(date: Date, timezone: string): number {
  try {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      weekday: 'short',
    };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const dayStr = formatter.format(date);
    const dayMap: Record<string, number> = {
      'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6,
    };
    return dayMap[dayStr] ?? date.getDay();
  } catch {
    return date.getDay();
  }
}

/**
 * Calculate the optimal send time considering timezone
 * Returns a Date object adjusted to fall within messaging hours
 */
export function calculateOptimalSendTime(
  timezone: string | null,
  requestedDelayHours: number,
  countryCode: string | null,
  options: {
    startHour?: number;
    endHour?: number;
    avoidWeekends?: boolean;
  } = {},
): Date {
  const { startHour = 9, endHour = 21, avoidWeekends = true } = options;
  
  // If no timezone, just use the delay directly
  if (!timezone) {
    const sendTime = new Date();
    sendTime.setHours(sendTime.getHours() + requestedDelayHours);
    return sendTime;
  }
  
  // Calculate initial send time
  let sendTime = new Date();
  sendTime.setHours(sendTime.getHours() + requestedDelayHours);
  
  // Get the hour in the lead's timezone at send time
  let sendHourInLeadTimezone = getHourInTimezoneAtTime(sendTime, timezone);
  
  // Check if it's outside messaging hours
  if (sendHourInLeadTimezone < startHour) {
    // Too early - push to start hour
    const hoursToAdd = startHour - sendHourInLeadTimezone;
    sendTime.setHours(sendTime.getHours() + hoursToAdd);
  } else if (sendHourInLeadTimezone >= endHour || sendHourInLeadTimezone >= 22) {
    // Too late - push to next day start
    const hoursToAdd = (24 - sendHourInLeadTimezone) + startHour;
    sendTime.setHours(sendTime.getHours() + hoursToAdd);
  }
  
  // Check weekends
  if (avoidWeekends) {
    const dayOfWeek = getDayInTimezoneAtTime(sendTime, timezone);
    const isIslamicCountry = countryCode && FRIDAY_WEEKEND_COUNTRIES.has(countryCode.toUpperCase());
    
    if (isIslamicCountry) {
      // Friday-Saturday weekend - push to Sunday
      if (dayOfWeek === 5) { // Friday
        sendTime.setHours(sendTime.getHours() + 48);
      } else if (dayOfWeek === 6) { // Saturday
        sendTime.setHours(sendTime.getHours() + 24);
      }
    } else {
      // Saturday-Sunday weekend - push to Monday
      if (dayOfWeek === 6) { // Saturday
        sendTime.setHours(sendTime.getHours() + 48);
      } else if (dayOfWeek === 0) { // Sunday
        sendTime.setHours(sendTime.getHours() + 24);
      }
    }
    
    // Re-adjust for start hour after weekend push
    sendHourInLeadTimezone = getHourInTimezoneAtTime(sendTime, timezone);
    if (sendHourInLeadTimezone < startHour) {
      const hoursToAdd = startHour - sendHourInLeadTimezone;
      sendTime.setHours(sendTime.getHours() + hoursToAdd);
    }
  }
  
  return sendTime;
}

/**
 * Get timezone context for AI agents
 */
export interface TimezoneContext {
  timezone: string | null;
  countryCode: string | null;
  localTime: string;
  localDay: string;
  isWeekend: boolean;
  isMessagingHours: boolean;
  hoursUntilNextWindow: number;
}

export function getTimezoneContext(
  country: string | null,
  existingTimezone: string | null = null,
): TimezoneContext {
  const countryCode = getCountryCode(country);
  const timezone = existingTimezone || getTimezoneFromCountry(country);
  
  if (!timezone) {
    return {
      timezone: null,
      countryCode: null,
      localTime: 'Unknown',
      localDay: 'Unknown',
      isWeekend: false,
      isMessagingHours: true, // Assume OK if unknown
      hoursUntilNextWindow: 0,
    };
  }
  
  const status = getMessagingWindowStatus(timezone, countryCode);
  
  return {
    timezone,
    countryCode,
    localTime: getLocalTimeString(timezone),
    localDay: getLocalDayName(timezone),
    isWeekend: status.isWeekend,
    isMessagingHours: status.canSend,
    hoursUntilNextWindow: status.waitHours,
  };
}
