// Minimal slice of the Telegram Bot API update shape — only the fields the
// bot reads. https://core.telegram.org/bots/api#update

export type TelegramChat = {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
}

export type TelegramMessage = {
  message_id: number
  chat: TelegramChat
  from?: { id: number }
  text?: string
  caption?: string
  // Present on forwarded messages; channel forwards carry the channel title,
  // which makes a better session title than the first words of the text.
  forward_origin?: { type: string; chat?: { title?: string } }
}

export type TelegramCallbackQuery = {
  id: string
  data?: string
  from: { id: number }
  message?: { chat: TelegramChat }
}

export type TelegramUpdate = {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

export type TelegramInlineKeyboardButton = {
  text: string
  callback_data: string
}
