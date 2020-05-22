import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { Config } from './config';
import { EventEmitter } from 'events';

enum Status {
  CLOSE,
  OPEN,
}

export abstract class WebSocketLogger extends EventEmitter {
  private status: Status = Status.CLOSE;
  protected config: Config;
  protected url: string = '';
  protected folder: string = '';
  protected ws: WebSocket | null = null;
  private pingInt: NodeJS.Timeout | null = null;
  private pingTimeout: NodeJS.Timer | null = null;
  private out: fs.WriteStream | null = null;
  private fileIsOpening: boolean = false;
  private currentDay: number = 0;
  private buffer: WebSocket.Data[] = [];

  constructor(url: string, folder: string, config: Config) {
    super();
    this.url = url;
    this.folder = folder;
    this.config = config;
  }

  public open() {
    this.ws = new WebSocket(this.url);
    this.status = Status.OPEN;

    this.ws.on('open', () => this.wsOpen());
    this.ws.on('message', (data: WebSocket.Data) => this.wsMessage(data));
    this.ws.on('close', () => this.wsClose());
  }

  public close() {
    if (this.ws === null) return;
    this.status = Status.CLOSE;
    this.ws.close();
  }

  private wsOpen() {
    if (this.ws === null) throw new Error('websocket not defined');

    this.pingInt = setInterval(() => {
      if (this.ws === null) {
        clearInterval(this.pingInt!);
        this.pingInt = null;
        return;
      }
      this.ping();
      if (this.pingTimeout !== null) {
        clearInterval(this.pingTimeout);
      }
      this.pingTimeout = setTimeout(() => this.timeout(), 15 * 1000);
    }, 1000 * 60 * 3);

    this.onOpen();
  }

  private wsMessage(data: WebSocket.Data) {
    if (this.isPong(data) && this.pingTimeout) {
      clearInterval(this.pingTimeout);
      this.pingTimeout = null;
    }
    this.writeData(data);
    this.onMessage(data);
  }

  private wsClose() {
    if (this.status === Status.CLOSE) return;
    if (this.fileIsOpening) return;
    console.log('ws disconnected, reconnect in 5 seconds');
    setTimeout(() => {
      this.open();
    }, 5 * 1000);

    this.onClose();
  }

  private writeData(data: WebSocket.Data) {
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
        this.writeLine(this.buffer[i].toString().trim());
      }
      this.buffer = [];
    }
    this.writeLine(data.toString().trim());
  }

  private writeLine(line: string) {
    this.out?.write(new Date().toISOString() + ' ' + line);
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
      this.folder,
      time.getFullYear().toString(),
      month
    );
    await fs.promises.mkdir(outd, { recursive: true });
    let filename = `${year}${month}${day}.txt`;
    this.out = fs.createWriteStream(path.join(outd, filename), { flags: 'a' });
    this.fileIsOpening = false;
  }

  protected abstract ping(): void;
  protected abstract isPong(data: WebSocket.Data): boolean;

  protected onOpen(): void {}
  protected onClose(): void {}
  // eslint-disable-next-line no-unused-vars
  protected onMessage(data: WebSocket.Data): void {}

  private timeout() {
    console.log('ping timeout?');
    if (!this.ws) return;
    this.ws.close();
    //this.close();
    //this.open();
  }
}
