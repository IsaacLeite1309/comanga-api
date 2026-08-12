import { NodemailerMailService } from './mail/NodemailerMailService';
import {
    CloudinaryMediaStorage,
    cloudinaryConfigFromEnvironment
} from './media/CloudinaryMediaStorage';
import { createAuthNotificationService } from '../modules/auth/AuthNotificationService';

const authNotificationService = createAuthNotificationService({
    mailService: new NodemailerMailService()
});

let cloudinaryStorage: CloudinaryMediaStorage | undefined;

function getMediaStorage(): CloudinaryMediaStorage {
    cloudinaryStorage ||= new CloudinaryMediaStorage(cloudinaryConfigFromEnvironment());
    return cloudinaryStorage;
}

function isMediaPocEnabled(): boolean {
    return process.env.CLOUDINARY_POC_ENABLED === 'true';
}

export {
    authNotificationService,
    getMediaStorage,
    isMediaPocEnabled
};
