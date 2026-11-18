const { createHash, randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const defaultBirthDate = new Date('1999-01-01T00:00:00Z');

function getPassword(env) {
    const password = env.LOAD_TEST_PASSWORD ?? `Carga!${randomBytes(12).toString('hex')}a9`;
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/.test(password)
        || globalThis.Buffer.byteLength(password) > 72) {
        throw new Error('LOAD_TEST_PASSWORD deve ter de 8 caracteres a 72 bytes, com maiúscula, minúscula, dígito e símbolo.');
    }
    return password;
}

async function createFixtureFactory(prisma, password) {
    const passwordHash = await bcrypt.hash(password, 10);
    const profiles = await prisma.profile.findMany({ select: { id: true, code: true } });
    const profileIds = Object.fromEntries(profiles.map(({ id, code }) => [code, id]));

    return async function createUser({ active = true, admin = false, birthDate = defaultBirthDate } = {}) {
        const suffix = randomBytes(7).toString('hex');
        const username = `carga_${suffix}`;
        const email = `${username}@fixture.invalid`;
        const nivelAcesso = admin ? 'Administrador' : 'Usuário Padrão';
        const activeProfileId = profileIds[admin ? 'ADMINISTRADOR' : 'USUARIO_PADRAO'];
        const activationToken = active ? null : randomBytes(32).toString('hex');
        const { id } = await prisma.user.create({
            data: {
                username,
                email,
                passwordHash,
                birthDate: birthDate === null ? null : new Date(birthDate),
                status: active ? 'Ativada' : 'Pendente',
                nivelAcesso,
                activationToken,
                activationExpiresAt: active ? null : new Date(Date.now() + 86400000)
            },
            select: { id: true }
        });
        if (!active) return { id, username, email, activationToken };

        const token = randomBytes(48).toString('hex');
        await prisma.session.create({
            data: { userId: id, activeProfileId, sessionTokenHash: createHash('sha256').update(token).digest('hex') }
        });
        return { id, username, email, cookie: `comanga_session=${token}` };
    };
}

async function withFixtures(environment, operation, password) {
    const prisma = new PrismaClient({ datasourceUrl: environment.databaseUrl });
    try {
        const createUser = await createFixtureFactory(prisma, password);
        const admin = await createUser({ admin: true });
        const member = await createUser();
        return await operation({ prisma, createUser, users: { admin, member }, password,
            opsToken: environment.opsToken, mailbox: environment.mailbox });
    } finally {
        await prisma.$disconnect();
    }
}

module.exports = { getPassword, withFixtures };
