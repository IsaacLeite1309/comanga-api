import userController from '../../controllers/userController';

const {
    registerUser,
    activateAccount,
    resendActivation,
    loginUser,
    logoutUser
} = userController;

export = {
    registerUser,
    activateAccount,
    resendActivation,
    loginUser,
    logoutUser
};
