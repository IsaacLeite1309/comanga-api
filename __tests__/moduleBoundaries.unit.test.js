const fs = require('node:fs');
const path = require('node:path');
const adminController = require('../src/controllers/adminController');
const userController = require('../src/controllers/userController');

const authModule = require('../src/modules/auth');
const usersModule = require('../src/modules/users');
const adminUsersModule = require('../src/modules/admin/users');
const adminOptionsModule = require('../src/modules/admin/options');
const adminMediaModule = require('../src/modules/admin/media');
const worksModule = require('../src/modules/catalog/works');
const editionsModule = require('../src/modules/catalog/editions');
const volumesModule = require('../src/modules/catalog/volumes');

describe('fronteiras do monolito modular', () => {
    it('separa autenticacao e perfil de usuario por dominio', () => {
        expect(authModule.registerUser).toBe(userController.registerUser);
        expect(authModule.loginUser).toBe(userController.loginUser);
        expect(usersModule.getOwnUserProfile).toBe(userController.getOwnUserProfile);
        expect(usersModule.deleteOwnAccount).toBe(userController.deleteOwnAccount);
    });

    it('mantem adminController apenas como fachada dos modulos administrativos', () => {
        expect(adminController.listUsers).toBe(adminUsersModule.listUsers);
        expect(adminController.createOption).toBe(adminOptionsModule.createOption);
        expect(adminController.importCover).toBe(adminMediaModule.importCover);
        expect(adminController.createWork).toBe(worksModule.createWork);
        expect(adminController.createEdition).toBe(editionsModule.createEdition);
        expect(adminController.createVolume).toBe(volumesModule.createVolume);
    });

    it('separa contratos, regras e consultas compartilhadas em arquivos focados', () => {
        const adminModulePath = path.join(__dirname, '..', 'src', 'modules', 'admin');
        const expectedFiles = [
            'constants.ts',
            'types.ts',
            'mappers.ts',
            'validators.ts',
            'schemas.ts',
            'optionServices.ts',
            'queries.ts'
        ];

        expectedFiles.forEach((file) => {
            expect(fs.existsSync(path.join(adminModulePath, file))).toBe(true);
        });

        const sharedFacade = fs.readFileSync(path.join(adminModulePath, 'shared.ts'), 'utf8');
        expect(sharedFacade).not.toMatch(/\bfunction\s+/);
        expect(sharedFacade).not.toMatch(/\bconst\s+[A-Z_]+\s*=/);
    });

    it('mantem provedores concretos somente no ponto de composicao da infraestrutura', () => {
        const projectRoot = path.join(__dirname, '..');
        const authNotificationSource = fs.readFileSync(
            path.join(projectRoot, 'src', 'modules', 'auth', 'AuthNotificationService.ts'),
            'utf8'
        );
        const adminMediaSource = fs.readFileSync(
            path.join(projectRoot, 'src', 'modules', 'admin', 'media', 'index.ts'),
            'utf8'
        );
        const containerSource = fs.readFileSync(
            path.join(projectRoot, 'src', 'infrastructure', 'container.ts'),
            'utf8'
        );

        expect(authNotificationSource).not.toMatch(/NodemailerMailService/);
        expect(adminMediaSource).not.toMatch(/R2MediaStorage/);
        expect(containerSource).toMatch(/NodemailerMailService/);
        expect(containerSource).toMatch(/R2MediaStorage/);
    });
});
