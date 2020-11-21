import fs from 'fs';
import path from 'path';
import { Config } from './Config';
import { EventEmitter } from 'events';
import { ApiClient, HelixStream } from 'twitch';

export declare interface Stats {
  on(event: 'stream', listener: (id: string) => void): this;
}
export class Stats extends EventEmitter {
  private config: Config;
  private intervalInt: NodeJS.Timer | null = null;
  private client: ApiClient;
  private path: string = '';
  private stream: HelixStream | null = null;
  private title: string = '';
  private viewCountStream: fs.WriteStream | null = null;
  private titleStream: fs.WriteStream | null = null;
  private gameStream: fs.WriteStream | null = null;

  constructor(config: Config) {
    super();
    this.config = config;
    this.client = ApiClient.withClientCredentials(
      this.config.clientId,
      this.config.secret
    );
  }

  public async getStream() {
    const stream = await this.client.helix.streams.getStreamByUserName(
      this.config.channel
    );
    if (stream === null) {
      if (this.stream !== null) {
        this.closeStream();
      }
      return;
    }
    if (this.stream === null) {
      this.path = await this.makePath(stream.id);
      await fs.promises.writeFile(
        path.join(this.path, 'info.json'),
        JSON.stringify(stream, null, '  ')
      );
      this.stream = stream;
      this.title = stream.title;
      this.viewCountStream = fs.createWriteStream(
        path.join(this.path, 'viewcount.txt'),
        { flags: 'a' }
      );
      this.titleStream = fs.createWriteStream(
        path.join(this.path, 'title.txt'),
        { flags: 'a' }
      );
      this.gameStream = fs.createWriteStream(path.join(this.path, 'game.txt'), {
        flags: 'a',
      });
      this.titleStream.write(
        new Date().toISOString() + ' ' + this.stream.title + '\n'
      );
      this.gameStream.write(
        new Date().toISOString() + ' ' + this.stream.gameId + '\n'
      );
    } else {
      if (this.titleStream && this.stream.title !== stream.title) {
        this.titleStream.write(
          new Date().toISOString() + ' ' + this.stream.title + '\n'
        );
      }
      if (this.gameStream && this.stream.gameId !== stream.gameId) {
        this.gameStream.write(
          new Date().toISOString() + ' ' + this.stream.gameId + '\n'
        );
      }
      this.stream = stream;
    }
    if (this.viewCountStream)
      this.viewCountStream.write(
        new Date().toISOString() + ' ' + this.stream.viewers + '\n'
      );

    console.log(stream);
  }

  private async closeStream() {
    if (this.viewCountStream) this.viewCountStream.close();
    if (this.titleStream) this.titleStream.close();
    if (this.gameStream) this.gameStream.close();
    await fs.promises.writeFile(
      path.join(this.path, 'closed.txt'),
      new Date().toISOString()
    );
  }

  private async makePath(id: string): Promise<string> {
    const time = new Date();
    let month = (time.getMonth() + 1).toString();
    if (month.length === 1) month = '0' + month;
    const outd = path.join(
      this.config.path,
      'stream',
      time.getFullYear().toString(),
      month,
      id
    );
    await fs.promises.mkdir(outd, { recursive: true });
    return outd;
  }

  public start() {
    this.intervalInt = setInterval(() => {
      this.getStream();
    }, this.config.statInterval * 1000);
  }

  public stop() {
    if (!this.intervalInt) return;
    clearInterval(this.intervalInt);
    this.intervalInt = null;
  }
}

export default Stats;
