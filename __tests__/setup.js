// Provide required env vars before any module loads
process.env.JWT_SECRET = 'test-secret-key-min-32-chars-long-for-jest';
process.env.JWT_EXPIRES_IN = '1h';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.ADMIN_USERNAME = 'Admin_Raushan';
process.env.ADMIN_PASSWORD_HASH = '$2a$12$testh4sh.placeholder.not.real.hash.value.x';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/samaj_setu_test';
process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'ap-south-1';
process.env.AWS_S3_BUCKET = 'test-bucket';
process.env.AWS_ACCESS_KEY_ID = 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
