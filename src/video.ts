import url from 'url';
import fs from 'fs';
import path from 'path';
import util from 'util';
const streamPipeline = util.promisify(require('stream').pipeline);
import fetch from 'node-fetch';
import HLS from 'hls-parser';
import { Config } from './config';

interface AccessToken {
  token: string;
  sig: string;
  expires_at: string;
}
export class Video {
  private config: Config;
  private sequenceNumber = -1;
  private segmentInfo: fs.WriteStream | null = null;
  private segmentLog: fs.WriteStream | null = null;
  private folder: string = '';
  private refreshInt: NodeJS.Timeout | null = null;
  private downloading: boolean = false;

  constructor(config: Config) {
    this.config = config;
  }

  public start() {
    if (this.downloading) return;
    this.getAccessToken()
      .then((token) => {
        console.log('token', token);
        return this.playlist(token);
      })
      .then((list: HLS.types.Variant) => {
        this.initDownload(list);
      });
  }

  private async initDownload(variant: HLS.types.Variant) {
    const time = new Date();
    let month = (time.getMonth() + 1).toString();
    if (month.length === 1) month = '0' + month;

    this.folder = path.join(
      this.config.path,
      'video',
      time.getFullYear().toString(),
      month,
      time.toISOString()
    );
    await fs.promises.mkdir(this.folder, { recursive: true });
    this.segmentInfo = fs.createWriteStream(this.folder + '.txt', {
      flags: 'a',
    });
    this.segmentLog = fs.createWriteStream(this.folder + '.log', {
      flags: 'a',
    });

    const list = await this.list(variant);
    if (list.segments.length === 0) return;
    this.downloading = true;
    this.handleList(list);
    this.refreshInt = setInterval(() => {
      this.list(variant).then(this.handleList.bind(this));
    }, list.segments[0].duration * 1000);
  }

  private handleList(list: HLS.types.MediaPlaylist) {
    list.segments.forEach((seg) => {
      if (seg.mediaSequenceNumber <= this.sequenceNumber) return;
      if (this.segmentInfo) {
        const time = seg.programDateTime?.toISOString();
        this.segmentInfo.write(
          `${seg.mediaSequenceNumber},${seg.duration},${time}\n`
        );
      }
      this.downloadSegment(seg);
      this.sequenceNumber = seg.mediaSequenceNumber;
    });
    if (list.endlist && this.refreshInt) {
      this.downloading = false;
      clearInterval(this.refreshInt);
    }
  }

  private async downloadSegment(segment: HLS.types.Segment) {
    const tmpName = path.join(
      this.folder,
      segment.mediaSequenceNumber + '.ts.tmp'
    );
    const name = path.join(this.folder, segment.mediaSequenceNumber + '.ts');
    let retries = 0;
    while (retries < 5) {
      try {
        retries++;
        const resp = await fetch(segment.uri);
        if (!resp.ok) throw new Error(`unexpected response ${resp.statusText}`);
        const out = fs.createWriteStream(tmpName);
        await streamPipeline(resp.body, out);
        await fs.promises.rename(tmpName, name);
        await fs.promises.unlink(tmpName);
        if (this.segmentLog) {
          this.segmentLog.write(
            new Date().toISOString() + ` ${segment.mediaSequenceNumber} ok\n`
          );
        }
      } catch (e) {
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
    const resp = await fetch(variant.uri);
    const text = await resp.text();
    const list: HLS.types.MediaPlaylist = HLS.parse(
      text
    ) as HLS.types.MediaPlaylist;
    return list;
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
      return result;
    });
    return best;
  }

  private async getAccessToken(): Promise<AccessToken> {
    const uri = `https://api.twitch.tv/api/channels/${this.config.channel}/access_token?platform=_`;
    console.log('url', uri);
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
