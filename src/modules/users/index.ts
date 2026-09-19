import userController from '../../controllers/userController';

const {
    getUserProfile,
    getOwnUserProfile,
    getUserById,
    updateAdultContent,
    updateUserById,
    deleteOwnAccount
} = userController;

export = {
    getUserProfile,
    getOwnUserProfile,
    getUserById,
    updateAdultContent,
    updateUserById,
    deleteOwnAccount
};
