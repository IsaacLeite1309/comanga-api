// Unit tests never receive credentials for an existing database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL_TEST = 'postgresql://unit:unit@127.0.0.1:1/comanga_unit_test';
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.DATABASE_SSL = 'false';
