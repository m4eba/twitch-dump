import WebSocket from 'ws';
import Debug from 'debug';
import { Config } from './config';
import { WebSocketLogger } from './WebSocketLogger';

const debug = Debug('chats');

export class Chat extends WebSocketLogger {
  constructor(config: Config) {
    super('ws://irc-ws.chat.twitch.tv:80', 'chat', config);
    this.config = config;
  }

  protected ping(): void {
    if (!this.ws) return;
    debug('ping');
    this.ws.send('PING');
  }

  protected isPong(data: WebSocket.Data): boolean {
    if (data.toString().trim() === 'PONG :tmi.twitch.tv') {
      debug('pong');
      return true;
    }
    return false;
  }

  protected onOpen() {
    if (!this.ws) return;
    this.ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    this.ws.send(`PASS ${this.config.oauth}`);
    this.ws.send(`NICK ${this.config.username}`);
    this.ws.send(`JOIN #${this.config.channel}`);
  }

  protected onMessage(data: WebSocket.Data): void {
    if (this.ws && data.toString() === 'PING :tmi.twitch.tv') {
      this.ws.send('PONG');
    }
  }
}

export default Chat;
