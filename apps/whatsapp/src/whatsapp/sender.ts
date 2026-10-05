import axios from 'axios';

const WA_API_BASE = 'https://graph.facebook.com/v19.0';

export async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const useStub = process.env.WHATSAPP_USE_STUB === 'true'
    || !token
    || !phoneId
    || token.startsWith('dev-')
    || phoneId.startsWith('dev-');
  if (useStub) {
    console.log(`[WhatsApp STUB] → ${to}: ${text.substring(0, 100)}`);
    return;
  }
  try {
    await axios.post(`${WA_API_BASE}/${phoneId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text, preview_url: false },
    }, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
  } catch (err: any) {
    console.error(`[WhatsApp] Failed to send to ${to}:`, err.response?.data || err.message);
  }
}

export async function markAsRead(messageId: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const useStub = process.env.WHATSAPP_USE_STUB === 'true'
    || !token
    || !phoneId
    || token.startsWith('dev-')
    || phoneId.startsWith('dev-');
  if (useStub) return;
  try {
    await axios.post(`${WA_API_BASE}/${phoneId}/messages`,
      { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
  } catch {
    // Read receipts are best-effort and should not interrupt intake.
  }
}
