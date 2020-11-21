import { Config } from './Config';
import * as utils from './utils';
import { ApiClient, HelixStream } from 'twitch';
import Debug from 'debug';
import VodDownloader from './VodDownloader';

const debug = Debug('vod');

enum VodStatus {
  IDLE,
  WAITFORSTREAM,
}

export class Vod {
  private config: Config;
  private client: ApiClient;
  private status: VodStatus = VodStatus.IDLE;
  private downloads: Map<string, VodDownloader> = new Map();

  constructor(config: Config, client: ApiClient) {
    this.config = config;
    this.client = client;
  }

  public start() {
    if (this.status != VodStatus.IDLE) {
      debug('status not idle');
      return;
    }
    this.status = VodStatus.WAITFORSTREAM;
    debug('search for active stream');
    utils
      .waitForStream(30 * 60, this.config.channel, this.client)
      .then((stream: HelixStream | null) => {
        this.status = VodStatus.IDLE;
        if (stream == null) {
          return;
        }
        if (this.downloads.has(stream.id)) {
          console.log('already downloading vod for stream');
          return;
        }

        const downloader = new VodDownloader(this.config, this.client, stream);
        this.downloads.set(stream.id, downloader);
        downloader
          .start()
          .catch((e: Error) => {
            debug('unable to start download %s', e.toString());
          })
          .finally(() => {
            this.downloads.delete(stream.id);
          });
      });
  }

  /*
  private async waitForVod() {
    for (;;) {
      if (this.user == null) {
        console.log('user should not be null');
        process.exit(1);
      }
      const vodlist = this.client.helix.videos.getVideosByUser(this.user);
    }
  }
  */
}

export default Vod;
