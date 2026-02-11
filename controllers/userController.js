const { deleteFile } = require('../utils/fileUtils');

exports.updateAvatar = async (req, res) => {
    if (!req.file) throw new AppError('No file uploaded', 400);
    if (req.user.avatar) await deleteFile(req.user.avatar);

    req.user.avatar = '/uploads/' + req.file.filename;
    await req.user.save();
    res.json({ success: true, avatar: req.user.avatar });
};

exports.deleteAvatar = async (req, res) => {
    if (req.user.avatar) await deleteFile(req.user.avatar);
    req.user.avatar = null;
    await req.user.save();
    res.json({ success: true });
};

exports.updateProfile = async (req, res) => {
    const { displayName } = req.body;
    if (!displayName) throw new AppError('Display name required', 400);

    req.user.displayName = displayName;
    await req.user.save();
    res.json({ success: true });
};
