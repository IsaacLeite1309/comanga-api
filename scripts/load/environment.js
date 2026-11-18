const { execFile, fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { mkdtemp, realpath, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { URL } = require('node:url');
const { promisify } = require('node:util');

const exec = promisify(execFile);
const root = resolve(__dirname, '../..');
const role = 'comanga_load';
const database = 'test_comanga_load';
const postgresLocale = process.env.LOAD_TEST_PG_LOCALE || 'en_US.UTF-8';

function makeEnvironment(directory) {
    return { PATH: process.env.PATH, TMPDIR: directory, LC_ALL: 'C', NODE_ENV: 'test' };
}

function makeDatabaseUrl(directory) {
    const url = new URL(`postgresql://${role}@localhost:5432/${database}`);
    url.searchParams.set('host', directory);
    return url.toString();
}

async function findPostgresBinaries(env) {
    if (process.env.LOAD_TEST_PG_BIN) return resolve(process.env.LOAD_TEST_PG_BIN);
    try {
        const { stdout } = await exec('pg_config', ['--bindir'], { env, timeout: 5000 });
        return stdout.trim();
    } catch {
        throw new Error('Instale o PostgreSQL local ou informe LOAD_TEST_PG_BIN com o diretório dos binários.');
    }
}

function postgres(env, directory, bin) {
    const data = join(directory, 'db');
    const run = (binary, args) => exec(join(bin, binary), args, { cwd: directory, env, timeout: 45000 });
    let started = false;

    return {
        async start() {
            await run('initdb', ['-D', data, '-U', role, '--locale', postgresLocale, '--encoding=UTF8', '-A', 'trust']);
            started = true;
            // O processo só aceita conexões no socket dentro do diretório de modo 0700.
            await run('pg_ctl', ['-D', data, '-l', join(directory, 'pg.log'), '-w', '-t', '20',
                '-o', `-c listen_addresses='' -c unix_socket_directories='${directory}'`, 'start']);
            await run('createdb', ['-h', directory, '-p', '5432', '-U', role, database]);
        },
        async stop() {
            if (!started) return;
            const isRunning = await run('pg_ctl', ['-D', data, 'status']).then(() => true, (error) => {
                if (error.code === 3) return false;
                throw error;
            });
            if (isRunning) await run('pg_ctl', ['-D', data, '-w', '-t', '20', '-m', 'immediate', 'stop']);
        }
    };
}

async function createDatabase(directory, env, signal) {
    const bin = await findPostgresBinaries(env);
    const databaseUrl = makeDatabaseUrl(directory);
    const databaseEnv = {
        ...env,
        DATABASE_URL: databaseUrl,
        DATABASE_URL_TEST: databaseUrl,
        PRISMA_HIDE_UPDATE_MESSAGE: 'true'
    };
    const db = postgres(env, directory, bin);
    try {
        await db.start();
        signal?.throwIfAborted();
        await exec(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy',
            '--schema', join(root, 'prisma/schema.prisma')], { cwd: directory, env: databaseEnv, timeout: 120000 });
        return { db, databaseEnv, databaseUrl };
    } catch (error) {
        await db.stop();
        throw error;
    }
}

async function closeServer(child) {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = delay(6000, undefined, { ref: false }).then(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });
    await Promise.race([exited, timer]);
    await exited;
}

function startServer(directory, databaseEnv, build, port, opsToken) {
    const mailbox = new Map();
    const child = fork(join(__dirname, 'server.js'), [build, String(port)], {
        cwd: directory,
        env: {
            ...databaseEnv,
            NODE_PATH: join(root, 'node_modules'),
            OPS_METRICS_TOKEN: opsToken,
            MEDIA_PUBLIC_BASE_URL: 'https://fixture.invalid'
        },
        execArgv: [],
        stdio: ['ignore', 'ignore', 'inherit', 'ipc']
    });
    child.on('message', (message) => {
        if (message.type === 'mail') mailbox.set(message.email, message);
    });
    const ready = new Promise((resolveReady, reject) => {
        const deadline = globalThis.setTimeout(() => reject(new Error('A API local não iniciou no prazo.')), 10000);
        child.once('error', reject);
        child.once('exit', () => reject(new Error('A API local encerrou antes de iniciar.')));
        child.on('message', (message) => {
            if (message.type !== 'ready') return;
            globalThis.clearTimeout(deadline);
            resolveReady(message);
        });
        child.once('exit', () => globalThis.clearTimeout(deadline));
    });
    return { child, ready, mailbox };
}

async function withEnvironment(port, operation, signal) {
    const directory = await realpath(await mkdtemp('/tmp/cml-'));
    const env = makeEnvironment(directory);
    const build = join(directory, 'build', 'src');
    const opsToken = randomBytes(32).toString('hex');
    let db;
    let server;

    try {
        await exec(process.execPath, [require.resolve('typescript/bin/tsc'), '--project', join(root, 'tsconfig.json'),
            '--outDir', join(build, '..')], { cwd: directory, env, timeout: 120000 });
        signal?.throwIfAborted();
        const { db: startedDatabase, databaseEnv, databaseUrl } = await createDatabase(directory, env, signal);
        db = startedDatabase;
        signal?.throwIfAborted();
        server = startServer(directory, databaseEnv, build, port, opsToken);
        const { port: actualPort, endpoints } = await server.ready;
        const origin = new URL(`http://127.0.0.1:${actualPort}`).origin;
        return await operation({ databaseUrl, origin, endpoints, opsToken, mailbox: server.mailbox });
    } finally {
        try {
            if (server) await closeServer(server.child);
        } finally {
            if (db) await db.stop();
            await rm(directory, { recursive: true, force: true });
        }
    }
}

module.exports = { withEnvironment };
