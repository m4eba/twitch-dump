import fs from 'fs';
import path from 'path';
import Debug from 'debug';
import url from 'url';
import fetch from 'node-fetch';
import { Config } from './Config';
import { ApiClient, HelixStream, HelixUser, HelixVideo } from 'twitch';
import * as utils from './utils';
import { parallelLimit } from 'async';

const debug = Debug('vodDownloader');

enum VodDownloaderStatus {
  IDLE,
  INITIALIZING,
  WAIT_FOR_VOD,
  INIT_DOWNLOAD,
  DOWNLOADING,
  WAIT_FOR_UPDATE,
  ERROR,
}

interface AccessToken {
  signature: string;
  value: string;
}

export class VodDownloader {
  private status: VodDownloaderStatus = VodDownloaderStatus.IDLE;
  private config: Config;
  private client: ApiClient;
  private stream: HelixStream;
  private user: HelixUser | null = null;
  private vod: HelixVideo | null = null;
  private vodWaitTimeout = 30 * 60 * 1000;
  private updateWaitTime = 5 * 60 * 1000;
  private vodDoneTime = 20 * 60 * 1000;
  private m3u8Url: string = '';
  private folder: string = '';
  private completed = new Set<String>();
  private log: fs.WriteStream | null = null;
  private errorLog: fs.WriteStream | null = null;
  private playlistLog: fs.WriteStream | null = null;

  constructor(config: Config, client: ApiClient, stream: HelixStream) {
    this.config = config;
    this.stream = stream;
    this.client = client;
  }

  public async start() {
    if (this.status != VodDownloaderStatus.IDLE) {
      debug('start() not idle');
      return;
    }
    this.user = await this.client.helix.users.getUserByName(
      this.config.channel
    );

    if (this.user == null) {
      this.error('unable to get user');
    }

    this.status = VodDownloaderStatus.WAIT_FOR_VOD;
    const found = await this.waitForVod();
    if (!found) {
      this.error('vod not found');
    }

    this.status = VodDownloaderStatus.INIT_DOWNLOAD;
    await this.initDownload();
  }

  private async waitForVod(): Promise<boolean> {
    const start = new Date().getTime();
    const streamTimeStamp = this.stream.startDate.getTime();

    for (;;) {
      debug('looking for vod');
      const t = new Date().getTime();
      if (t - start > this.vodWaitTimeout) {
        debug('vod wait timeout!!!');
        return false;
      }
      const vods = await this.client.helix.videos.getVideosByUser(this.user!);

      for (let i = 0; i < vods.data.length; ++i) {
        const v = vods.data[i];
        const vodTimeStamp = new Date(v.creationDate).getTime();
        // vod is created later
        // only test with kraken if vod is in 10 minutes of stream start
        if (vodTimeStamp - streamTimeStamp > 10 * 60 * 1000) continue;

        /*
        debug('check kraken api for vod %s', v.id);


        const req = await fetch(`https://api.twitch.tv/kraken/videos/${v.id}`, {
          headers: {
            Accept: 'application/vnd.twitchtv.v5+json',
            'Client-ID': this.client.clientId,
          },
        });
        try {
          const old = await req.json();

          if (old.broadcast_id.toString() == this.stream.id) {
            this.vod = v;
            this.krakeVod = old;
            return true;
          }
        } catch (e) {
          debug('unable to process vod info %s', e.toString());
        }*/
        this.vod = v;
        return true;
      }
      await utils.sleep(60 * 1000);
    }
  }

  private async initDownload() {
    const time = new Date();
    let month = (time.getMonth() + 1).toString();
    if (month.length === 1) month = '0' + month;

    this.folder = path.join(
      this.config.path,
      'vod',
      time.getFullYear().toString(),
      month,
      this.vod!.id
    );

    await fs.promises.mkdir(this.folder, { recursive: true });

    this.log = fs.createWriteStream(this.folder + '.log', {
      flags: 'a',
    });
    this.errorLog = fs.createWriteStream(this.folder + '-error.log', {
      flags: 'a',
    });
    this.playlistLog = fs.createWriteStream(this.folder + '-playlist.txt', {
      flags: 'a',
    });

    for (let i = 0; i < 3; ++i) {
      this.m3u8Url = await utils.m3u8Url(this.stream, this.config.channel);
      if (this.m3u8Url.length != 0) {
        break;
      }
      debug('unable to get m3u8 url, wait 1 minute before retry');
      await utils.sleep(60 * 1000);
    }
    if (this.m3u8Url.length == 0) {
      debug('unable to get m3u8 direct link, try other method');
      this.m3u8Url = await this.getVodUrl();
    }
    if (this.m3u8Url.length == 0) {
      debug('unable to get m3u8 url');
      this.error('unable to get m3u8 url');
      return;
    }

    await this.download();
  }

