import url from 'url';
import fs from 'fs';
import path from 'path';
import * as utils from './utils';
import fetch from 'node-fetch';
import HLS from 'hls-parser';
import { Config } from './Config';
import ApiClient from 'twitch';
import Debug from 'debug';
import AbortController from 'abort-controller';
import * as db from './db';

const MAX_PLAYLIST_RETRIES = 5;
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
  private min10Wait: NodeJS.Timeout | null = null;
  private lastDuration: number = 2;
  private downloading: boolean = false;
  private downloadsRunning: number = 0;
  private listDownloadCount: number = 0;
  private recordingId: number = 0;

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
    let tries = 0;
    while (tries < MAX_PLAYLIST_RETRIES) {
      try {
        let token: AccessToken | null = null;
        try {
          token = await this.getAccessToken();
        } catch (e) {
          console.log('unable to get access token', e);
          throw e;
        }
        debug('accesstoken %o', token);
        return await this.playlist(token);
      } catch (e) {
        debug('unable to get playlist');
      }
      await sleep(2000);
      tries++;
    }
    throw new Error(
      `unable to get playlist after ${MAX_PLAYLIST_RETRIES} retries`
    );
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
    this.recordingId = await db.start(time, this.folder, this.config.channel);

    try {
      const list = await this.list(variant);
      if (list.segments.length === 0) {
        debug('list empty set status to idle');
        this.status = VideoStatus.IDLE;
        if (this.recordingId > 0) await db.stop(new Date(), this.recordingId);
        if (this.min10Wait != null) {
          clearTimeout(this.min10Wait);
        }
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
      if (this.recordingId > 0) await db.stop(new Date(), this.recordingId);
      if (this.min10Wait != null) {
        clearTimeout(this.min10Wait);
      }
    }
  }

  private initRefreshInterval(variant: HLS.types.Variant) {
    if (this.refreshInt != null) {
      clearInterval(this.refreshInt);
      this.refreshInt = null;
    }
    this.refreshInt = setInterval(() => {
      debug('refresh interval');
      this.list(variant)
        .then(this.handleList.bind(this))
        .catch(() => {});
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
      // @ts-ignore
      const dataJson = JSON.stringify(stream._data, null, '  ');
      debug('stream found %o', stream);

      await fs.promises.writeFile(this.folder + '-stream.json', dataJson);
      await db.updateStreamData(this.recordingId, stream.id, dataJson);
      // check stream api one more time after 10 minutes
      // the api is cached in case of a sudden disconnect
      // this first call will have the stream id of the
      // last stream, so just dump everything and figure
      // it out later
      this.min10Wait = setTimeout(async () => {
        this.min10Wait = null;
        const stream = await this.client.helix.streams.getStreamByUserName(
          this.config.channel
        );
        if (stream !== null) {
          // @ts-ignore
          const dataJson = JSON.stringify(stream._data, null, '  ');
          await db.updateStreamData10(this.recordingId, stream.id, dataJson);
          await fs.promises.writeFile(
            this.folder + '-stream-10.json',
            dataJson
          );
        }
      }, 1000 * 60 * 10);
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
      this.listDownloadCount++;
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
      if (this.recordingId > 0) db.stop(new Date(), this.recordingId);
      if (this.min10Wait != null) {
        clearTimeout(this.min10Wait);
      }
      clearInterval(this.refreshInt);
      this.refreshInt = null;
    }
  }

  private async downloadSegment(segment: HLS.types.Segment) {
    const tmpName = path.join(
      this.folder,
      segment.mediaSequenceNumber + '.ts.tmp'
    );
    const filename =
      segment.mediaSequenceNumber
        .toString()
        .padStart(this.config.filenamePaddingSize, '0') + '.ts';
    const name = path.join(this.folder, filename);

    await db.startFile(
      this.recordingId,
      filename,
      segment.mediaSequenceNumber,
      segment.duration,
      segment.programDateTime ? segment.programDateTime : new Date()
    );
    let retries = 0;
    let controller: AbortController | null = null;
    while (retries < 15) {
      try {
        this.downloadsRunning++;
        retries++;
        let stat = null;
        try {
          // test if file already exists
          stat = await fs.promises.stat(tmpName);
        } catch (e) {
          // do nothing
        }

        let headers = {};
        let flags = 'w';

        if (stat != null) {
          debug(`${segment.mediaSequenceNumber}: resume at`, stat.size);
          headers = {
            Range: `bytes=${stat.size}-`,
          };
        }
        controller = new AbortController();
        const resp = await fetch(segment.uri, {
          headers,
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`unexpected response ${resp.statusText}`);
        const clength = resp.headers.get('content-length');
        let length = 0;
        let totalLength = 0;
        const range = resp.headers.get('content-range');
        if (range != null) {
          flags = 'a';
          debug(`${segment.mediaSequenceNumber}: range header`, range);
        }
        if (clength != null) {
          try {
            length = parseInt(clength);
            totalLength = length;
            if (stat != null && range != null) {
              totalLength = length + stat.size;
            }
          } catch (e) {
            throw new Error('unable to parse content-length ' + clength);
          }
        }
        await db.updateFileSize(this.recordingId, filename, totalLength);
        const out = fs.createWriteStream(tmpName, {
          flags,
        });

        const size = await utils.timeoutPipe(resp.body, out, 30 * 1000);

        debug(
          '%d - length %d file size %d',
          segment.mediaSequenceNumber,
          length,
          size
        );
        if (length > 0 && length != size) {
          await db.updateFileStatus(this.recordingId, filename, 'error');
          throw new Error(`file size does not match ${size}/${length}`);
        }
        await fs.promises.rename(tmpName, name);
        let totalSize = size;
        if (stat != null) {
          totalSize += stat.size;
        }
        await db.updateFileStatus(this.recordingId, filename, 'done');
        await db.updateFileDownloadSize(this.recordingId, filename, totalSize);
        if (this.segmentLog) {
          this.segmentLog.write(
            new Date().toISOString() +
              ` ${segment.mediaSequenceNumber} ${totalSize}/${totalLength} ok\n`
          );
        }
        return;
      } catch (e) {
        if (controller != null) controller.abort();
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
      } finally {
        this.downloadsRunning--;
      }
    }
  }

  private async refreshTokenUrl(): Promise<string> {
    const newVariant = await this.initPlaylist();
    this.initRefreshInterval(newVariant);
    const resp = await fetch(newVariant.uri);
    const text = await resp.text();
    return text;
  }

  private async list(
    variant: HLS.types.Variant
  ): Promise<HLS.types.MediaPlaylist> {
    try {
      let text = '';
      if (
        this.listDownloadCount > 10 &&
        this.downloadsRunning >= this.config.refreshDownloadsCountThreshold
      ) {
        debug('too many donwloads refresh token and playlist');
        text = await this.refreshTokenUrl();
      } else {
        const resp = await fetch(variant.uri);
        text = await resp.text();
      }
      if (text.length === 0) {
        debug('playlist empty, refresh token+url');
        text = await this.refreshTokenUrl();
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
    // resest
    this.listDownloadCount = 0;
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
    if (this.playlistLog) {
      this.playlistLog.write(`### MASTER ${new Date().toUTCString()}\n`);
      this.playlistLog.write(text);
      this.playlistLog.write('\n');
    }
    const list: HLS.types.MasterPlaylist = HLS.parse(
      text
    ) as HLS.types.MasterPlaylist;
    const best = list.variants.reduce((prev, curr) => {
      let result = prev;
      if (prev.resolution && curr.resolution) {
        // select current if resolution is higher
        if (prev.resolution.width < curr.resolution.width) {
          result = curr;
        }
        // if resolution is same select on bandwidth
        if (prev.resolution.width === curr.resolution.width) {
          if (prev.bandwidth < curr.bandwidth) {
            result = curr;
          }
        }
      } else {
        // select based on bandwidth if there is no resolution
        if (prev.bandwidth < curr.bandwidth) {
          result = curr;
        }
      }

      debug('best format %o', result);
      return result;
    });
    return best;
  }

  private async getAccessToken(): Promise<AccessToken> {
    // access token via graphql
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
      //'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Client-ID': 'ue6666qo983tsx6so1t0vnawi233wa',
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

    try {
      const data: AccessToken = {
        sig: result[0].data.streamPlaybackAccessToken.signature,
        token: result[0].data.streamPlaybackAccessToken.value,
        expires_at: '',
      };
      return data;
    } catch (e) {
      console.log('unable to create access token', result);
      throw e;
    }
  }
}

export default Video;
