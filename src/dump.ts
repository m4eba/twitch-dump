import fs from 'fs';
import { Chat } from './chat';
import { Config } from './config';
import { Events } from './events';

const config: Config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const chat = new Chat(config);
chat.open();

//const stats = new Stats(config);
//stats.on('stream', (id: string) => {});
//stats.start();

const events = new Events(config);
events.open();