  private async download() {
    this.status = VodDownloaderStatus.DOWNLOADING;
    let zeroResultTime = 0;

    for (;;) {
      try {
        const m3u8 = await this.m3u8Load();
        const lines = m3u8.split('\n');
        const files: string[] = [];

        let currentLength = '';
        for (let i = 0; i < lines.length; ++i) {
          let l = lines[i];
          if (l.length == 0) continue;
          if (l.substr(0, 7) == '#EXTINF') {
            currentLength = l;
            continue;
          }

          if (l[0] == '#') continue;
          if (l.endsWith('-unmuted.ts')) {
            const completedName = l.replace('-unmuted.ts', '.ts');
            if (this.completed.has(completedName)) continue;
            l = l.replace('-unmuted.ts', '-muted.ts');
          }
          if (this.completed.has(l)) continue;
          const filename = l.padStart(this.config.filenamePaddingSize, '0');
          if (await utils.fileExists(path.join(this.folder, filename)))
            continue;
          files.push(l);
          this.playlistLog!.write(`${currentLength}\n${l}\n`);
        }

        if (files.length > 0) {
          zeroResultTime = 0;
          const parsedUrl = url.parse(this.m3u8Url);
          const baseUrl = parsedUrl.href.substr(
            0,
            this.m3u8Url.length -
              path.basename(parsedUrl.pathname ? parsedUrl.pathname : '').length
          );
          const instance = this;

          /* eslint-disable */
          function* iter(): Iterable<() => Promise<void>> {
            for (let i = 0; i < files.length; ++i) {
              const name = files[i];
              const filename = name.padStart(
                instance.config.filenamePaddingSize,
                '0'
              );
              const target = path.join(instance.folder, filename);
              const fileUrl = baseUrl + name;

              yield ((n, u, t) => {
                return async () => {
                  const result = await utils.downloadFile(u, t, 30 * 60);
                  result.log.forEach((l) => instance.log!.write(l + '\n'));
                  result.error.forEach((l) =>
                    instance.errorLog!.write(l + '\n')
                  );
                  if (result.success) {
                    instance.completed.add(n);
                  }
                };
              })(name, fileUrl, target);
            }
          }
          // @ts-ignore
          await parallelLimit(iter(), 4);
        } else {
          if (zeroResultTime == 0) {
            zeroResultTime = new Date().getTime();
          }
        }
      } catch (e) {
        if (this.errorLog) {
          this.errorLog.write('download error: ' + e.toString());
        }
      }
      if (
        zeroResultTime > 0 &&
        new Date().getTime() - zeroResultTime > this.vodDoneTime
      ) {
        debug('no more vodupdates found');
        break;
      }
      this.status = VodDownloaderStatus.WAIT_FOR_UPDATE;
      await utils.sleep(this.updateWaitTime);
      this.status = VodDownloaderStatus.DOWNLOADING;
    }
  }

  private async getVodUrl(): Promise<string> {
    const token = await this.getAccessToken();
    if (token === null || this.vod === null) {
      return '';
    }
    try {
      const queryObj = {
        allow_source: true,
        p: 9544124,
        supported_codecs: 'avc1',
        token: token.value,
        sig: token.signature,
        cdm: 'wv',
        player_version: '1.4.0',
      };
      const query = Object.entries(queryObj)
        .map(([key, val]) => `${key}=${encodeURIComponent(val)}`)
        .join('&');
      const resp = await fetch(
        `https://usher.ttvnw.net/vod/${this.vod.id}.m3u8?${query}`,
        {
          method: 'GET',
        }
      );
      const result = await resp.text();
      const lines = result.split('\n');
      for (let i = 0; i < lines.length; ++i) {
        const l = lines[i];
        if (l.length === 0) continue;
        if (l[0] === '#') continue;
        debug('url %s', l);
        return l;
      }
    } catch (e) {
      debug('unable to request vod url');
    }
    return '';
  }

  private async getAccessToken(): Promise<AccessToken | null> {
    if (this.vod === null) {
      return null;
    }
    // access token via graphql
    try {
      const req = [
        {
          operationName: 'PlaybackAccessToken_Template',
          query:
            'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {  streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {    value    signature    __typename  }  videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {    value    signature    __typename  }}',
          variables: {
            isLive: false,
            isVod: true,
            login: '',
            playerType: 'site',
            vodID: this.vod.id,
          },
        },
      ];
      const headers = {
        //'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Client-ID': 'ue6666qo983tsx6so1t0vnawi233wa',
        Accept: 'application/vnd.twitchtv.v5+json',
      };
      if (this.config.oauthVideo.length > 0) {
        headers['Authorization'] = `OAuth ${this.config.oauthVideo}`;
      }
      debug('gql vod accesstoken, headers %o', headers);
      const resp = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
      });
      const result = await resp.json();

      const data: AccessToken = {
        signature: result[0].data.videoPlaybackAccessToken.signature,
        value: result[0].data.videoPlaybackAccessToken.value,
      };
      debug('token %o', data);
      return data;
    } catch (e) {
      debug('unable to get accesstoken with graphql');
      return null;
    }
  }

  private async m3u8Load(): Promise<string> {
    let retries = 0;
    while (retries < 4) {
      retries++;
      const req = await fetch(this.m3u8Url);
      if (!req.ok) {
        debug('req not ok, wait 1 second and retry');
        await utils.sleep(1000);
        continue;
      }
      const m3u8 = await req.text();
      if (m3u8.substr(0, 7) != '#EXTM3U') {
        debug('m3u8 does not start with #EXTM3U');
        await utils.sleep(1000);
        continue;
      }
      return m3u8;
    }
    this.error('unable to load m3u8');
    return '';
  }

  private error(msg: string) {
    this.status = VodDownloaderStatus.ERROR;
    throw new Error(msg);
  }
}

export default VodDownloader;
