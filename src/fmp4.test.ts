import HLS from 'hls-parser';
import { urlExtension, urlPathname } from './utils';

describe('urlExtension', () => {
  test('ts segment', () => {
    expect(
      urlExtension('https://example.com/v1/segment/abc123.ts?foo=bar', '.ts')
    ).toBe('.ts');
  });
  test('mp4 segment', () => {
    expect(
      urlExtension('https://example.com/v1/segment/abc123.mp4', '.ts')
    ).toBe('.mp4');
  });
  test('no extension falls back', () => {
    expect(urlExtension('https://example.com/v1/segment/abc123', '.ts')).toBe(
      '.ts'
    );
  });
  test('invalid url falls back', () => {
    expect(urlExtension('not a url', '.ts')).toBe('.ts');
  });
});

describe('urlPathname', () => {
  test('same init url with rotated auth token', () => {
    expect(
      urlPathname('https://example.com/v1/segment/init-abc.mp4?dna=token1')
    ).toBe(
      urlPathname('https://example.com/v1/segment/init-abc.mp4?dna=token2')
    );
  });
  test('different init urls differ', () => {
    expect(
      urlPathname('https://example.com/v1/segment/init-abc.mp4?dna=t')
    ).not.toBe(
      urlPathname('https://example.com/v1/segment/init-xyz.mp4?dna=t')
    );
  });
  test('invalid url returned as is', () => {
    expect(urlPathname('not a url')).toBe('not a url');
  });
});

describe('fmp4 playlist parsing', () => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-TARGETDURATION:5',
    '#EXT-X-MEDIA-SEQUENCE:100',
    '#EXT-X-MAP:URI="https://example.com/v1/segment/init-abc.mp4"',
    '#EXT-X-PROGRAM-DATE-TIME:2026-07-07T00:00:00.000Z',
    '#EXTINF:2.000,live',
    'https://example.com/v1/segment/seg-100.mp4',
    '#EXTINF:2.000,live',
    'https://example.com/v1/segment/seg-101.mp4',
  ].join('\n');

  test('segments carry map uri', () => {
    const list = HLS.parse(playlist) as HLS.types.MediaPlaylist;
    expect(list.segments).toHaveLength(2);
    expect(list.segments[0].map?.uri).toBe(
      'https://example.com/v1/segment/init-abc.mp4'
    );
    // map applies to all following segments
    expect(list.segments[1].map?.uri).toBe(
      'https://example.com/v1/segment/init-abc.mp4'
    );
    expect(list.segments[0].mediaSequenceNumber).toBe(100);
  });

  test('ts playlist has no map', () => {
    const tsList = HLS.parse(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:5',
        '#EXT-X-MEDIA-SEQUENCE:100',
        '#EXTINF:2.000,live',
        'https://example.com/v1/segment/seg-100.ts',
      ].join('\n')
    ) as HLS.types.MediaPlaylist;
    expect(tsList.segments[0].map).toBeFalsy();
  });
});
