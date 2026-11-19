const { execFile, fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { mkdtemp, realpath, rm, writeFile, readFile } = require('node:fs/promises');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { URL } = require('node:url');
const { promisify } = require('node:util');

const exec = promisify(execFile);
const root = resolve(__dirname, '../..');
const role = 'comanga_load';
const database = 'test_comanga_load';
const windows = process.platform === 'win32';
const postgresLocale = process.env.LOAD_TEST_PG_LOCALE || (windows ? 'English_United States.1252' : 'en_US.UTF-8');

function makeEnvironment(directory) {
    return { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        TEMP: directory, TMP: directory, TMPDIR: directory, LC_ALL: 'C', NODE_ENV: 'test' };
}

function makeDatabaseUrl(directory, port, password) {
    const url = new URL(`postgresql://${role}@${windows ? '127.0.0.1' : 'localhost'}:${port}/${database}`);
    if (windows) url.password = password;
    else url.searchParams.set('host', directory);
    return url.toString();
}

async function reservePort() {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    return port;
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

function postgres(env, directory, bin, port, password) {
    const data = join(directory, 'db');
    const run = (binary, args) => exec(join(bin, `${binary}${windows ? '.exe' : ''}`), args,
        { cwd: directory, env: { ...env, PGPASSWORD: password }, timeout: 45000 });
    let started = false;

    return {
        async start() {
            const auth = windows ? ['-A', 'scram-sha-256', '--pwfile', join(directory, 'pg-password')]
                : ['-A', 'trust'];
            if (windows) await writeFile(join(directory, 'pg-password'), password, { mode: 0o600 });
            await run('initdb', ['-D', data, '-U', role, '--locale', postgresLocale, '--encoding=UTF8', ...auth]);
            started = true;
            // Unix usa um socket privado; Windows usa loopback e senha descartável.
            const options = windows ? `-c listen_addresses=127.0.0.1 -c port=${port}`
                : `-c listen_addresses='' -c unix_socket_directories='${directory}'`;
            try {
                await run('pg_ctl', ['-D', data, '-l', join(directory, 'pg.log'), '-w', '-t', '20',
                    '-o', options, 'start']);
            } catch (error) {
                const log = await readFile(join(directory, 'pg.log'), 'utf8').catch(() => '');
                error.message += `\n${log.split('\n').slice(-12).join('\n')}`;
                throw error;
            }
            await run('createdb', ['-h', windows ? '127.0.0.1' : directory, '-p', String(port), '-U', role, database]);
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
    const port = windows ? await reservePort() : 5432;
    const password = windows ? randomBytes(24).toString('hex') : '';
    const databaseUrl = makeDatabaseUrl(directory, port, password);
    const databaseEnv = {
        ...env,
        DATABASE_URL: databaseUrl,
        DATABASE_URL_TEST: databaseUrl,
        PRISMA_HIDE_UPDATE_MESSAGE: 'true'
    };
    const db = postgres(env, directory, bin, port, password);
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

function startServer(directory, databaseEnv, build, port, opsToken, fixture) {
    const mailbox = new Map();
    const child = fork(join(__dirname, 'server.js'), [build, String(port)], {
        cwd: directory,
        env: {
            ...databaseEnv,
            NODE_PATH: join(root, 'node_modules'),
            OPS_METRICS_TOKEN: opsToken,
            MEDIA_PUBLIC_BASE_URL: 'https://fixture.invalid',
            LOAD_TEST_FIXTURE_COVER_WIDTH: String(fixture.coverWidth ?? 60),
            LOAD_TEST_FIXTURE_COVER_HEIGHT: String(fixture.coverHeight ?? 90)
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

async function withEnvironment(port, operation, signal, fixture = {}) {
    const tempRoot = await realpath(windows ? tmpdir() : '/tmp');
    const directory = await realpath(await mkdtemp(join(tempRoot, 'cml-')));
    const env = makeEnvironment(directory);
    const buildRoot = await realpath(join(root, 'node_modules'));
    const buildDirectory = await realpath(await mkdtemp(join(buildRoot, '.comanga-load-')));
    // A build resolve somente as dependências deste checkout, antes de pacotes globais.
    const build = join(buildDirectory, 'src');
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
        server = startServer(directory, databaseEnv, build, port, opsToken, fixture);
        const { port: actualPort, endpoints } = await server.ready;
        const origin = new URL(`http://127.0.0.1:${actualPort}`).origin;
        return await operation({ databaseUrl, origin, endpoints, opsToken, mailbox: server.mailbox });
    } finally {
        try {
            if (server) await closeServer(server.child);
        } finally {
            if (db) await db.stop();
            if (dirname(directory) !== tempRoot || !basename(directory).startsWith('cml-')) {
                throw new Error('Diretório de carga fora da pasta temporária esperada.');
            }
            await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
            if (dirname(buildDirectory) !== buildRoot || !basename(buildDirectory).startsWith('.comanga-load-')) {
                throw new Error('Build de carga fora do diretório esperado.');
            }
            await rm(buildDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
        }
    }
}

module.exports = { withEnvironment };
