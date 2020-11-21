import url from 'url';
import fs from 'fs';
import path from 'path';
import util from 'util';
const streamPipeline = util.promisify(require('stream').pipeline);
import { Config } from './Config';
import { ApiClient, HelixStream } from 'twitch';
import Debug from 'debug';

const debug = Debug('BaseVideo');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export enum VideoStatus {
  IDLE,
  INITIALIZING,
  DOWNLOADING,
}

export class BaseVideo {
  protected config: Config;
  protected client: ApiClient;
  protected folder: string = '';

  private sequenceNumber = -1;
  private segmentInfo: fs.WriteStream | null = null;
  private segmentLog: fs.WriteStream | null = null;
  private refreshInt: NodeJS.Timeout | null = null;

  constructor(config: Config, client: ApiClient) {
    this.config = config;
    this.client = client;
  }

  protected async getStream() {
    for (;;) {
      debug('getStream');
      const stream = await this.client.helix.streams.getStreamByUserName(
        this.config.channel
      );
      if (stream === null) {
        debug('stream is null, wait 3 seconds');
        await sleep(3000);
        continue;
      }
      debug('stream found %o', stream);
      await fs.promises.writeFile(
        this.folder + '-stream.json',
        JSON.stringify(stream, null, '  ')
      );
      return stream;
    }
  }
}
