import url from 'url';
import fs from 'fs';
import path from 'path';
import * as utils from './utils';
import fetch from 'node-fetch';
import HLS from 'hls-parser';
import { Config } from './Config';
import ApiClient from 'twitch';
import Debug from 'debug';

const debug = Debug('video');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface AccessToken {
  token: string;
  sig: string;
  expires_at: string;
}

export enum VideoStatus {
  IDLE,
  INITIALIZING,
  DOWNLOADING,
}

export class Video {
  private config: Config;
  private client: ApiClient;
  private status: VideoStatus = VideoStatus.IDLE;
  private sequenceNumber = -1;
  private segmentInfo: fs.WriteStream | null = null;
  private segmentLog: fs.WriteStream | null = null;
  private playlistLog: fs.WriteStream | null = null;
  private folder: string = '';
  private refreshInt: NodeJS.Timeout | null = null;
  private lastDuration: number = 2;
  private downloading: boolean = false;

  constructor(config: Config, client: ApiClient) {
    this.config = config;
    this.client = client;
  }

  public start() {
    if (this.status != VideoStatus.IDLE) {
      debug('status not idle');
      return;
    }
    debug('start: status=initializing');
    this.status = VideoStatus.INITIALIZING;
    this.initPlaylist()
      .then((list: HLS.types.Variant) => {
        this.initDownload(list);
      })
      .catch((e) => {
        debug('unable to initDownload %o', e);
        console.log('unable to initDownload', e);
        this.status = VideoStatus.IDLE;
      });
  }

  private async initPlaylist() {
    let token: AccessToken | null = null;
    try {
      token = await this.getAccessToken();
    } catch (e) {
      console.log('unable to get access token', e);
      process.exit(1);
    }
    debug('accesstoken %o', token);
    return await this.playlist(token);
  }

  private async initDownload(variant: HLS.types.Variant) {
    debug('initDownload');
    const time = new Date();
    let month = (time.getMonth() + 1).toString();
    if (month.length === 1) month = '0' + month;

    this.sequenceNumber = -1;
    this.folder = path.join(
      this.config.path,
      'video',
      time.getFullYear().toString(),
      month,
      time.toISOString().replace(/:/g, '-')
    );
    debug('folder %s', this.folder);
    await fs.promises.mkdir(this.folder, { recursive: true });
    this.segmentInfo = fs.createWriteStream(this.folder + '.txt', {
      flags: 'a',
    });
    this.segmentLog = fs.createWriteStream(this.folder + '.log', {
      flags: 'a',
    });
    this.playlistLog = fs.createWriteStream(this.folder + '-playlist.log', {
      flags: 'a',
    });

    try {
      const list = await this.list(variant);
      if (list.segments.length === 0) {
        debug('list empty set status to idle');
        this.status = VideoStatus.IDLE;
        return;
      }
      debug('set status to downloading');
      this.status = VideoStatus.DOWNLOADING;
      this.handleList(list);
      this.getStream();
      this.initRefreshInterval(variant);
    } catch (e) {
      debug('unable to initialize download %o', e);
      console.log('unable to initialize download', e);
      debug('set status to idle');
      this.status = VideoStatus.IDLE;
    }
  }

  private initRefreshInterval(variant: HLS.types.Variant) {
    if (this.refreshInt != null) {
      clearInterval(this.refreshInt);
      this.refreshInt = null;
    }
    this.refreshInt = setInterval(() => {
      debug('refresh interval');
      this.list(variant).then(this.handleList.bind(this));
    }, this.lastDuration * 1000);
  }

