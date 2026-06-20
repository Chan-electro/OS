import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/**
 * Sends a Telegram message to the specified chat ID
 * @param {string} chatId 
 * @param {string} text 
 */
export async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN) {
    console.log(`[Telegram (Disabled)] Log to Chat ${chatId}: ${text}`);
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      })
    });

    if (!res.ok) {
      const errData = await res.json();
      console.error(`[Telegram Error] API returned status ${res.status}:`, errData);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[Telegram Error] Failed to connect to Telegram API:', err.message);
    return false;
  }
}

/**
 * Compiles a task assignment message
 */
export function formatAssignmentMessage(title, clientName, priority, dueDate, creatorName) {
  return `🆕 <b>New task:</b> "${title}"\n` +
         `Client: ${clientName || 'Internal'}  • Priority: ${priority.toUpperCase()}  • Due: ${dueDate || 'No Date'}\n` +
         `Assigned by ${creatorName}.`;
}

/**
 * Compiles a daily digest message
 */
export function formatDailyDigest(name, overdueTasks, todayTasks) {
  let text = `☀️ <b>Good morning ${name}.</b>\n\n`;

  if (overdueTasks.length > 0) {
    text += `<b>Overdue (${overdueTasks.length}):</b>\n`;
    overdueTasks.forEach(t => {
      text += `- ${t.title} — ${t.client_name || 'Internal'} — was due ${t.due_date}\n`;
    });
    text += `\n`;
  }

  if (todayTasks.length > 0) {
    text += `<b>Due today (${todayTasks.length}):</b>\n`;
    todayTasks.forEach(t => {
      text += `- ${t.title} — ${t.client_name || 'Internal'} — ${t.priority.toUpperCase()}\n`;
    });
    text += `\n`;
  }

  text += `Open AdGrades OS to update.`;
  return text;
}

/**
 * Compiles a break message
 */
export function formatBreakMessage() {
  return `🧘 <b>Time for a 5-minute break</b> — stand up, stretch, hydrate.`;
}
