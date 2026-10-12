/* hamlive-oss — MIT License. See LICENSE. */

const sessionIdentity = user => ({ id: String(user._id || user.id), version: user.authVersion || 0 });

const userForSession = async (identity, UserProfile) => {
    // Existing sessions contain just an ID. They remain valid only until recovery.
    const id = typeof identity === 'string' ? identity : identity?.id;
    const version = typeof identity === 'string' ? 0 : identity?.version;
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)
        || !Number.isSafeInteger(version) || version < 0) return false;
    const user = await UserProfile.findById(id);
    return user && !user.locked && (user.authVersion || 0) === version ? user : false;
};

module.exports = { sessionIdentity, userForSession };