  private async getStream() {
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
      break;
    }
  }
  private handleList(list: HLS.types.MediaPlaylist) {
    debug('handleList, size %d', list.segments.length);
    list.segments.forEach((seg) => {
      if (seg.mediaSequenceNumber <= this.sequenceNumber) return;
      if (this.segmentInfo) {
        const time = seg.programDateTime?.toISOString();
        this.segmentInfo.write(
          `${seg.mediaSequenceNumber},${seg.duration},${time}\n`
        );
      }
      console.log('download segment', seg.mediaSequenceNumber);
      debug('download segment %d', seg.mediaSequenceNumber);
      this.downloadSegment(seg);
      this.sequenceNumber = seg.mediaSequenceNumber;
    });
    if (list.segments.length > 0) {
      this.lastDuration = list.segments[0].duration;
    }
    if (list.endlist && this.refreshInt) {
      console.log('ENDLIST');
      debug('endlist');
      debug('set status to idle');
      this.status = VideoStatus.IDLE;
      clearInterval(this.refreshInt);
      this.refreshInt = null;
    }
  }

  private async downloadSegment(segment: HLS.types.Segment) {
    const tmpName = path.join(
      this.folder,
      segment.mediaSequenceNumber + '.ts.tmp'
    );
    const name = path.join(
      this.folder,
      segment.mediaSequenceNumber
        .toString()
        .padStart(this.config.filenamePaddingSize, '0') + '.ts'
    );
    let retries = 0;
    while (retries < 5) {
      try {
        retries++;
        const resp = await fetch(segment.uri);
        if (!resp.ok) throw new Error(`unexpected response ${resp.statusText}`);
        const clength = resp.headers.get('content-length');
        let length = 0;
        if (clength != null) {
          try {
            length = parseInt(clength);
          } catch (e) {
            throw new Error('unable to parse content-length ' + clength);
          }
        }
        const out = fs.createWriteStream(tmpName);
        const size = await utils.timeoutPipe(resp.body, out, 30 * 1000);
        debug(
          '%d - length %d file size %d',
          segment.mediaSequenceNumber,
          length,
          size
        );
        if (length > 0 && length != size) {
          throw new Error(`file size does not match ${size}/${length}`);
        }
        await fs.promises.rename(tmpName, name);
        if (this.segmentLog) {
          this.segmentLog.write(
            new Date().toISOString() +
              ` ${segment.mediaSequenceNumber} ${size}/${length} ok\n`
          );
        }
        return;
      } catch (e) {
        debug(
          'unable to download segment %d: %o',
          segment.mediaSequenceNumber,
          e
        );
        if (this.segmentLog) {
          this.segmentLog.write(
            new Date().toISOString() +
              ` ${segment.mediaSequenceNumber} err: ${e}\n`
          );
        }
      }
    }
  }

  private async list(
    variant: HLS.types.Variant
  ): Promise<HLS.types.MediaPlaylist> {
    try {
      const resp = await fetch(variant.uri);
      let text = await resp.text();
      if (text.length === 0) {
        debug('playlist empty, refresh token+url');
        const newVariant = await this.initPlaylist();
        this.initRefreshInterval(newVariant);
        const resp = await fetch(newVariant.uri);
        text = await resp.text();
      }
      if (this.playlistLog) {
        this.playlistLog.write(`### ${new Date().toUTCString()}\n`);
        this.playlistLog.write(text);
        this.playlistLog.write('\n');
      }
      const list: HLS.types.MediaPlaylist = HLS.parse(
        text
      ) as HLS.types.MediaPlaylist;
      debug('playlist received %d', list.segments.length);
      return list;
    } catch (e) {
      debug('unable to handle playlist %o', e);
      return Promise.reject(e);
    }
  }

  private async playlist(token: AccessToken): Promise<HLS.types.Variant> {
    const uri = new url.URL(
      `https://usher.ttvnw.net/api/channel/hls/${this.config.channel}.m3u8`
    );
    uri.searchParams.append('player', 'twitchweb');
    uri.searchParams.append('p', Math.trunc(Math.random() * 999999).toString());
    uri.searchParams.append('type', 'any');
    uri.searchParams.append('allow_source', 'true');
    uri.searchParams.append('allow_spectre', 'false');
    uri.searchParams.append('sig', token.sig);
    uri.searchParams.append('token', token.token);

    const resp = await fetch(uri);
    const text = await resp.text();
    const list: HLS.types.MasterPlaylist = HLS.parse(
      text
    ) as HLS.types.MasterPlaylist;
    const best = list.variants.reduce((prev, curr) => {
      let result = prev;
      if (prev.bandwidth < curr.bandwidth) {
        result = curr;
      }
      debug('best format %o', result);
      return result;
    });
    return best;
  }

  private async getAccessToken(): Promise<AccessToken> {
    // access token via graphql
    try {
      const req = [
        {
          operationName: 'PlaybackAccessToken',
          variables: {
            isLive: true,
            isVod: false,
            login: this.config.channel,
            playerType: 'site',
            vodID: '',
          },
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash:
                '0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712',
            },
          },
        },
      ];
      const headers = {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        Accept: 'application/vnd.twitchtv.v5+json',
      };
      if (this.config.oauthVideo.length > 0) {
        headers['Authorization'] = `OAuth ${this.config.oauthVideo}`;
      }
      debug('gql accesstoken, headers %o', headers);
      const resp = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
      });
      const result = await resp.json();

      const data: AccessToken = {
        sig: result[0].data.streamPlaybackAccessToken.signature,
        token: result[0].data.streamPlaybackAccessToken.value,
        expires_at: '',
      };
      return data;
    } catch (e) {
      debug('unable to get accesstoken with graphql');
      const token = await this.getAccessTokenOld();
      return token;
    }
  }

  private async getAccessTokenOld(): Promise<AccessToken> {
    const uri = `https://api.twitch.tv/api/channels/${this.config.channel}/access_token?platform=_`;
    debug('url for accesstoken %s', uri);
    // needs twitch client id
    // see https://github.com/streamlink/streamlink/issues/2680#issuecomment-557605851
    const resp = await fetch(uri, {
      headers: {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        Accept: 'application/vnd.twitchtv.v5+json',
      },
    });
    const data: AccessToken = await resp.json();
    return data;
  }
}

export default Video;
