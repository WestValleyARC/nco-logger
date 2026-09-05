const databaseName = 'hamlive';
const username = process.env.MONGO_APP_USERNAME;
const password = process.env.MONGO_APP_PASSWORD;

if (!username || !password) throw new Error('Mongo application credentials are required');
db.getSiblingDB(databaseName).createUser({
    user: username,
    pwd: password,
    roles: [{ role: 'readWrite', db: databaseName }]
});
