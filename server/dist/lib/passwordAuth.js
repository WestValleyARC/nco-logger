/* hamlive-oss — MIT License. See LICENSE. */

const crypto = require('node:crypto');
const validator = require('validator');

const PBKDF2_ALGORITHM = 'pbkdf2';
const PBKDF2_ITERATIONS = 200000;
const PBKDF2_KEY_LENGTH = 32;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 256;

const normalizeEmail = email => {
    if (typeof email !== 'string') return '';
    return email.trim().toLowerCase();
};

const hashPassword = async password => {
    if (typeof password !== 'string') {
        throw new TypeError('Password must be a string.');
    }
    const trimmed = password.trim();
    if (trimmed.length < PASSWORD_MIN_LENGTH || trimmed.length > PASSWORD_MAX_LENGTH) {
        throw new Error(`Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`);
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.pbkdf2Sync(trimmed, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, 'sha256').toString('hex');
    return `${PBKDF2_ALGORITHM}$${PBKDF2_ITERATIONS}$${salt}$${derived}`;
};

const verifyPassword = async (password, storedHash) => {
    if (typeof password !== 'string' || typeof storedHash !== 'string' || !storedHash.startsWith(`${PBKDF2_ALGORITHM}$`)) {
        return false;
    }

    try {
        const [, iterationsText, salt, expectedHash] = storedHash.split('$');
        const iterations = Number(iterationsText);
        if (!Number.isInteger(iterations) || iterations < 1 || !salt || !expectedHash) {
            return false;
        }
        const derived = crypto.pbkdf2Sync(password, salt, iterations, PBKDF2_KEY_LENGTH, 'sha256').toString('hex');
        const actual = Buffer.from(derived, 'hex');
        const expected = Buffer.from(expectedHash, 'hex');
        if (actual.length !== expected.length) {
            return false;
        }
        return crypto.timingSafeEqual(actual, expected);
    } catch (error) {
        return false;
    }
};

const userForLocalCredentials = async ({ email, password }, { findOne } = {}) => {
    const normalizedEmail = normalizeEmail(email);
    if (!validator.isEmail(normalizedEmail) || typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
        return null;
    }

    const user = await findOne({ email: normalizedEmail, locked: { $ne: true } });
    if (!user || !user.passwordHash) {
        return null;
    }

    if (await verifyPassword(password, user.passwordHash)) {
        return user;
    }
    return null;
};

const setPasswordForUser = async ({ userId, password, UserProfileModel }) => {
    if (!UserProfileModel || typeof UserProfileModel.findById !== 'function') {
        throw new TypeError('A UserProfile model with findById() is required.');
    }
    const trimmedPassword = typeof password === 'string' ? password.trim() : '';
    if (trimmedPassword.length < PASSWORD_MIN_LENGTH || trimmedPassword.length > PASSWORD_MAX_LENGTH) {
        throw new Error(`Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`);
    }

    const user = await UserProfileModel.findById(userId);
    if (!user) return null;

    user.passwordHash = await hashPassword(trimmedPassword);
    user.lastAuthVia = 'password';
    user.updatedAt = new Date();
    await user.save();
    return user;
};

module.exports = {
    hashPassword,
    normalizeEmail,
    PASSWORD_MIN_LENGTH,
    PASSWORD_MAX_LENGTH,
    setPasswordForUser,
    userForLocalCredentials,
    verifyPassword
};
