import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function getChatIds() {
  if (!BOT_TOKEN) {
    console.error('Error: TELEGRAM_BOT_TOKEN is not configured in .env file.');
    process.exit(1);
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`;
  console.log('Querying Telegram Bot Updates...');
  console.log(`Endpoint: ${url}`);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json();
      console.error('API Error:', err);
      process.exit(1);
    }

    const data = await res.json();
    const results = data.result || [];

    if (results.length === 0) {
      console.log('\nNo updates found. Please send a message to your Telegram Bot first from your phone/laptop, then run this command again.');
      return;
    }

    const chatsMap = new Map();

    for (const update of results) {
      const message = update.message || update.edited_message;
      if (message && message.chat) {
        const chat = message.chat;
        const name = chat.username 
          ? `@${chat.username} (${chat.first_name || ''} ${chat.last_name || ''})`
          : `${chat.first_name || ''} ${chat.last_name || ''}`;
        chatsMap.set(chat.id, name);
      }
    }

    console.log('\n--- Found Active Chat IDs ---');
    for (const [id, name] of chatsMap.entries()) {
      console.log(`ID: ${id}  ->  User: ${name}`);
    }
    console.log('-----------------------------\n');
    console.log('Copy the numeric ID and paste it into the Telegram Chat ID field for the user in the Team screen.');

  } catch (err) {
    console.error('Connection failed:', err.message);
  }
}

getChatIds();
