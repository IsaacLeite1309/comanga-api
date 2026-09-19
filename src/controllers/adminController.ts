import adminUsers from '../modules/admin/users';
import adminOptions from '../modules/admin/options';
import works from '../modules/catalog/works';
import editions from '../modules/catalog/editions';
import volumes from '../modules/catalog/volumes';
import media from '../modules/admin/media';

export = {
    ...adminUsers,
    ...adminOptions,
    ...works,
    ...editions,
    ...volumes,
    ...media
};
