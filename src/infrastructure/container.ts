import type MediaStorage from './contracts/MediaStorage';
import { LocalMediaStorage } from './media/LocalMediaStorage';
import { LocalMailService } from './mail/LocalMailService';
import { localDirectory } from './localDirectory';
import { ResendMailService } from './mail/ResendMailService';
import { R2MediaStorage, r2ConfigFromEnvironment } from './media/R2MediaStorage';
import { downloadRemoteImage } from './media/RemoteImageDownloader';
import { processCoverImage } from './media/CoverImageProcessor';
import { mediaPublicUrlResolverFromEnvironment } from './media/mediaPublicUrl';
const mailService = process.env.MAIL_TRANSPORT === 'local'
    ? new LocalMailService(localDirectory('LOCAL_MAIL_DIR')) : new ResendMailService();

let mediaStorage: MediaStorage | undefined;

function getMediaStorage(): MediaStorage {
    mediaStorage ||= process.env.MEDIA_STORAGE_DRIVER === 'local'
        ? new LocalMediaStorage(localDirectory('LOCAL_MEDIA_DIR'))
        : new R2MediaStorage(r2ConfigFromEnvironment());
    return mediaStorage;
}

export {
    mailService,
    downloadRemoteImage,
    getMediaStorage,
    mediaPublicUrlResolverFromEnvironment,
    processCoverImage
};
