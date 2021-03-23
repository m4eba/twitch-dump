import fs from 'fs';
import path from 'path';
import { ApiClient, HelixStream } from 'twitch';
import { createHash } from 'crypto';
import fetch from 'node-fetch';
import Debug from 'debug';

const debug = Debug('utils');

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function timeoutPipe(
  ins: NodeJS.ReadableStream,
  outs: NodeJS.WritableStream,
  timeout: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    let size = 0;
    function timeoutFailed() {
      reject('read timeout');
    }
    let timer = setTimeout(timeoutFailed, timeout);
    ins.on('close', () => {
      clearTimeout(timer);
      outs.end();
      resolve(size);
    });
    ins.on('end', () => {
      clearTimeout(timer);
      outs.end();
      resolve(size);
    });

    ins.on('data', (chunk: Buffer) => {
      size += chunk.length;
      outs.write(chunk);
      clearTimeout(timer);
      timer = setTimeout(timeoutFailed, timeout);
    });
  });
}

export async function fileExists(name: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(name);
    if (stat.isFile()) {
      return true;
    }
  } catch (e) {
    //
  }
  return false;
}

const hosts = [
  'dqrpb9wgowsf5.cloudfront.net',
  'd2e2de1etea730.cloudfront.net',
  'd2vjef5jvl6bfs.cloudfron.net',
  'vod-secure.twitch.tv',
];

export async function m3u8Url(
  stream: HelixStream,
  username: string
): Promise<string> {
  const epoch = stream.startDate.getTime() / 1000;
  const str = `${username}_${stream.id}_${epoch}`;

  const shasum = createHash('sha1');
  shasum.update(str);
  const sha1 = shasum.digest('hex').substr(0, 20);
  for (let i = 0; i < hosts.length; ++i) {
    const url = `https://${hosts[i]}/${sha1}_${str}/chunked/index-dvr.m3u8`;
    debug('test url %s', url);
    const resp = await fetch(url, { method: 'HEAD' });
    if (resp.status == 200) {
      return url;
    }
  }
  return '';
}

export async function waitForStream(
  timeout: number,
  channel: string,
  client: ApiClient
): Promise<HelixStream | null> {
  const start = new Date().getTime();
  for (;;) {
    const t = new Date().getTime();
    if (t - start > timeout) {
      debug('stream wait timeout!!!');
      return null;
    }
    debug('waitForStream');
    const stream = await client.helix.streams.getStreamByUserName(channel);
    if (stream === null) {
      debug('stream is null, wait 20 seconds');
      await sleep(20 * 1000);
      continue;
    }
    debug('stream found %o', stream);
    return stream;
  }
}

export async function downloadFile(
  fileUrl: string,
  target: string,
  timeout: number
): Promise<{
  success: boolean;
  size: number;
  log: string[];
  error: string[];
}> {
  let retries = 0;
  const tmpName = target + '.tmp';
  const baseName = path.basename(target);
  let length = 0;
  const log: string[] = [];
  const error: string[] = [];

  debug('download file %s', fileUrl);
  log.push(baseName + ' ' + fileUrl);
  while (retries < 5) {
    debug('download retry %d', retries);
    log.push(baseName + ' ' + retries.toString());
    try {
      retries++;

      const resp = await fetch(fileUrl);
      if (!resp.ok) throw new Error(`unexpected response ${resp.statusText}`);
      const clength = resp.headers.get('content-length');

      if (clength != null) {
        try {
          length = parseInt(clength);
        } catch (e) {
          throw new Error('unable to parse content-length ' + clength);
        }
      }

      const out = fs.createWriteStream(tmpName);
      const size = await timeoutPipe(resp.body, out, timeout);
      if (length != size) {
        throw new Error('file size does not match');
      }
      await fs.promises.rename(tmpName, target);

      log.push(`${baseName} ${length}\n`);
      return {
        success: true,
        size: length,
        log,
        error,
      };
    } catch (e) {
      debug('download error', e);
      error.push(`${baseName} ${length} ${e.toString()}\n`);
    }
    debug('download retries', retries);
  }
  error.push(`${baseName} ${length} FAILED after retrying\n`);
  return {
    success: false,
    size: length,
    log,
    error,
  };
}
