import { ResendMailService } from './mail/ResendMailService';
import { R2MediaStorage, r2ConfigFromEnvironment } from './media/R2MediaStorage';
import { downloadRemoteImage } from './media/RemoteImageDownloader';
import { processCoverImage } from './media/CoverImageProcessor';
import { mediaPublicUrlResolverFromEnvironment } from './media/mediaPublicUrl';
const mailService = new ResendMailService();

let mediaStorage: R2MediaStorage | undefined;

function getMediaStorage(): R2MediaStorage {
    mediaStorage ||= new R2MediaStorage(r2ConfigFromEnvironment());
    return mediaStorage;
}

export {
    mailService,
    downloadRemoteImage,
    getMediaStorage,
    mediaPublicUrlResolverFromEnvironment,
    processCoverImage
};
