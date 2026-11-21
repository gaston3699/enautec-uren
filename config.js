// Instellingen van de app. Zie HANDLEIDING.md.

// Opslag: 'google' (Google Drive, gekoppeld via de verzamelserver) of 'onedrive' (Microsoft, aanmelden in de app)
export const STORAGE = 'google';

// ← Adres van de verzamelserver (Cloudflare Worker), bv. 'https://enautec-uren.naam.workers.dev'
//   Mag ook leeg blijven: de koppellink van elke werknemer bevat het adres ook.
export const SERVER_URL = 'https://enautec-uren.enautec.workers.dev';

// Hoofdmap in de opslag (uren, planning, materiaal, stamgegevens)
export const DATA_FOLDER = 'Enautec Uren';

// Enkel voor STORAGE = 'onedrive': Toepassings-id (client-ID) uit Microsoft Entra
export const MS_CLIENT_ID = '';
export const MS_TENANT = 'common';

export const APP_VERSION = '1.2.0';
