/**
 * Shared DB mock — each test file must call jest.mock('../src/config/db', dbMockFactory)
 */
const mockQuery = jest.fn();
const mockPool  = { query: mockQuery, end: jest.fn(), on: jest.fn() };

const dbMockFactory = () => ({ query: mockQuery, pool: mockPool });

module.exports = { mockQuery, mockPool, dbMockFactory };
