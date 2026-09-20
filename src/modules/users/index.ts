import { updateActiveProfile, updateOwnPassword, updateOwnUsername } from './accountSettings';
import {
    deleteOwnAccount,
    getOwnUserProfile,
    getUserProfile,
    updateAdultContent,
} from './handlers';

export = {
    getUserProfile,
    getOwnUserProfile,
    updateAdultContent,
    updateActiveProfile,
    updateOwnPassword,
    updateOwnUsername,
    deleteOwnAccount
};
