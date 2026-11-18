const { join } = require('node:path');
const { URL } = require('node:url');
const express = require('express');
const sharp = require('sharp');

const coverUrl = 'https://fixture.invalid/capa.png';

function isolateExternalAdapters(build) {
    const container = require(join(build, 'infrastructure/container'));
    const downloader = require(join(build, 'infrastructure/media/RemoteImageDownloader'));
    const ApplicationError = require(join(build, 'errors/ApplicationError')).default;
    const image = sharp({
        create: { width: 60, height: 90, channels: 3, background: '#557188' }
    }).png().toBuffer();

    const objects = new Set();
    container.getMediaStorage = () => ({
        provider: 'r2',
        async putObject(input) { objects.add(input.key); },
        async deleteObjects(keys) { keys.forEach((key) => objects.delete(key)); }
    });
    downloader.downloadRemoteImage = async (url) => {
        if (url !== coverUrl) {
            throw new ApplicationError({
                statusCode: 400,
                code: 'MEDIA_SOURCE_UNAVAILABLE',
                message: 'A origem não é uma fixture de carga.'
            });
        }
        return { bytes: await image, contentType: 'image/png', finalUrl: coverUrl };
    };
    const mail = (kind) => async (email, username, token) => {
        if (!email.endsWith('.invalid')) throw new Error('Somente destinatários de teste são permitidos.');
        process.send({ type: 'mail', kind, email, username, token });
    };
    container.mailService.sendActivationEmail = mail('activation');
    container.mailService.sendPasswordResetEmail = mail('recovery');
}

function readEndpoints(stack, mounts, prefix = '') {
    return stack.flatMap((layer) => {
        if (layer.route) {
            const { path, methods } = layer.route;
            if (typeof path !== 'string') throw new Error('O inventário precisa tratar esta rota Express.');
            return Object.keys(methods).map((method) => `${method.toUpperCase()} ${prefix}${path}`);
        }
        if (!layer.handle.stack) return [];
        const mount = mounts.get(layer);
        if (typeof mount !== 'string') throw new Error('O inventário precisa tratar este roteador Express.');
        return readEndpoints(layer.handle.stack, mounts, prefix + mount);
    });
}

function loadApplication(build) {
    const mounts = new Map();
    const routerUse = express.Router.prototype.use;

    express.Router.prototype.use = function (prefix, ...handlers) {
        const first = this.stack.length;
        const router = routerUse.call(this, prefix, ...handlers);
        if (typeof prefix === 'string') {
            this.stack.slice(first).forEach((layer) => mounts.set(layer, prefix));
        }
        return router;
    };
    try {
        const app = require(join(build, 'app'));
        return { app, endpoints: readEndpoints(app.router.stack, mounts) };
    } finally {
        express.Router.prototype.use = routerUse;
    }
}

function assertIsolatedEnvironment() {
    const { NODE_ENV, DATABASE_URL, DATABASE_URL_TEST } = process.env;
    const database = DATABASE_URL && new URL(DATABASE_URL);
    if (!process.connected || NODE_ENV !== 'test' || !database || DATABASE_URL !== DATABASE_URL_TEST
        || database.protocol !== 'postgresql:' || database.hostname !== 'localhost' || database.port !== '5432'
        || database.pathname !== '/test_comanga_load' || database.searchParams.get('host') !== process.cwd()) {
        throw new Error('Inicie a API com o banco temporário pelo runner local.');
    }
}

function main(build, port) {
    assertIsolatedEnvironment();
    isolateExternalAdapters(build);
    const { app, endpoints } = loadApplication(build);
    const prisma = require(join(build, 'prisma'));
    const { installGracefulShutdown } = require(join(build, 'infrastructure/operations/gracefulShutdown'));
    const server = app.listen(port, '127.0.0.1');
    server.once('listening', () => {
        process.send({ type: 'ready', port: server.address().port, endpoints });
    });
    server.on('error', (error) => {
        console.error(`Falha ao abrir a API local (${error.code || 'listen'}).`);
        process.disconnect();
        process.exitCode = 1;
    });
    const { shutdown } = installGracefulShutdown({
        server,
        disconnect: async () => {
            await prisma.$disconnect();
            if (process.connected) process.disconnect();
        },
        timeoutMs: 5000
    });
    process.once('disconnect', () => {
        if (server.listening) void shutdown('SIGTERM');
    });
}

main(process.argv[2], Number(process.argv[3]));
