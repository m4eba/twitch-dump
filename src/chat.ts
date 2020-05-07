import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import { Config } from './config';

enum Status {
  CLOSE,
  OPEN,
}

export class Chat {
  private status: Status = Status.CLOSE;
  private config: Config;
  private ws: WebSocket | null = null;
  private pingInt: NodeJS.Timeout | null = null;
  private out: fs.WriteStream | null = null;
  private fileIsOpening: boolean = false;
  private currentDay: number = 0;
  private buffer: WebSocket.Data[] = [];

  constructor(config: Config) {
    this.config = config;
  }

  public open() {
    this.ws = new WebSocket('ws://irc-ws.chat.twitch.tv:80');
    this.status = Status.OPEN;

    this.ws.on('open', this.onOpen.bind(this));
    this.ws.on('message', this.onMessage.bind(this));
    this.ws.on('close', this.onClose.bind(this));
  }

  public close() {
    if (this.ws === null) return;
    this.status = Status.CLOSE;
    this.ws.close();
  }

  public onOpen() {
    if (this.ws === null) throw new Error('websocket not defined');
    this.ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    this.ws.send(`PASS ${this.config.oauth}`);
    this.ws.send(`NICK ${this.config.username}`);
    this.ws.send(`JOIN #${this.config.channel}`);

    this.pingInt = setInterval(() => {
      if (this.ws === null) {
        clearInterval(this.pingInt!);
        this.pingInt = null;
        return;
      }
      this.ws.send('PING :tmi.twitch.tv\n');
    }, 1000 * 60 * 3);
  }

  public onMessage(data: WebSocket.Data) {
    this.buffer.push(data);
    if (this.out === null) {
      this.buffer.push(data);
      if (!this.fileIsOpening) this.openStream();
      return;
    }
    if (this.currentDay !== new Date().getDate()) {
      this.out.close();
      this.buffer.push(data);
      if (!this.fileIsOpening) this.openStream();
      return;
    }
    if (this.buffer.length > 0) {
      for (let i = 0; i < this.buffer.length; ++i) {
        this.out.write(this.buffer[i]);
      }
      this.buffer = [];
    }
    this.out.write(data);
  }

  public onClose() {
    if (this.status === Status.CLOSE) return;
    if (this.fileIsOpening) return;
    console.log('chat disconnected, reconnect in 10 seconds');
    setTimeout(() => {
      this.open();
    }, 10 * 1000);
  }

  private async openStream() {
    this.fileIsOpening = true;
    const time = new Date();
    const year = time.getFullYear().toString();
    let month = (time.getMonth() + 1).toString();
    let day = time.getDate().toString();
    this.currentDay = time.getDate();

    if (month.length === 1) month = '0' + month;
    if (day.length === 1) day = '0' + day;

    const outd = path.join(
      this.config.path,
      'chat',
      time.getFullYear().toString(),
      month
    );
    await fs.promises.mkdir(outd, { recursive: true });
    let filename = `${year}${month}${day}.txt`;
    this.out = fs.createWriteStream(path.join(outd, filename), { flags: 'a' });
    this.fileIsOpening = false;
  }
}

export default Chat;
