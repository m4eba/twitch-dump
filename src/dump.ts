import fs from 'fs';
import { Config, Dump } from './config';
import { Chat } from './chat';
import TwitchClient from 'twitch';
import { Events } from './events';
import Video from './video';

if (process.argv.length !== 3) {
  console.log('usage node build/dump.js <config file>');
  process.exit(1);
}

const content = fs.readFileSync(process.argv[2], 'utf8');
const config: Config = JSON.parse(content);
const dump = new Set<Dump>();
config.dump.forEach((d) => dump.add(d));
config.dump = dump;

const client = TwitchClient.withClientCredentials(
  config.clientId,
  config.secret
);

if (config.dump.has(Dump.CHAT)) {
  const chat = new Chat(config);
  chat.open();
}

let events: Events | null = null;

if (config.dump.has(Dump.EVENTS)) {
  events = new Events(config, client);
  events.open();
}

if (config.dump.has(Dump.VIDEO)) {
  const video = new Video(config, client);
  if (events === null) {
    events = new Events(config, client, true);
    events.open();
  }
  events.on('stream-up', () => {
    video.start();
  });
}
