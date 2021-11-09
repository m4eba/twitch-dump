import { Config } from './Config';
import { Pool } from 'pg';

let pool: Pool | null = null;

export async function init(config: Config) {
  if (config.postgres) {
    try {
      pool = new Pool({
        host: config.postgres.host,
        user: config.postgres.username,
        password: config.postgres.password,
        port: config.postgres.port,
        database: config.postgres.database,
      });

      // make one query to test for database
      await pool.query('select 1');
    } catch (e) {
      pool = null;
      if (
        e.toString() ==
        `error: database "${config.postgres.database}" does not exist`
      ) {
        console.log('create database');
        pool = new Pool({
          host: config.postgres.host,
          user: config.postgres.username,
          password: config.postgres.password,
          port: config.postgres.port,
        });
        await pool.query(`CREATE DATABASE ${config.postgres.database}`);
        await pool.end();
        pool = new Pool({
          host: config.postgres.host,
          user: config.postgres.username,
          password: config.postgres.password,
          port: config.postgres.port,
          database: config.postgres.database,
        });
      }
    } //catch block

    if (pool == null) {
      return;
    }
    // test for tables
    const tabletest = await pool.query(`SELECT EXISTS (
      SELECT FROM pg_tables
      WHERE  schemaname = 'public'
      AND    tablename  = 'file'
      );`);

    if (!tabletest.rows[0].exists) {
      await pool.query(`
        create table recording (
          id SERIAL primary key,
          start timestamp not null,
          path text not null,
          username text not null,
          streamid text not null DEFAULT '',
          streamdata text not null DEFAULT '',
          streamid10 text not null DEFAULT '',
          streamdata10 texte not null DEFAULT '',
        );
        
        create index recording_username_idx on recording (username);
        create index recording_streamid_idx on recording (streamid);

        create type file_status as enum ('downloading', 'error', 'done'); 
        create table file (
          id SERIAL primary key,
          recording_id integer not null,
          name text not null,
          seq integer not null,          
          duration decimal not null,
          datetime timestamptz not null,
          size integer not null,
          downloaded integer not null,
          hash text not null,
          status file_status
        );

        create index file_recording_id_idx on file(recording_id);
        create index file_name_idx on file (name);
        create index file_seq_idx on file (seq);
        `);
    }
  }
}

export async function start(
  time: Date,
  folder: string,
  channel: string
): Promise<number> {
  if (pool == null) return 0;
  const result = await pool.query(
    'INSERT into recording VALUES (DEFAULT, $1, $2, $3, DEFAULT, DEFAULT) RETURNING id',
    [time, folder, channel]
  );
  return result.rows[0].id;
}

export async function updateStreamData(
  recordingId: number,
  streamId: string,
  streamData: string
) {
  if (pool == null) return;
  await pool.query(
    'UPDATE recording SET streamid=$1, streamdata=$2 WHERE recording_id = $3',
    [streamId, streamData, recordingId]
  );
}

export async function updateStreamData10(
  recordingId: number,
  streamId: string,
  streamData: string
) {
  if (pool == null) return;
  await pool.query(
    'UPDATE recording SET streamid10=$1, streamdata10=$2 WHERE recording_id = $3',
    [streamId, streamData, recordingId]
  );
}

export async function startFile(
  recordingId: number,
  name: string,
  seq: number,
  duration: number,
  time: Date
): Promise<number> {
  if (pool == null) return 0;
  const result = await pool.query(
    'INSERT into file (recording_id,name,seq,duration,datetime,size,downloaded,hash,status) VALUES ($1,$2,$3,$4,$5,0,0,$6,$7) RETURNING id',
    [recordingId, name, seq, duration, time, '', 'downloading']
  );
  return result.rows[0].id;
}

export async function updateFileSize(
  recordingId: number,
  name: string,
  size: number
) {
  if (pool == null) return;
  await pool.query(
    'UPDATE file SET size=$1 WHERE recording_id = $2 AND name = $3',
    [size, recordingId, name]
  );
}

export async function updateFileDownloadSize(
  recordingId: number,
  name: string,
  size: number
) {
  if (pool == null) return;
  await pool.query(
    'UPDATE file SET downloaded=$1 WHERE recording_id = $2 AND name = $3',
    [size, recordingId, name]
  );
}

export async function updateFileStatus(
  recordingId: number,
  name: string,
  status: string
) {
  if (pool == null) return;
  await pool.query(
    'UPDATE file SET status=$1 WHERE recording_id = $2 AND name = $3',
    [status, recordingId, name]
  );
}
